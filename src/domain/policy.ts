import { z } from "zod";

import { recoveryActionSchema } from "@/domain/actions";
import {
  boundedReasonSchema,
  canonicalTimestampSchema,
  caseIdSchema,
} from "@/domain/primitives";
import { recoveryCaseStateSchema } from "@/domain/states";

export const policyOutcomeSchema = z.enum([
  "APPROVED",
  "BLOCKED",
  "ESCALATED",
  "STOPPED",
]);

export const policyRuleIdSchema = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(/^[A-Z][A-Z0-9_]*$/);

export const policyCheckSchema = z
  .object({
    ruleId: policyRuleIdSchema,
    status: z.enum(["PASSED", "FAILED", "NOT_APPLICABLE"]),
    reason: boundedReasonSchema,
  })
  .strict();

export const policyDecisionSchema = z
  .object({
    caseId: caseIdSchema,
    proposedAction: recoveryActionSchema,
    finalAction: recoveryActionSchema.optional(),
    outcome: policyOutcomeSchema,
    ruleId: policyRuleIdSchema,
    reason: boundedReasonSchema,
    checksPerformed: z.array(policyCheckSchema).min(1).max(50),
    caseState: recoveryCaseStateSchema,
    decidedAt: canonicalTimestampSchema,
  })
  .strict()
  .superRefine(
    (
      { outcome, proposedAction, finalAction, ruleId, checksPerformed },
      context,
    ) => {
      const primaryChecks = checksPerformed.filter(
        (check) => check.ruleId === ruleId,
      );
      if (primaryChecks.length !== 1) {
        context.addIssue({
          code: "custom",
          path: ["checksPerformed"],
          message:
            "The primary policy rule must appear exactly once in checks.",
        });
      }

      const checkRuleIds = checksPerformed.map((check) => check.ruleId);
      if (new Set(checkRuleIds).size !== checkRuleIds.length) {
        context.addIssue({
          code: "custom",
          path: ["checksPerformed"],
          message: "Policy check rule IDs must be unique.",
        });
      }

      if (outcome === "APPROVED" && finalAction !== proposedAction) {
        context.addIssue({
          code: "custom",
          path: ["finalAction"],
          message: "Approved decisions must preserve the proposed action.",
        });
      }
      if (outcome === "BLOCKED" && finalAction !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["finalAction"],
          message: "Blocked decisions cannot authorize a final action.",
        });
      }
      if (outcome === "ESCALATED" && finalAction !== "ESCALATE_HUMAN") {
        context.addIssue({
          code: "custom",
          path: ["finalAction"],
          message: "Escalated decisions must finalize to human escalation.",
        });
      }
      if (
        outcome === "STOPPED" &&
        finalAction !== "CANCEL_RECOVERY_ALREADY_PAID" &&
        finalAction !== "STOP_NON_RETRYABLE"
      ) {
        context.addIssue({
          code: "custom",
          path: ["finalAction"],
          message: "Stopped decisions require a canonical stopping action.",
        });
      }
      if (outcome === "APPROVED" && finalAction === undefined) {
        context.addIssue({
          code: "custom",
          path: ["finalAction"],
          message: "Approved decisions require a final action.",
        });
      }
    },
  );

export type PolicyOutcome = z.infer<typeof policyOutcomeSchema>;
export type PolicyCheck = z.infer<typeof policyCheckSchema>;
export type PolicyDecision = z.infer<typeof policyDecisionSchema>;
