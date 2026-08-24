import { describe, expect, it } from "vitest";

import {
  paymentSatisfactionContextSchema,
  type PaymentSatisfactionContext,
} from "@/domain/payment-satisfaction";
import { RECOVERY_CASE_STATES, type RecoveryCaseState } from "@/domain/states";
import {
  ACTIVE_RECOVERY_STATES,
  decideRecoveryCaseTransition,
  LEGAL_RECOVERY_TRANSITIONS,
  TERMINAL_RECOVERY_STATES,
} from "@/recovery/state-machine";
import { recoveryCaseTransitionCommandSchema } from "@/recovery/transition-contracts";

const transitionTime = "2026-08-25T10:00:00.000Z";

function verifiedUnpaid(): PaymentSatisfactionContext {
  return paymentSatisfactionContextSchema.parse({
    status: "UNSATISFIED",
    paymentStatus: "FAILED",
    verifiedAt: transitionTime,
  });
}

function verifiedSatisfied(
  basis:
    | "PAYMENT_AUTHORIZED"
    | "PAYMENT_CAPTURED"
    | "ORDER_PAID" = "PAYMENT_CAPTURED",
): PaymentSatisfactionContext {
  return paymentSatisfactionContextSchema.parse({
    status: "SATISFIED",
    basis,
    verifiedAt: transitionTime,
  });
}

function contextFor(
  actualCurrentState: RecoveryCaseState,
  requestedState: RecoveryCaseState,
  overrides: Record<string, unknown> = {},
) {
  const paymentSatisfaction =
    requestedState === "RECOVERED" ? verifiedSatisfied() : verifiedUnpaid();
  const command = recoveryCaseTransitionCommandSchema.parse({
    caseId: "case_state_machine_001",
    expectedCurrentState: actualCurrentState,
    requestedState,
    expectedVersion: 1,
    paymentSatisfaction,
    reasonCode: "TEST_TRANSITION",
    reason: "A deterministic transition test requested this state.",
    transitionedAt: transitionTime,
    ...overrides,
  });

  return { command, actualCurrentState, actualVersion: 1 };
}

describe("recovery-case state machine", () => {
  it("applies every explicitly legal transition", () => {
    for (const from of RECOVERY_CASE_STATES) {
      for (const to of LEGAL_RECOVERY_TRANSITIONS[from]) {
        const result = decideRecoveryCaseTransition(contextFor(from, to));
        expect(result, `${from} -> ${to}`).toMatchObject({
          status: "APPLIED",
          previousState: from,
          resultingState: to,
          previousVersion: 1,
          resultingVersion: 2,
        });
      }
    }
  });

  it("rejects every state pair outside the legal map", () => {
    for (const from of RECOVERY_CASE_STATES) {
      for (const to of RECOVERY_CASE_STATES) {
        if (
          from === to ||
          (
            LEGAL_RECOVERY_TRANSITIONS[from] as readonly RecoveryCaseState[]
          ).includes(to)
        ) {
          continue;
        }

        const result = decideRecoveryCaseTransition(contextFor(from, to));
        expect(
          ["APPLIED", "IDEMPOTENT_NO_OP"],
          `${from} -> ${to}`,
        ).not.toContain(result.status);
      }
    }
  });

  it.each(TERMINAL_RECOVERY_STATES)(
    "%s rejects reactivation into every active recovery state",
    (terminalState) => {
      for (const activeState of ACTIVE_RECOVERY_STATES) {
        const result = decideRecoveryCaseTransition(
          contextFor(terminalState, activeState),
        );
        expect(result.status).toBe("TERMINAL_STATE_REJECTION");
        expect(result.decisionReasonCode).toBe("TERMINAL_STATE_IMMUTABLE");
      }
    },
  );

  it.each(["PAYMENT_AUTHORIZED", "PAYMENT_CAPTURED", "ORDER_PAID"] as const)(
    "verified %s rejects every active recovery target",
    (basis) => {
      for (const target of ACTIVE_RECOVERY_STATES) {
        const result = decideRecoveryCaseTransition(
          contextFor("DETECTED", target, {
            paymentSatisfaction: verifiedSatisfied(basis),
          }),
        );
        expect(result.status).toBe("PAID_STATE_SAFETY_REJECTION");
        expect(result.decisionReasonCode).toBe(
          "SATISFIED_PAYMENT_REQUIRES_SAFE_STOP",
        );
      }
    },
  );

  it("allows late success only to the documented recovered or stopped outcomes", () => {
    for (const target of RECOVERY_CASE_STATES) {
      const result = decideRecoveryCaseTransition(
        contextFor("DETECTED", target, {
          paymentSatisfaction: verifiedSatisfied("PAYMENT_CAPTURED"),
        }),
      );

      if (target === "RECOVERED" || target === "STOPPED") {
        expect(result.status, target).toBe("APPLIED");
      } else {
        expect(result.status, target).toBe("PAID_STATE_SAFETY_REJECTION");
      }
    }
  });

  it("rejects active recovery when verified payment context is unavailable", () => {
    const result = decideRecoveryCaseTransition(
      contextFor("DETECTED", "VERIFYING", {
        paymentSatisfaction: {
          status: "UNAVAILABLE",
          reason: "Synthetic payment-state dependency is unavailable.",
          checkedAt: transitionTime,
        },
      }),
    );

    expect(result).toMatchObject({
      status: "PAYMENT_CONTEXT_REJECTION",
      decisionReasonCode: "ACTIVE_RECOVERY_REQUIRES_VERIFIED_UNPAID_STATE",
      resultingVersion: 1,
    });
  });

  it.each(RECOVERY_CASE_STATES)(
    "treats a safe same-state %s request as an idempotent no-op",
    (state) => {
      const result = decideRecoveryCaseTransition(contextFor(state, state));
      expect(result).toMatchObject({
        status: "IDEMPOTENT_NO_OP",
        decisionReasonCode: "SAME_STATE_NO_OP",
        previousVersion: 1,
        resultingVersion: 1,
      });
    },
  );

  it("rejects an expected current-state mismatch", () => {
    const result = decideRecoveryCaseTransition(
      contextFor("VERIFYING", "DIAGNOSED", {
        expectedCurrentState: "DETECTED",
      }),
    );
    expect(result).toMatchObject({
      status: "CURRENT_STATE_MISMATCH",
      decisionReasonCode: "EXPECTED_STATE_MISMATCH",
    });
  });

  it("rejects an expected version mismatch", () => {
    const context = contextFor("DETECTED", "VERIFYING", {
      expectedVersion: 2,
    });
    const result = decideRecoveryCaseTransition(context);
    expect(result).toMatchObject({
      status: "VERSION_CONFLICT",
      decisionReasonCode: "EXPECTED_VERSION_MISMATCH",
      resultingVersion: 1,
    });
  });

  it("returns safe structured reasons and evidence", () => {
    const result = decideRecoveryCaseTransition(
      contextFor("DETECTED", "LINK_CREATED"),
    );
    expect(result.status).toBe("ILLEGAL_TRANSITION");
    expect(result.decisionReasonCode).toBe("ILLEGAL_STATE_EDGE");
    expect(result.reason.length).toBeGreaterThan(0);
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.evidence[0]?.code).toMatch(/^[A-Z][A-Z0-9_]*$/);
  });
});
