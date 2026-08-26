import { z } from "zod";

import { recoveryActionSchema } from "@/domain/actions";
import { aiRecommendationSchema } from "@/domain/ai";
import { auditEntrySchema } from "@/domain/audit";
import { simulatedEvaluationResultSchema } from "@/domain/evaluation";
import { normalizedPaymentEventSchema } from "@/domain/events";
import { normalizedPaymentSnapshotSchema } from "@/domain/payments";
import { policyDecisionSchema } from "@/domain/policy";
import {
  boundedProviderValueSchema,
  boundedReasonSchema,
  canonicalTimestampSchema,
  caseIdSchema,
  currencyCodeSchema,
  eventIdSchema,
  nonnegativeCountSchema,
  orderIdSchema,
  payableAmountSubunitsSchema,
  paymentIdSchema,
  positiveCountSchema,
  recoveryLinkIdSchema,
  syntheticCustomerHashSchema,
} from "@/domain/primitives";
import { recoveryCaseStateSchema } from "@/domain/states";

const persistenceIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const optionalTimestampSchema = canonicalTimestampSchema.optional();

export const webhookEventClaimSchema = z
  .object({
    internalEventId: eventIdSchema,
    providerEventId: eventIdSchema,
    event: normalizedPaymentEventSchema,
    payloadDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    createdAt: canonicalTimestampSchema,
    processedAt: optionalTimestampSchema,
    safeErrorReason: boundedReasonSchema.optional(),
  })
  .strict();

export const persistedWebhookEventSchema = webhookEventClaimSchema.extend({
  processingStatus: z.enum(["FIRST_SEEN", "DUPLICATE", "NOT_CHECKED"]),
});

export const paymentSnapshotOriginSchema = z.enum([
  "WEBHOOK_EVIDENCE",
  "PROVIDER_RECONCILED",
]);

export const paymentSnapshotObservationSchema = z
  .object({
    snapshot: normalizedPaymentSnapshotSchema,
    origin: paymentSnapshotOriginSchema.default("WEBHOOK_EVIDENCE"),
    observedAt: canonicalTimestampSchema,
    sourceEventId: eventIdSchema.optional(),
    createdAt: canonicalTimestampSchema,
  })
  .strict();

export const persistedPaymentSnapshotSchema =
  paymentSnapshotObservationSchema.extend({
    snapshotSequence: positiveCountSchema,
  });

export const recoveryCaseRecordSchema = z
  .object({
    caseId: caseIdSchema,
    paymentId: paymentIdSchema,
    orderId: orderIdSchema,
    syntheticCustomerHash: syntheticCustomerHashSchema,
    verifiedUnpaidAmountSubunits: payableAmountSubunitsSchema,
    currency: currencyCodeSchema,
    state: recoveryCaseStateSchema,
    attemptNumber: positiveCountSchema,
    previousSuccessCount: nonnegativeCountSchema,
    previousFailureCount: nonnegativeCountSchema,
    contactCount: nonnegativeCountSchema,
    recoveryWindowStartsAt: optionalTimestampSchema,
    recoveryWindowEndsAt: optionalTimestampSchema,
    version: positiveCountSchema,
    createdAt: canonicalTimestampSchema,
    updatedAt: canonicalTimestampSchema,
  })
  .strict()
  .refine(
    ({ recoveryWindowStartsAt, recoveryWindowEndsAt }) =>
      recoveryWindowStartsAt === undefined ||
      recoveryWindowEndsAt === undefined ||
      recoveryWindowStartsAt <= recoveryWindowEndsAt,
    {
      message: "Recovery window end cannot precede its start.",
      path: ["recoveryWindowEndsAt"],
    },
  );

export const recoveryCaseVersionUpdateSchema = z
  .object({
    caseId: caseIdSchema,
    expectedVersion: positiveCountSchema,
    state: recoveryCaseStateSchema.optional(),
    attemptNumber: positiveCountSchema.optional(),
    previousSuccessCount: nonnegativeCountSchema.optional(),
    previousFailureCount: nonnegativeCountSchema.optional(),
    contactCount: nonnegativeCountSchema.optional(),
    updatedAt: canonicalTimestampSchema,
  })
  .strict();

export const aiRecommendationRecordSchema = z
  .object({
    recommendationId: persistenceIdSchema,
    recommendation: aiRecommendationSchema,
    createdAt: canonicalTimestampSchema,
  })
  .strict();

export const policyDecisionRecordSchema = z
  .object({
    decisionId: persistenceIdSchema,
    decision: policyDecisionSchema,
    createdAt: canonicalTimestampSchema,
  })
  .strict();

export const recoveryActionStatusSchema = z.enum([
  "REQUESTED",
  "STARTED",
  "SUCCEEDED",
  "FAILED_SAFE",
  "CANCELLED",
]);

export const recoveryActionRecordSchema = z
  .object({
    actionRecordId: persistenceIdSchema,
    caseId: caseIdSchema,
    action: recoveryActionSchema,
    status: recoveryActionStatusSchema,
    idempotencyKey: persistenceIdSchema,
    attemptCount: nonnegativeCountSchema,
    safeResultCode: boundedProviderValueSchema.optional(),
    safeResultDetail: z.string().trim().min(1).max(500).optional(),
    safeErrorReason: boundedReasonSchema.optional(),
    requestedAt: canonicalTimestampSchema,
    startedAt: optionalTimestampSchema,
    completedAt: optionalTimestampSchema,
    createdAt: canonicalTimestampSchema,
    updatedAt: canonicalTimestampSchema,
  })
  .strict();

export const recoveryActionStatusUpdateSchema = z
  .object({
    actionRecordId: persistenceIdSchema,
    expectedStatus: recoveryActionStatusSchema,
    status: recoveryActionStatusSchema,
    attemptCount: nonnegativeCountSchema,
    safeResultCode: boundedProviderValueSchema.optional(),
    safeResultDetail: z.string().trim().min(1).max(500).optional(),
    safeErrorReason: boundedReasonSchema.optional(),
    startedAt: optionalTimestampSchema,
    completedAt: optionalTimestampSchema,
    updatedAt: canonicalTimestampSchema,
  })
  .strict()
  .superRefine(({ expectedStatus, status }, context) => {
    const allowed =
      (expectedStatus === "REQUESTED" &&
        ["STARTED", "FAILED_SAFE", "CANCELLED"].includes(status)) ||
      (expectedStatus === "STARTED" &&
        ["SUCCEEDED", "FAILED_SAFE", "CANCELLED"].includes(status));
    if (!allowed) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "Recovery action status transition is not allowed.",
      });
    }
  });

export const paymentLinkStatusSchema = z.enum([
  "CREATED",
  "PARTIALLY_PAID",
  "PAID",
  "CANCELLED",
  "EXPIRED",
  "FAILED_SAFE",
]);

export const paymentLinkRecordSchema = z
  .object({
    recoveryLinkId: recoveryLinkIdSchema,
    externalLinkId: persistenceIdSchema.optional(),
    caseId: caseIdSchema,
    orderId: orderIdSchema,
    referenceId: persistenceIdSchema,
    amountSubunits: payableAmountSubunitsSchema,
    currency: currencyCodeSchema,
    status: paymentLinkStatusSchema,
    blocksCreation: z.boolean(),
    createdAt: canonicalTimestampSchema,
    expiresAt: optionalTimestampSchema,
    paidAt: optionalTimestampSchema,
    cancelledAt: optionalTimestampSchema,
    updatedAt: canonicalTimestampSchema,
  })
  .strict()
  .superRefine(({ status, blocksCreation }, context) => {
    const shouldBlock = status === "CREATED" || status === "PARTIALLY_PAID";
    if (blocksCreation !== shouldBlock) {
      context.addIssue({
        code: "custom",
        path: ["blocksCreation"],
        message:
          "Created and partially paid links block replacement; terminal links do not.",
      });
    }
  });

export const paymentLinkLifecycleUpdateSchema = z
  .object({
    recoveryLinkId: recoveryLinkIdSchema,
    status: paymentLinkStatusSchema,
    blocksCreation: z.boolean(),
    externalLinkId: persistenceIdSchema.optional(),
    expiresAt: optionalTimestampSchema,
    paidAt: optionalTimestampSchema,
    cancelledAt: optionalTimestampSchema,
    updatedAt: canonicalTimestampSchema,
  })
  .strict()
  .superRefine(({ status, blocksCreation }, context) => {
    const shouldBlock = status === "CREATED" || status === "PARTIALLY_PAID";
    if (blocksCreation !== shouldBlock) {
      context.addIssue({
        code: "custom",
        path: ["blocksCreation"],
        message:
          "Created and partially paid links block replacement; terminal links do not.",
      });
    }
  });

export const evaluationRunRecordSchema = z
  .object({
    result: simulatedEvaluationResultSchema,
    createdAt: canonicalTimestampSchema,
  })
  .strict();

export const persistedAuditEntrySchema = auditEntrySchema;

export type WebhookEventClaim = z.infer<typeof webhookEventClaimSchema>;
export type PersistedWebhookEvent = z.infer<typeof persistedWebhookEventSchema>;
export type PaymentSnapshotOrigin = z.infer<typeof paymentSnapshotOriginSchema>;
export type PaymentSnapshotObservation = z.input<
  typeof paymentSnapshotObservationSchema
>;
export type PersistedPaymentSnapshot = z.infer<
  typeof persistedPaymentSnapshotSchema
>;
export type RecoveryCaseRecord = z.infer<typeof recoveryCaseRecordSchema>;
export type RecoveryCaseVersionUpdate = z.infer<
  typeof recoveryCaseVersionUpdateSchema
>;
export type AiRecommendationRecord = z.infer<
  typeof aiRecommendationRecordSchema
>;
export type PolicyDecisionRecord = z.infer<typeof policyDecisionRecordSchema>;
export type RecoveryActionRecord = z.infer<typeof recoveryActionRecordSchema>;
export type RecoveryActionStatusUpdate = z.infer<
  typeof recoveryActionStatusUpdateSchema
>;
export type PaymentLinkRecord = z.infer<typeof paymentLinkRecordSchema>;
export type PaymentLinkLifecycleUpdate = z.infer<
  typeof paymentLinkLifecycleUpdateSchema
>;
export type EvaluationRunRecord = z.infer<typeof evaluationRunRecordSchema>;
