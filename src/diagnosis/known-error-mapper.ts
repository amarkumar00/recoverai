import { z } from "zod";

import {
  failureDiagnosisSchema,
  type DiagnosisKnowledgeStatus,
  type FailureClass,
  type FailureDiagnosis,
} from "@/domain/diagnosis";
import { paymentSatisfactionContextSchema } from "@/domain/payment-satisfaction";
import {
  activeRecoveryLinkSchema,
  downtimeContextSchema,
  normalizedPaymentSnapshotSchema,
} from "@/domain/payments";
import {
  boundedReasonSchema,
  canonicalTimestampSchema,
  caseIdSchema,
  evidenceItemSchema,
} from "@/domain/primitives";
import {
  AMBIGUOUS_CANDIDATE_ACTIONS,
  DOWNTIME_CANDIDATE_ACTIONS,
  findKnownErrorRule,
  LATE_SUCCESS_CANDIDATE_ACTIONS,
  type KnownErrorRule,
} from "@/diagnosis/known-error-rules";
import type { RecoveryAction } from "@/domain/actions";

export const knownErrorDiagnosisInputSchema = z
  .object({
    caseId: caseIdSchema,
    paymentSnapshot: normalizedPaymentSnapshotSchema,
    paymentSatisfaction: paymentSatisfactionContextSchema,
    downtimeContext: downtimeContextSchema,
    activeRecoveryLink: activeRecoveryLinkSchema,
    diagnosedAt: canonicalTimestampSchema,
  })
  .strict();

export type KnownErrorDiagnosisInput = z.infer<
  typeof knownErrorDiagnosisInputSchema
>;

type DiagnosisValues = {
  failureClass: FailureClass;
  knowledgeStatus: DiagnosisKnowledgeStatus;
  reason: z.infer<typeof boundedReasonSchema>;
  evidence: Array<z.infer<typeof evidenceItemSchema>>;
  candidateActions: readonly RecoveryAction[];
};

function withoutDuplicateLinkAction(
  actions: readonly RecoveryAction[],
  activeRecoveryLink: KnownErrorDiagnosisInput["activeRecoveryLink"],
): RecoveryAction[] {
  if (!activeRecoveryLink.exists) {
    return [...actions];
  }

  const filtered = actions.filter((action) => action !== "SEND_PAYMENT_LINK");
  if (filtered.length === 0) {
    return ["ESCALATE_HUMAN"];
  }
  return filtered;
}

function createDiagnosis(
  input: KnownErrorDiagnosisInput,
  values: DiagnosisValues,
): FailureDiagnosis {
  const evidence = [...values.evidence];
  if (input.activeRecoveryLink.exists) {
    evidence.push({
      code: "ACTIVE_RECOVERY_LINK_PRESENT",
      detail:
        "An existing recovery link was considered without exposing its identifier.",
    });
  }

  return failureDiagnosisSchema.parse({
    caseId: input.caseId,
    failureClass: values.failureClass,
    knowledgeStatus: values.knowledgeStatus,
    reason: values.reason,
    evidence,
    candidateActions: withoutDuplicateLinkAction(
      values.candidateActions,
      input.activeRecoveryLink,
    ),
    diagnosedAt: input.diagnosedAt,
  });
}

function diagnosisFromKnownRule(
  input: KnownErrorDiagnosisInput,
  rule: KnownErrorRule,
): FailureDiagnosis {
  return createDiagnosis(input, {
    failureClass: rule.failureClass,
    knowledgeStatus: "KNOWN",
    reason:
      "An exact documented structured error reason matched a deterministic rule.",
    evidence: [
      {
        code: rule.evidenceCode,
        detail:
          "The exact error_reason identifier matched the documented rule table.",
      },
    ],
    candidateActions: rule.candidateActions,
  });
}

export function diagnoseKnownPaymentFailure(
  rawInput: KnownErrorDiagnosisInput,
): FailureDiagnosis {
  const input = knownErrorDiagnosisInputSchema.parse(rawInput);
  const { paymentSatisfaction, paymentSnapshot, downtimeContext } = input;

  // Priority 1: a verified success always overrides the earlier failure
  // snapshot, including late authorization, capture, or order-paid evidence.
  if (paymentSatisfaction.status === "SATISFIED") {
    return createDiagnosis(input, {
      failureClass: "LATE_SUCCESS",
      knowledgeStatus: "KNOWN",
      reason:
        "Verified current payment satisfaction supersedes the earlier failure snapshot.",
      evidence: [
        {
          code: "VERIFIED_LATE_SUCCESS",
          detail: `Verified satisfaction basis: ${paymentSatisfaction.basis}.`,
        },
      ],
      candidateActions: LATE_SUCCESS_CANDIDATE_ACTIONS,
    });
  }

  // Priority 2: unavailable or contradictory trusted state is never guessed.
  if (paymentSatisfaction.status === "UNAVAILABLE") {
    return createDiagnosis(input, {
      failureClass: "AMBIGUOUS",
      knowledgeStatus: "UNAVAILABLE",
      reason: "Verified current payment satisfaction context is unavailable.",
      evidence: [
        {
          code: "PAYMENT_CONTEXT_UNAVAILABLE",
          detail:
            "No paid or unpaid state was inferred from unavailable context.",
        },
      ],
      candidateActions: AMBIGUOUS_CANDIDATE_ACTIONS,
    });
  }

  if (
    paymentSatisfaction.status === "CONFLICTING" ||
    paymentSnapshot.status === "AUTHORIZED" ||
    paymentSnapshot.status === "CAPTURED"
  ) {
    return createDiagnosis(input, {
      failureClass: "AMBIGUOUS",
      knowledgeStatus: "AMBIGUOUS",
      reason: "Trusted payment observations conflict and require human review.",
      evidence: [
        {
          code: "PAYMENT_CONTEXT_CONFLICT",
          detail:
            "The failure snapshot and verified satisfaction context do not safely agree.",
        },
      ],
      candidateActions: AMBIGUOUS_CANDIDATE_ACTIONS,
    });
  }

  const knownRule = findKnownErrorRule(paymentSnapshot.failure);

  // Priority 3: credible active downtime wins only when the structured failure
  // is compatible with a transient cause. Exact non-transient evidence makes
  // the combination ambiguous instead of recoverable.
  if (downtimeContext.availability === "AVAILABLE" && downtimeContext.active) {
    if (
      knownRule !== null &&
      knownRule.failureClass !== "NETWORK_OR_INTEGRATION_UNCERTAINTY" &&
      knownRule.failureClass !== "DOWNTIME_OR_TRANSIENT"
    ) {
      return createDiagnosis(input, {
        failureClass: "AMBIGUOUS",
        knowledgeStatus: "AMBIGUOUS",
        reason:
          "Active downtime conflicts with an exact non-transient failure reason.",
        evidence: [
          {
            code: "DOWNTIME_FAILURE_CONFLICT",
            detail:
              "Both transient downtime and non-transient structured evidence are present.",
          },
        ],
        candidateActions: AMBIGUOUS_CANDIDATE_ACTIONS,
      });
    }

    return createDiagnosis(input, {
      failureClass: "DOWNTIME_OR_TRANSIENT",
      knowledgeStatus: "KNOWN",
      reason:
        "Verified active downtime is compatible with the available payment evidence.",
      evidence: [
        {
          code: "VERIFIED_ACTIVE_DOWNTIME",
          detail:
            "The supplied downtime context is available, active, and non-conflicting.",
        },
      ],
      candidateActions: DOWNTIME_CANDIDATE_ACTIONS,
    });
  }

  // Priority 4: exact structured error mappings are deterministic and do not
  // consult descriptions or fuzzy text.
  if (knownRule !== null) {
    return diagnosisFromKnownRule(input, knownRule);
  }

  // Priority 5: an unavailable downtime dependency matters when no stronger
  // exact cause is available.
  if (downtimeContext.availability === "UNAVAILABLE") {
    return createDiagnosis(input, {
      failureClass: "AMBIGUOUS",
      knowledgeStatus: "UNAVAILABLE",
      reason:
        "Downtime context is unavailable and no exact structured cause matched.",
      evidence: [
        {
          code: "DOWNTIME_CONTEXT_UNAVAILABLE",
          detail: "Downtime was not guessed from missing dependency context.",
        },
      ],
      candidateActions: AMBIGUOUS_CANDIDATE_ACTIONS,
    });
  }

  // Priority 6: unknown, missing, or unsupported combinations stay ambiguous.
  return createDiagnosis(input, {
    failureClass: "AMBIGUOUS",
    knowledgeStatus: "AMBIGUOUS",
    reason:
      "No exact deterministic rule matched the structured payment evidence.",
    evidence: [
      {
        code: "NO_EXACT_ERROR_RULE",
        detail:
          "Unknown and missing error identifiers are conservatively escalated.",
      },
    ],
    candidateActions: AMBIGUOUS_CANDIDATE_ACTIONS,
  });
}
