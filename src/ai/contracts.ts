import { z } from "zod";

import { RECOVERY_ACTIONS, recoveryActionSchema } from "@/domain/actions";
import { aiRecommendationSchema } from "@/domain/ai";
import { failureDiagnosisSchema } from "@/domain/diagnosis";
import { paymentContextSchema } from "@/domain/payments";
import {
  amountSubunitsSchema,
  boundedExplanationSchema,
  boundedReasonSchema,
  canonicalTimestampSchema,
  caseIdSchema,
  currencyCodeSchema,
  evidenceItemSchema,
  nonnegativeCountSchema,
} from "@/domain/primitives";

export const PROBABILITY_SCALE_MILLIONTHS = 1_000_000;

export const probabilityMillionthsSchema = z
  .number()
  .int()
  .min(0)
  .max(PROBABILITY_SCALE_MILLIONTHS);

export const actionPenaltySchema = z
  .object({
    contactCostSubunits: amountSubunitsSchema,
    frictionPenaltySubunits: amountSubunitsSchema,
    duplicatePaymentRiskPenaltySubunits: amountSubunitsSchema,
    operationalCostSubunits: amountSubunitsSchema,
  })
  .strict();

const actionPenaltyEntries = Object.fromEntries(
  RECOVERY_ACTIONS.map((action) => [action, actionPenaltySchema]),
) as Record<(typeof RECOVERY_ACTIONS)[number], typeof actionPenaltySchema>;

export const trustedScoringConfigSchema = z
  .object({
    providerTimeoutMilliseconds: z.number().int().positive().max(30_000),
    actionPenalties: z.object(actionPenaltyEntries).strict(),
  })
  .strict();

export const aiScorerInputSchema = z
  .object({
    caseId: caseIdSchema,
    seed: z.string().trim().min(1).max(128),
    recommendedAt: canonicalTimestampSchema,
    paymentContext: paymentContextSchema,
    diagnosis: failureDiagnosisSchema,
    scoringConfig: trustedScoringConfigSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (input.paymentContext.caseId !== input.caseId) {
      context.addIssue({
        code: "custom",
        path: ["paymentContext", "caseId"],
        message: "Payment context must belong to the scorer case.",
      });
    }
    if (input.diagnosis.caseId !== input.caseId) {
      context.addIssue({
        code: "custom",
        path: ["diagnosis", "caseId"],
        message: "Diagnosis must belong to the scorer case.",
      });
    }
  });

// This is the complete provider-visible context. It deliberately excludes
// amount, currency, customer hash, payment/order/link identifiers, routes,
// idempotency keys, policy state, and Digital Twin outcomes.
export const aiProviderInputSchema = z
  .object({
    caseId: caseIdSchema,
    seed: z.string().trim().min(1).max(128),
    failureClass: failureDiagnosisSchema.shape.failureClass,
    knowledgeStatus: failureDiagnosisSchema.shape.knowledgeStatus,
    candidateActions: z.array(recoveryActionSchema).min(1).max(6),
    previousContactCount: nonnegativeCountSchema,
    activeRecoveryLinkExists: z.boolean(),
    paymentMethod: paymentContextSchema.shape.method,
  })
  .strict()
  .superRefine(({ candidateActions }, context) => {
    if (new Set(candidateActions).size !== candidateActions.length) {
      context.addIssue({
        code: "custom",
        path: ["candidateActions"],
        message: "Provider candidate actions must be unique.",
      });
    }
  });

const forbiddenCustomerMessagePatterns = [
  /\b(?:pay|order|case|link|customer)_[A-Za-z0-9._:-]+\b/i,
  /\b[A-Fa-f0-9]{64}\b/,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /(?:\+?\d[\d\s().-]{8,}\d)/,
  /\b(?:error[_\s-]?code|risk score|internal risk|guaranteed?|your fault|you failed)\b/i,
];

export const customerSafeMessageSchema = boundedExplanationSchema.refine(
  (message) =>
    forbiddenCustomerMessagePatterns.every((pattern) => !pattern.test(message)),
  "Customer-safe messages cannot contain identifiers, contact details, internal risk language, blame, error codes, or guarantees.",
);

export const aiProviderActionEstimateSchema = z
  .object({
    action: recoveryActionSchema,
    recoveryProbabilityMillionths: probabilityMillionthsSchema,
    reason: boundedReasonSchema,
    evidence: z.array(evidenceItemSchema).min(1).max(10),
  })
  .strict();

export const aiProviderOutputSchema = z
  .object({
    estimates: z.array(aiProviderActionEstimateSchema).min(1).max(6),
    confidenceMillionths: probabilityMillionthsSchema,
    merchantExplanation: boundedExplanationSchema,
    customerSafeMessage: customerSafeMessageSchema.optional(),
    contextStatus: z.enum(["SUFFICIENT", "INSUFFICIENT"]),
    escalationRecommended: z.boolean(),
  })
  .strict()
  .superRefine(
    ({ estimates, contextStatus, escalationRecommended }, context) => {
      const actions = estimates.map((estimate) => estimate.action);
      if (new Set(actions).size !== actions.length) {
        context.addIssue({
          code: "custom",
          path: ["estimates"],
          message: "Provider action estimates must be unique.",
        });
      }
      if (contextStatus === "INSUFFICIENT" && !escalationRecommended) {
        context.addIssue({
          code: "custom",
          path: ["escalationRecommended"],
          message: "Insufficient provider context must recommend escalation.",
        });
      }
    },
  );

export const actionScoreBreakdownSchema = z
  .object({
    action: recoveryActionSchema,
    recoveryProbabilityMillionths: probabilityMillionthsSchema,
    expectedRecoveredSubunits: amountSubunitsSchema,
    contactCostSubunits: amountSubunitsSchema,
    frictionPenaltySubunits: amountSubunitsSchema,
    duplicatePaymentRiskPenaltySubunits: amountSubunitsSchema,
    operationalCostSubunits: amountSubunitsSchema,
    totalPenaltySubunits: amountSubunitsSchema,
    expectedValueSubunits: z.number().int().safe(),
    currency: currencyCodeSchema,
  })
  .strict();

export const safeFallbackReasonSchema = z.enum([
  "TIMEOUT",
  "MALFORMED_OUTPUT",
  "PROVIDER_ERROR",
  "INSUFFICIENT_CONTEXT",
  "NO_VALID_CANDIDATE",
  "ARITHMETIC_OUT_OF_RANGE",
]);

const successfulScoringResultSchema = z
  .object({
    status: z.literal("SUCCESS"),
    recommendation: aiRecommendationSchema,
    scoreBreakdowns: z.array(actionScoreBreakdownSchema).min(1).max(6),
  })
  .strict();

const safeFallbackScoringResultSchema = z
  .object({
    status: z.literal("SAFE_FALLBACK"),
    fallbackReason: safeFallbackReasonSchema,
    recommendation: aiRecommendationSchema,
    scoreBreakdowns: z.tuple([]),
  })
  .strict();

export const aiScoringResultSchema = z.discriminatedUnion("status", [
  successfulScoringResultSchema,
  safeFallbackScoringResultSchema,
]);

export type ActionPenalty = z.infer<typeof actionPenaltySchema>;
export type TrustedScoringConfig = z.infer<typeof trustedScoringConfigSchema>;
export type AiScorerInput = z.infer<typeof aiScorerInputSchema>;
export type AiProviderInput = z.infer<typeof aiProviderInputSchema>;
export type AiProviderActionEstimate = z.infer<
  typeof aiProviderActionEstimateSchema
>;
export type AiProviderOutput = z.infer<typeof aiProviderOutputSchema>;
export type ActionScoreBreakdown = z.infer<typeof actionScoreBreakdownSchema>;
export type SafeFallbackReason = z.infer<typeof safeFallbackReasonSchema>;
export type AiScoringResult = z.infer<typeof aiScoringResultSchema>;
