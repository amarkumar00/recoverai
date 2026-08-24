import { z } from "zod";

import {
  aiScoringResultSchema,
  actionScoreBreakdownSchema,
} from "@/ai/contracts";
import { recoveryActionSchema } from "@/domain/actions";
import { failureDiagnosisSchema } from "@/domain/diagnosis";
import { paymentSatisfactionContextSchema } from "@/domain/payment-satisfaction";
import { paymentContextSchema } from "@/domain/payments";
import { policyDecisionSchema } from "@/domain/policy";
import {
  boundedReasonSchema,
  canonicalTimestampSchema,
  currencyCodeSchema,
  orderIdSchema,
  payableAmountSubunitsSchema,
  recoveryLinkIdSchema,
} from "@/domain/primitives";
import { policyConfigSchema } from "@/policy/config";
import {
  paymentLinkRecordSchema,
  recoveryCaseRecordSchema,
} from "@/repositories/contracts";

const linkUseSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("CREATE_NEW") }).strict(),
  z
    .object({
      mode: z.literal("USE_EXISTING"),
      recoveryLinkId: recoveryLinkIdSchema,
    })
    .strict(),
]);

const linkIntentFields = {
  orderId: orderIdSchema,
  intendedAmountSubunits: payableAmountSubunitsSchema,
  intendedCurrency: currencyCodeSchema,
  linkUse: linkUseSchema,
};

export const recoveryActionIntentSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("WAIT_FOR_RECOVERY") }).strict(),
  z
    .object({
      action: z.literal("SEND_PAYMENT_LINK"),
      ...linkIntentFields,
    })
    .strict(),
  z
    .object({
      action: z.literal("REQUEST_METHOD_CHANGE"),
      ...linkIntentFields,
    })
    .strict(),
  z
    .object({
      action: z.literal("CANCEL_RECOVERY_ALREADY_PAID"),
      recoveryLinkId: recoveryLinkIdSchema.optional(),
    })
    .strict(),
  z.object({ action: z.literal("STOP_NON_RETRYABLE") }).strict(),
  z.object({ action: z.literal("ESCALATE_HUMAN") }).strict(),
]);

export const policyEvaluationInputSchema = z
  .object({
    caseRecord: recoveryCaseRecordSchema,
    paymentContext: paymentContextSchema,
    paymentSatisfaction: paymentSatisfactionContextSchema,
    diagnosis: failureDiagnosisSchema,
    aiScoringResult: aiScoringResultSchema,
    intent: recoveryActionIntentSchema,
    totalPaymentLinksCreated: z.number().int().nonnegative().safe(),
    paymentLinks: z.array(paymentLinkRecordSchema).max(100),
    evaluatedAt: canonicalTimestampSchema,
    config: policyConfigSchema,
  })
  .strict();

export const policyInvalidInputCodeSchema = z.enum([
  "UNKNOWN_ACTION",
  "POLICY_INPUT_INVALID",
]);

const safeIssuePathSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9_.\[\]-]+$/);

export const policyFirewallResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("DECIDED"),
      decision: policyDecisionSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("INVALID_INPUT"),
      errorCode: policyInvalidInputCodeSchema,
      explanation: boundedReasonSchema,
      issuePaths: z.array(safeIssuePathSchema).min(1).max(50),
    })
    .strict(),
]);

export type RecoveryActionIntent = z.infer<typeof recoveryActionIntentSchema>;
export type PolicyEvaluationInput = z.infer<typeof policyEvaluationInputSchema>;
export type PolicyFirewallResult = z.infer<typeof policyFirewallResultSchema>;
export type PolicyInvalidInputCode = z.infer<
  typeof policyInvalidInputCodeSchema
>;
export type SelectedActionScoreBreakdown = z.infer<
  typeof actionScoreBreakdownSchema
>;

// Compile-time assurance that every intent action stays in the canonical
// allowlist; runtime validation is supplied by the discriminated union above.
export const policyIntentActionSchema = recoveryActionSchema;
