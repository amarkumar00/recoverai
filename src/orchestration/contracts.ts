import { z } from "zod";

import { actionScoreBreakdownSchema } from "@/ai";
import { recoveryActionSchema } from "@/domain/actions";
import { failureClassSchema } from "@/domain/diagnosis";
import { normalizedPaymentStatusSchema } from "@/domain/payments";
import { policyCheckSchema, policyOutcomeSchema } from "@/domain/policy";
import {
  boundedReasonSchema,
  canonicalTimestampSchema,
  caseIdSchema,
  currencyCodeSchema,
  evidenceItemSchema,
  nonnegativeCountSchema,
  orderIdSchema,
  payableAmountSubunitsSchema,
  paymentIdSchema,
  unitIntervalSchema,
} from "@/domain/primitives";
import { recoveryCaseStateSchema } from "@/domain/states";
import {
  paymentLinkStatusSchema,
  recoveryActionStatusSchema,
} from "@/repositories/contracts";

const safeTimelineEntrySchema = z
  .object({
    entryId: z.string().min(1).max(128),
    sequence: z.number().int().positive(),
    timestamp: canonicalTimestampSchema,
    actor: z.string().min(1).max(64),
    eventType: z.string().min(1).max(64),
    reason: boundedReasonSchema,
    previousState: recoveryCaseStateSchema.nullable(),
    newState: recoveryCaseStateSchema.nullable(),
  })
  .strict();

const safeDiagnosisSchema = z
  .object({
    failureClass: failureClassSchema,
    reason: boundedReasonSchema,
    evidence: z.array(evidenceItemSchema).max(20),
  })
  .strict();

const safeAiRecommendationSchema = z
  .object({
    selectedAction: recoveryActionSchema,
    confidence: unitIntervalSchema,
    rankedActions: z
      .array(
        z
          .object({
            rank: z.number().int().min(1).max(6),
            action: recoveryActionSchema,
            recoveryProbability: unitIntervalSchema,
            reason: boundedReasonSchema,
          })
          .strict(),
      )
      .max(6),
  })
  .strict();

const safePolicySchema = z
  .object({
    proposedAction: recoveryActionSchema,
    finalAction: recoveryActionSchema.nullable(),
    outcome: policyOutcomeSchema,
    primaryRule: z.string().min(1).max(64),
    reason: boundedReasonSchema,
    checks: z.array(policyCheckSchema).max(50),
  })
  .strict();

const safeLinkSchema = z
  .object({
    recoveryLinkId: z.string().min(1).max(128),
    status: paymentLinkStatusSchema,
    amountSubunits: payableAmountSubunitsSchema,
    currency: currencyCodeSchema,
    createdAt: canonicalTimestampSchema,
    paidAt: canonicalTimestampSchema.optional(),
  })
  .strict();

const unsafeProofSchema = z
  .object({
    verifiedAllowedAmountSubunits: payableAmountSubunitsSchema,
    proposedUnsafeAmountSubunits: payableAmountSubunitsSchema,
    rejectingBoundary: z.literal("DETERMINISTIC_POLICY_FIREWALL"),
    rejectingRule: z.literal("INTENT_MONEY_INTEGRITY"),
    finalOutcome: z.literal("ESCALATED"),
    noActionExecuted: z.literal(true),
  })
  .strict();

export const demoCaseReadModelSchema = z
  .object({
    mode: z.literal("SYNTHETIC_DEMO"),
    scenario: z.enum(["PRIMARY_RECOVERY", "UNSAFE_AMOUNT_PROBE"]),
    sourceBoundary: z.literal("Trusted Synthetic Demo Event"),
    signatureStatus: z.literal("NOT_CHECKED"),
    productionReady: z.literal(false),
    movesRealMoney: z.literal(false),
    caseId: caseIdSchema,
    paymentId: paymentIdSchema,
    orderId: orderIdSchema,
    simulatedAmountSubunits: payableAmountSubunitsSchema,
    currency: currencyCodeSchema,
    currentCaseState: recoveryCaseStateSchema.nullable(),
    latestPaymentState: normalizedPaymentStatusSchema.nullable(),
    currentFetchedPaymentState: normalizedPaymentStatusSchema.nullable(),
    downtimeContext: z
      .object({
        availability: z.enum(["AVAILABLE", "UNAVAILABLE"]),
        active: z.boolean().nullable(),
        explanation: boundedReasonSchema,
      })
      .strict(),
    paymentTimeline: z.array(
      z
        .object({
          observedAt: canonicalTimestampSchema,
          origin: z.enum(["WEBHOOK_EVIDENCE", "PROVIDER_RECONCILED"]),
          status: normalizedPaymentStatusSchema,
        })
        .strict(),
    ),
    diagnosis: safeDiagnosisSchema.optional(),
    aiRecommendation: safeAiRecommendationSchema.optional(),
    expectedValueBreakdown: z.array(actionScoreBreakdownSchema).max(6),
    policy: safePolicySchema.optional(),
    recoveryAction: z
      .object({
        action: recoveryActionSchema,
        status: recoveryActionStatusSchema,
        resultCode: z.string().min(1).max(64).optional(),
      })
      .strict()
      .optional(),
    paymentLink: safeLinkSchema.optional(),
    customerContactCount: nonnegativeCountSchema,
    finalSimulatedOutcome: z.string().trim().min(1).max(200),
    recoveryStoppedAfterPaymentSuccess: z.boolean(),
    timeline: z.array(safeTimelineEntrySchema).max(100),
    auditVerification: z.discriminatedUnion("status", [
      z
        .object({
          status: z.literal("VALID"),
          entryCount: nonnegativeCountSchema,
        })
        .strict(),
      z
        .object({
          status: z.literal("INVALID"),
          issue: z.string().min(1).max(64),
        })
        .strict(),
    ]),
    workflowStage: z.enum([
      "NOT_STARTED",
      "DETECTED",
      "VERIFYING",
      "DIAGNOSED",
      "AWAITING_POLICY",
      "READY_FOR_SIMULATED_PAYMENT",
      "RECOVERED_STOPPED",
      "UNSAFE_ACTION_BLOCKED",
      "ERROR_SAFE",
    ]),
    controls: z
      .object({
        canStartOrResume: z.boolean(),
        canMarkMockLinkPaid: z.boolean(),
        canRunUnsafeProbe: z.boolean(),
        noFurtherAction: z.boolean(),
      })
      .strict(),
    unsafeProof: unsafeProofSchema.optional(),
    operation: z
      .object({
        status: z.enum([
          "READY",
          "EXECUTED",
          "IDEMPOTENT_REPLAY",
          "ALREADY_COMPLETE",
          "BLOCKED_SAFE",
          "ERROR_SAFE",
          "TEST_INTERRUPTED",
        ]),
        resultCode: z.string().min(1).max(64),
        explanation: boundedReasonSchema,
      })
      .strict(),
  })
  .strict();

export const demoDashboardReadModelSchema = z
  .object({
    primary: demoCaseReadModelSchema,
    unsafe: demoCaseReadModelSchema,
  })
  .strict();

export const emptyDemoMutationBodySchema = z.object({}).strict();

export type DemoCaseReadModel = z.infer<typeof demoCaseReadModelSchema>;
export type DemoDashboardReadModel = z.infer<
  typeof demoDashboardReadModelSchema
>;
