import { z } from "zod";

import { fetchDowntimeRequestSchema } from "@/adapters/razorpay/contracts";
import { recoveryActionSchema } from "@/domain/actions";
import {
  boundedReasonSchema,
  canonicalTimestampSchema,
  caseIdSchema,
} from "@/domain/primitives";
import { policyDecisionSchema } from "@/domain/policy";
import { recoveryActionIntentSchema } from "@/policy/contracts";
import {
  paymentLinkRecordSchema,
  recoveryActionRecordSchema,
  recoveryCaseRecordSchema,
} from "@/repositories/contracts";

export const recoveryExecutionCommandSchema = z
  .object({
    caseRecord: recoveryCaseRecordSchema,
    decision: policyDecisionSchema,
    intent: recoveryActionIntentSchema,
    executedAt: canonicalTimestampSchema,
    timeoutMilliseconds: z.number().int().positive().max(30_000),
    linkExpiresAt: canonicalTimestampSchema.optional(),
    downtimeLookup: fetchDowntimeRequestSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.caseRecord.caseId !== value.decision.caseId) {
      context.addIssue({
        code: "custom",
        path: ["decision", "caseId"],
        message: "Policy decision must belong to the recovery case.",
      });
    }
    if (value.caseRecord.state !== value.decision.caseState) {
      context.addIssue({
        code: "custom",
        path: ["decision", "caseState"],
        message: "Policy decision case state is stale.",
      });
    }
    if (value.intent.action !== value.decision.proposedAction) {
      context.addIssue({
        code: "custom",
        path: ["intent", "action"],
        message: "Execution intent must match the policy proposal.",
      });
    }
    if ("orderId" in value.intent) {
      if (value.intent.orderId !== value.caseRecord.orderId) {
        context.addIssue({
          code: "custom",
          path: ["intent", "orderId"],
          message: "Execution intent order does not belong to the case.",
        });
      }
      if (
        value.intent.intendedAmountSubunits !==
        value.caseRecord.verifiedUnpaidAmountSubunits
      ) {
        context.addIssue({
          code: "custom",
          path: ["intent", "intendedAmountSubunits"],
          message:
            "Execution intent amount must match the verified case amount.",
        });
      }
      if (value.intent.intendedCurrency !== value.caseRecord.currency) {
        context.addIssue({
          code: "custom",
          path: ["intent", "intendedCurrency"],
          message:
            "Execution intent currency must match the verified case currency.",
        });
      }
    }
    if (
      value.decision.finalAction === "WAIT_FOR_RECOVERY" &&
      value.downtimeLookup === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["downtimeLookup"],
        message: "Waiting requires trusted downtime lookup context.",
      });
    }
  });

export const executionResultCodeSchema = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(/^[A-Z][A-Z0-9_]*$/);

const resultFields = {
  caseId: caseIdSchema,
  action: recoveryActionSchema,
  resultCode: executionResultCodeSchema,
  explanation: boundedReasonSchema,
  recoveryAction: recoveryActionRecordSchema.optional(),
  paymentLink: paymentLinkRecordSchema.optional(),
};

function executionResultVariant<T extends string>(status: T) {
  return z.object({ status: z.literal(status), ...resultFields }).strict();
}

export const recoveryExecutionResultSchema = z.discriminatedUnion("status", [
  executionResultVariant("EXECUTED"),
  executionResultVariant("IDEMPOTENT_REPLAY"),
  executionResultVariant("IN_PROGRESS"),
  executionResultVariant("ALREADY_PAID_STOPPED"),
  executionResultVariant("LINK_REUSED"),
  executionResultVariant("NO_OP_TERMINAL"),
  executionResultVariant("HUMAN_REVIEW_REQUIRED"),
  executionResultVariant("FAILED_SAFE"),
  executionResultVariant("AUDIT_INCOMPLETE"),
  executionResultVariant("POLICY_REJECTED"),
  z
    .object({
      status: z.literal("INVALID_INPUT"),
      resultCode: z.literal("INVALID_INPUT"),
      explanation: boundedReasonSchema,
    })
    .strict(),
]);

export type RecoveryExecutionCommand = z.infer<
  typeof recoveryExecutionCommandSchema
>;
export type RecoveryExecutionResult = z.infer<
  typeof recoveryExecutionResultSchema
>;
