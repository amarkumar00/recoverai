import { describe, expect, it } from "vitest";

import { RECOVERY_ACTIONS } from "@/domain/actions";
import { failureDiagnosisSchema } from "@/domain/diagnosis";
import {
  diagnoseKnownPaymentFailure,
  knownErrorDiagnosisInputSchema,
  type KnownErrorDiagnosisInput,
} from "@/diagnosis/known-error-mapper";

const diagnosisTime = "2026-08-25T10:00:00.000Z";

function diagnosisInput(
  overrides: {
    satisfaction?: Record<string, unknown>;
    downtime?: Record<string, unknown>;
    snapshot?: Record<string, unknown>;
    failure?: Record<string, unknown> | null;
    activeRecoveryLink?: Record<string, unknown>;
  } = {},
): KnownErrorDiagnosisInput {
  const defaultFailure = {
    errorCode: "BAD_REQUEST_ERROR",
    errorSource: "gateway",
    errorStep: "payment_response",
    errorReason: "payment_failed",
  };

  return knownErrorDiagnosisInputSchema.parse({
    caseId: "case_diagnosis_001",
    paymentSnapshot: {
      paymentId: "pay_diagnosis_001",
      orderId: "order_diagnosis_001",
      money: { amountSubunits: 125_000, currency: "INR" },
      status: "FAILED",
      method: "upi",
      bankOrProvider: "synthetic_provider",
      paymentCreatedAt: diagnosisTime,
      failure:
        overrides.failure === null
          ? undefined
          : (overrides.failure ?? defaultFailure),
      ...overrides.snapshot,
    },
    paymentSatisfaction: overrides.satisfaction ?? {
      status: "UNSATISFIED",
      paymentStatus: "FAILED",
      verifiedAt: diagnosisTime,
    },
    downtimeContext: overrides.downtime ?? {
      availability: "AVAILABLE",
      active: false,
      observedAt: diagnosisTime,
    },
    activeRecoveryLink: overrides.activeRecoveryLink ?? { exists: false },
    diagnosedAt: diagnosisTime,
  });
}

describe("deterministic known-error diagnosis", () => {
  it.each(["PAYMENT_AUTHORIZED", "PAYMENT_CAPTURED", "ORDER_PAID"] as const)(
    "classifies verified %s as late success",
    (basis) => {
      const result = diagnoseKnownPaymentFailure(
        diagnosisInput({
          satisfaction: {
            status: "SATISFIED",
            basis,
            verifiedAt: diagnosisTime,
          },
        }),
      );
      expect(result).toMatchObject({
        failureClass: "LATE_SUCCESS",
        knowledgeStatus: "KNOWN",
        candidateActions: ["CANCEL_RECOVERY_ALREADY_PAID"],
      });
    },
  );

  it("lets a verified success supersede an earlier failure webhook snapshot", () => {
    const result = diagnoseKnownPaymentFailure(
      diagnosisInput({
        failure: {
          errorCode: "BAD_REQUEST_ERROR",
          errorReason: "insufficient_funds",
          errorSource: "customer",
        },
        satisfaction: {
          status: "SATISFIED",
          basis: "PAYMENT_CAPTURED",
          verifiedAt: diagnosisTime,
        },
      }),
    );
    expect(result.failureClass).toBe("LATE_SUCCESS");
  });

  it("classifies compatible verified active downtime before a transient error rule", () => {
    const result = diagnoseKnownPaymentFailure(
      diagnosisInput({
        failure: {
          errorCode: "GATEWAY_ERROR",
          errorReason: "bank_technical_error",
          errorSource: "gateway",
        },
        downtime: {
          availability: "AVAILABLE",
          active: true,
          severity: "high",
          observedAt: diagnosisTime,
        },
      }),
    );
    expect(result).toMatchObject({
      failureClass: "DOWNTIME_OR_TRANSIENT",
      knowledgeStatus: "KNOWN",
      candidateActions: ["WAIT_FOR_RECOVERY", "ESCALATE_HUMAN"],
    });
  });

  it("does not guess downtime when the dependency is unavailable", () => {
    const result = diagnoseKnownPaymentFailure(
      diagnosisInput({
        failure: null,
        downtime: {
          availability: "UNAVAILABLE",
          reason: "Synthetic downtime dependency is unavailable.",
          checkedAt: diagnosisTime,
        },
      }),
    );
    expect(result).toMatchObject({
      failureClass: "AMBIGUOUS",
      knowledgeStatus: "UNAVAILABLE",
      candidateActions: ["ESCALATE_HUMAN"],
    });
  });

  it.each([
    [
      "insufficient_funds",
      "customer",
      "INSUFFICIENT_FUNDS",
      ["REQUEST_METHOD_CHANGE", "SEND_PAYMENT_LINK", "ESCALATE_HUMAN"],
    ],
    [
      "incorrect_otp",
      "customer",
      "CUSTOMER_CORRECTABLE",
      ["SEND_PAYMENT_LINK", "REQUEST_METHOD_CHANGE", "ESCALATE_HUMAN"],
    ],
    [
      "bank_not_available",
      "gateway",
      "NETWORK_OR_INTEGRATION_UNCERTAINTY",
      ["WAIT_FOR_RECOVERY", "ESCALATE_HUMAN"],
    ],
    [
      "compliance_violation",
      "business",
      "NON_RETRYABLE",
      ["STOP_NON_RETRYABLE"],
    ],
  ] as const)(
    "maps exact reason %s to %s",
    (errorReason, errorSource, failureClass, candidateActions) => {
      const result = diagnoseKnownPaymentFailure(
        diagnosisInput({
          failure: {
            errorCode: "BAD_REQUEST_ERROR",
            errorReason,
            errorSource,
          },
        }),
      );
      expect(result.failureClass).toBe(failureClass);
      expect(result.knowledgeStatus).toBe("KNOWN");
      expect(result.candidateActions).toEqual(candidateActions);
    },
  );

  it("keeps an unknown error code and reason ambiguous", () => {
    const result = diagnoseKnownPaymentFailure(
      diagnosisInput({
        failure: {
          errorCode: "SYNTHETIC_UNKNOWN_ERROR",
          errorReason: "synthetic_unknown_reason",
          errorSource: "synthetic_source",
        },
      }),
    );
    expect(result).toMatchObject({
      failureClass: "AMBIGUOUS",
      knowledgeStatus: "AMBIGUOUS",
      candidateActions: ["ESCALATE_HUMAN"],
    });
  });

  it("keeps missing structured failure fields ambiguous", () => {
    const result = diagnoseKnownPaymentFailure(
      diagnosisInput({ failure: null }),
    );
    expect(result).toMatchObject({
      failureClass: "AMBIGUOUS",
      knowledgeStatus: "AMBIGUOUS",
    });
  });

  it("escalates conflicting downtime and hard-decline evidence", () => {
    const result = diagnoseKnownPaymentFailure(
      diagnosisInput({
        failure: {
          errorCode: "BAD_REQUEST_ERROR",
          errorReason: "compliance_violation",
          errorSource: "business",
        },
        downtime: {
          availability: "AVAILABLE",
          active: true,
          observedAt: diagnosisTime,
        },
      }),
    );
    expect(result).toMatchObject({
      failureClass: "AMBIGUOUS",
      knowledgeStatus: "AMBIGUOUS",
      candidateActions: ["ESCALATE_HUMAN"],
    });
    expect(result.evidence[0]?.code).toBe("DOWNTIME_FAILURE_CONFLICT");
  });

  it("marks unavailable verified payment state as unavailable rather than unpaid", () => {
    const result = diagnoseKnownPaymentFailure(
      diagnosisInput({
        satisfaction: {
          status: "UNAVAILABLE",
          reason: "Synthetic payment lookup failed safely.",
          checkedAt: diagnosisTime,
        },
      }),
    );
    expect(result).toMatchObject({
      failureClass: "AMBIGUOUS",
      knowledgeStatus: "UNAVAILABLE",
      candidateActions: ["ESCALATE_HUMAN"],
    });
  });

  it("returns identical output for identical input and injected time", () => {
    const input = diagnosisInput({
      failure: {
        errorCode: "BAD_REQUEST_ERROR",
        errorReason: "insufficient_funds",
        errorSource: "customer",
      },
    });
    expect(diagnoseKnownPaymentFailure(input)).toEqual(
      diagnoseKnownPaymentFailure(input),
    );
  });

  it("produces schema-valid results with non-empty reasons, evidence, and canonical actions", () => {
    const inputs = [
      diagnosisInput(),
      diagnosisInput({ failure: null }),
      diagnosisInput({
        failure: {
          errorCode: "BAD_REQUEST_ERROR",
          errorReason: "incorrect_cvv",
          errorSource: "customer",
        },
      }),
      diagnosisInput({
        satisfaction: {
          status: "SATISFIED",
          basis: "ORDER_PAID",
          verifiedAt: diagnosisTime,
        },
      }),
    ];

    for (const input of inputs) {
      const result = diagnoseKnownPaymentFailure(input);
      expect(failureDiagnosisSchema.safeParse(result).success).toBe(true);
      expect(result.reason.length).toBeGreaterThan(0);
      expect(result.evidence.length).toBeGreaterThan(0);
      expect(new Set(result.candidateActions).size).toBe(
        result.candidateActions.length,
      );
      for (const action of result.candidateActions) {
        expect(RECOVERY_ACTIONS).toContain(action);
      }
    }
  });

  it("never turns unknown input into a confident recoverable classification", () => {
    const result = diagnoseKnownPaymentFailure(
      diagnosisInput({
        failure: {
          errorCode: "SYNTHETIC_UNKNOWN_ERROR",
          errorReason: "synthetic_maybe_transient",
        },
      }),
    );
    expect(result.failureClass).toBe("AMBIGUOUS");
    expect(result.knowledgeStatus).not.toBe("KNOWN");
    expect(result.candidateActions).toEqual(["ESCALATE_HUMAN"]);
  });

  it("does not copy customer PII from a free-form description into evidence", () => {
    const sensitiveDescription =
      "Customer person@example.com called from +919999999999.";
    const result = diagnoseKnownPaymentFailure(
      diagnosisInput({
        failure: {
          errorCode: "SYNTHETIC_UNKNOWN_ERROR",
          errorReason: "synthetic_unknown_reason",
          errorDescription: sensitiveDescription,
        },
      }),
    );
    const serializedResult = JSON.stringify(result);
    expect(serializedResult).not.toContain("person@example.com");
    expect(serializedResult).not.toContain("+919999999999");
  });

  it("does not fuzzy-match a look-alike reason or description", () => {
    const result = diagnoseKnownPaymentFailure(
      diagnosisInput({
        failure: {
          errorCode: "BAD_REQUEST_ERROR",
          errorReason: "insufficient_funds_extra",
          errorDescription:
            "This text says insufficient_funds but is not exact.",
          errorSource: "customer",
        },
      }),
    );
    expect(result).toMatchObject({
      failureClass: "AMBIGUOUS",
      knowledgeStatus: "AMBIGUOUS",
    });
  });

  it("requires gateway source for the generic payment_failed mapping", () => {
    const result = diagnoseKnownPaymentFailure(
      diagnosisInput({
        failure: {
          errorCode: "BAD_REQUEST_ERROR",
          errorReason: "payment_failed",
          errorSource: "customer",
        },
      }),
    );
    expect(result.failureClass).toBe("AMBIGUOUS");
  });

  it("does not propose a second Payment Link when one already exists", () => {
    const result = diagnoseKnownPaymentFailure(
      diagnosisInput({
        failure: {
          errorCode: "BAD_REQUEST_ERROR",
          errorReason: "incorrect_otp",
          errorSource: "customer",
        },
        activeRecoveryLink: {
          exists: true,
          recoveryLinkId: "link_existing_001",
        },
      }),
    );
    expect(result.candidateActions).not.toContain("SEND_PAYMENT_LINK");
    expect(result.evidence).toContainEqual({
      code: "ACTIVE_RECOVERY_LINK_PRESENT",
      detail:
        "An existing recovery link was considered without exposing its identifier.",
    });
  });
});
