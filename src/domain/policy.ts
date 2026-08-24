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
  .superRefine(({ outcome, finalAction }, context) => {
    if (outcome === "APPROVED" && finalAction === undefined) {
      context.addIssue({
        code: "custom",
        path: ["finalAction"],
        message: "Approved decisions require a final action.",
      });
    }
  });

export type PolicyOutcome = z.infer<typeof policyOutcomeSchema>;
export type PolicyCheck = z.infer<typeof policyCheckSchema>;
export type PolicyDecision = z.infer<typeof policyDecisionSchema>;
