import { z } from "zod";

import {
  boundedProviderValueSchema,
  boundedReasonSchema,
  canonicalTimestampSchema,
  caseIdSchema,
  moneySchema,
  nonnegativeCountSchema,
  orderIdSchema,
  payableMoneySchema,
  paymentIdSchema,
  positiveCountSchema,
  recoveryLinkIdSchema,
  syntheticCustomerHashSchema,
} from "@/domain/primitives";

export const NORMALIZED_PAYMENT_STATUSES = [
  "CREATED",
  "AUTHORIZED",
  "CAPTURED",
  "FAILED",
  "UNKNOWN",
] as const;

export const normalizedPaymentStatusSchema = z.enum(
  NORMALIZED_PAYMENT_STATUSES,
);

export const paymentMethodSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[a-z][a-z0-9_]*$/);

export const failureContextSchema = z
  .object({
    errorCode: boundedProviderValueSchema.optional(),
    errorDescription: z.string().trim().min(1).max(1_000).optional(),
    errorSource: boundedProviderValueSchema.optional(),
    errorStep: boundedProviderValueSchema.optional(),
    errorReason: boundedProviderValueSchema.optional(),
  })
  .strict()
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    {
      message: "Failure context must include at least one failure field.",
    },
  );

export const downtimeContextSchema = z.discriminatedUnion("availability", [
  z
    .object({
      availability: z.literal("AVAILABLE"),
      active: z.boolean(),
      severity: boundedProviderValueSchema.optional(),
      bankOrProvider: boundedProviderValueSchema.optional(),
      observedAt: canonicalTimestampSchema,
    })
    .strict(),
  z
    .object({
      availability: z.literal("UNAVAILABLE"),
      reason: boundedReasonSchema,
      checkedAt: canonicalTimestampSchema,
    })
    .strict(),
]);

export const reconciledPaymentStateSchema = z.discriminatedUnion(
  "availability",
  [
    z
      .object({
        availability: z.literal("AVAILABLE"),
        status: normalizedPaymentStatusSchema,
        fetchedAt: canonicalTimestampSchema,
      })
      .strict(),
    z
      .object({
        availability: z.literal("UNAVAILABLE"),
        reason: boundedReasonSchema,
        checkedAt: canonicalTimestampSchema,
      })
      .strict(),
  ],
);

export const activeRecoveryLinkSchema = z.discriminatedUnion("exists", [
  z.object({ exists: z.literal(false) }).strict(),
  z
    .object({
      exists: z.literal(true),
      recoveryLinkId: recoveryLinkIdSchema,
    })
    .strict(),
]);

export const normalizedPaymentSnapshotSchema = z
  .object({
    paymentId: paymentIdSchema,
    orderId: orderIdSchema,
    money: moneySchema,
    status: normalizedPaymentStatusSchema,
    method: paymentMethodSchema,
    bankOrProvider: boundedProviderValueSchema.optional(),
    failure: failureContextSchema.optional(),
    paymentCreatedAt: canonicalTimestampSchema,
  })
  .strict();

export const paymentContextSchema = normalizedPaymentSnapshotSchema
  .extend({
    caseId: caseIdSchema,
    syntheticCustomerHash: syntheticCustomerHashSchema,
    money: payableMoneySchema,
    attemptNumber: positiveCountSchema,
    previousSuccessCount: nonnegativeCountSchema,
    previousFailureCount: nonnegativeCountSchema,
    previousContactCount: nonnegativeCountSchema,
    eventCreatedAt: canonicalTimestampSchema,
    currentReconciledState: reconciledPaymentStateSchema,
    activeRecoveryLink: activeRecoveryLinkSchema,
    downtimeContext: downtimeContextSchema,
  })
  .strict();

export type NormalizedPaymentStatus = z.infer<
  typeof normalizedPaymentStatusSchema
>;
export type FailureContext = z.infer<typeof failureContextSchema>;
export type DowntimeContext = z.infer<typeof downtimeContextSchema>;
export type ReconciledPaymentState = z.infer<
  typeof reconciledPaymentStateSchema
>;
export type ActiveRecoveryLink = z.infer<typeof activeRecoveryLinkSchema>;
export type NormalizedPaymentSnapshot = z.infer<
  typeof normalizedPaymentSnapshotSchema
>;
export type PaymentContext = z.infer<typeof paymentContextSchema>;
