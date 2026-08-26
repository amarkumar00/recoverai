import { z } from "zod";

import { trustedScoringConfigSchema } from "@/ai/contracts";
import { recoveryActionSchema } from "@/domain/actions";
import { simulatedEvaluationResultSchema } from "@/domain/evaluation";
import { paymentSatisfactionContextSchema } from "@/domain/payment-satisfaction";
import {
  activeRecoveryLinkSchema,
  reconciledPaymentStateSchema,
} from "@/domain/payments";
import {
  canonicalTimestampSchema,
  caseIdSchema,
  orderIdSchema,
  payableMoneySchema,
  paymentIdSchema,
} from "@/domain/primitives";
import { policyConfigSchema } from "@/policy/config";

export const EVALUATION_POLICY_VERSION =
  "recoverai-evaluation-policy-v1" as const;
export const BASELINE_POLICY_VERSION =
  "generic-payment-link-after-15-minutes-v1" as const;
export const EVALUATION_COMPLETED_AT = "2026-08-28T00:00:00.000Z" as const;
export const BASELINE_WAIT_MILLISECONDS = 15 * 60 * 1_000;
export const PROCESSING_TIME_MODEL =
  "SIMULATED_DETERMINISTIC_LOGICAL_V1" as const;

export const baselineSelectionInputSchema = z
  .object({
    caseId: caseIdSchema,
    paymentId: paymentIdSchema,
    orderId: orderIdSchema,
    money: payableMoneySchema,
    failureObservedAt: canonicalTimestampSchema,
    decisionAt: canonicalTimestampSchema,
    paymentSatisfaction: paymentSatisfactionContextSchema,
    currentReconciledState: reconciledPaymentStateSchema,
    activeRecoveryLink: activeRecoveryLinkSchema,
  })
  .strict();

export const baselineSelectionSchema = z
  .object({
    caseId: caseIdSchema,
    selectedAction: recoveryActionSchema,
    decisionAt: canonicalTimestampSchema,
    createsPaymentLink: z.boolean(),
    customerContactCount: z.number().int().nonnegative().safe(),
    disposition: z.enum([
      "GENERIC_LINK_CREATED",
      "GENERIC_EXISTING_LINK_REUSED",
      "NO_INTERVENTION_ALREADY_PAID",
      "ESCALATED_UNAVAILABLE_OR_CONFLICTING",
    ]),
    reasonCode: z.enum([
      "ELIGIBLE_UNPAID_GENERIC_LINK",
      "ELIGIBLE_UNPAID_EXISTING_LINK",
      "VERIFIED_ALREADY_PAID",
      "PAYMENT_STATE_UNAVAILABLE",
      "PAYMENT_STATE_CONFLICTING",
    ]),
  })
  .strict()
  .superRefine((value, context) => {
    const linkAction = value.selectedAction === "SEND_PAYMENT_LINK";
    if (linkAction !== (value.customerContactCount === 1)) {
      context.addIssue({
        code: "custom",
        path: ["customerContactCount"],
        message: "Only the generic Payment Link baseline contacts a customer.",
      });
    }
    if (value.createsPaymentLink && !linkAction) {
      context.addIssue({
        code: "custom",
        path: ["createsPaymentLink"],
        message: "Only the generic Payment Link action can create a link.",
      });
    }
  });

export const evaluationConfigurationSchema = z
  .object({
    evaluationPolicyVersion: z.literal(EVALUATION_POLICY_VERSION),
    baselinePolicyVersion: z.literal(BASELINE_POLICY_VERSION),
    completedAt: canonicalTimestampSchema,
    scoringConfig: trustedScoringConfigSchema,
    policyConfig: policyConfigSchema,
  })
  .strict();

export const goldenEvaluationReportSchema = z
  .object({
    title: z.literal("RecoverAI Held-Out Digital Twin Evaluation"),
    simulationLabel: z.literal("SIMULATED"),
    result: simulatedEvaluationResultSchema,
    baselineDefinition: z.string().trim().min(1).max(1_000),
    recoverAiDefinition: z.string().trim().min(1).max(1_000),
    metricDefinitions: z.array(z.string().trim().min(1).max(1_000)).min(1),
    knownLimitations: z.array(z.string().trim().min(1).max(1_000)).min(1),
  })
  .strict();

export type BaselineSelectionInput = z.infer<
  typeof baselineSelectionInputSchema
>;
export type BaselineSelection = z.infer<typeof baselineSelectionSchema>;
export type EvaluationConfiguration = z.infer<
  typeof evaluationConfigurationSchema
>;
export type GoldenEvaluationReport = z.infer<
  typeof goldenEvaluationReportSchema
>;
