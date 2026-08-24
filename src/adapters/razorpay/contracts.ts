import { z } from "zod";

import {
  boundedProviderValueSchema,
  boundedReasonSchema,
  canonicalTimestampSchema,
  currencyCodeSchema,
  orderIdSchema,
  payableAmountSubunitsSchema,
  paymentIdSchema,
} from "@/domain/primitives";
import {
  normalizedPaymentStatusSchema,
  paymentMethodSchema,
} from "@/domain/payments";

export const adapterResourceIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const adapterCallContextSchema = z
  .object({
    requestedAt: canonicalTimestampSchema,
    timeoutMilliseconds: z.number().int().positive().max(30_000),
  })
  .strict();

export const safeAdapterErrorCodeSchema = z.enum([
  "NOT_FOUND",
  "TIMEOUT",
  "DEPENDENCY_UNAVAILABLE",
  "INVALID_RESPONSE",
  "REFERENCE_CONFLICT",
  "OUTCOME_UNCERTAIN",
  "ALREADY_PAID",
  "PARTIALLY_PAID",
  "ALREADY_CANCELLED",
  "EXPIRED",
]);

export const adapterFailureSchema = z
  .object({
    status: z.enum([
      "NOT_FOUND",
      "TIMEOUT",
      "DEPENDENCY_UNAVAILABLE",
      "INVALID_RESPONSE",
      "OUTCOME_UNCERTAIN",
    ]),
    errorCode: safeAdapterErrorCodeSchema,
    explanation: boundedReasonSchema,
  })
  .strict();

export const fetchPaymentRequestSchema = z
  .object({ paymentId: paymentIdSchema })
  .strict();

export const adapterPaymentSchema = z
  .object({
    paymentId: paymentIdSchema,
    orderId: orderIdSchema,
    amountSubunits: payableAmountSubunitsSchema,
    currency: currencyCodeSchema,
    status: normalizedPaymentStatusSchema,
    fetchedAt: canonicalTimestampSchema,
  })
  .strict();

export const fetchPaymentResultSchema = z.discriminatedUnion("status", [
  z
    .object({ status: z.literal("AVAILABLE"), payment: adapterPaymentSchema })
    .strict(),
  z
    .object({
      status: z.literal("NOT_FOUND"),
      errorCode: z.literal("NOT_FOUND"),
      explanation: boundedReasonSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("TIMEOUT"),
      errorCode: z.literal("TIMEOUT"),
      explanation: boundedReasonSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("DEPENDENCY_UNAVAILABLE"),
      errorCode: z.literal("DEPENDENCY_UNAVAILABLE"),
      explanation: boundedReasonSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("INVALID_RESPONSE"),
      errorCode: z.literal("INVALID_RESPONSE"),
      explanation: boundedReasonSchema,
    })
    .strict(),
]);

export const fetchDowntimeRequestSchema = z
  .object({
    method: paymentMethodSchema,
    bankOrProvider: boundedProviderValueSchema.optional(),
  })
  .strict();

export const adapterDowntimeSchema = z
  .object({
    active: z.boolean(),
    method: paymentMethodSchema,
    bankOrProvider: boundedProviderValueSchema.optional(),
    observedAt: canonicalTimestampSchema,
  })
  .strict();

export const fetchDowntimeResultSchema = z.discriminatedUnion("status", [
  z
    .object({ status: z.literal("AVAILABLE"), downtime: adapterDowntimeSchema })
    .strict(),
  z
    .object({
      status: z.literal("TIMEOUT"),
      errorCode: z.literal("TIMEOUT"),
      explanation: boundedReasonSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("DEPENDENCY_UNAVAILABLE"),
      errorCode: z.literal("DEPENDENCY_UNAVAILABLE"),
      explanation: boundedReasonSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("INVALID_RESPONSE"),
      errorCode: z.literal("INVALID_RESPONSE"),
      explanation: boundedReasonSchema,
    })
    .strict(),
]);

export const createPaymentLinkRequestSchema = z
  .object({
    referenceId: adapterResourceIdSchema,
    caseReference: adapterResourceIdSchema,
    paymentId: paymentIdSchema,
    orderId: orderIdSchema,
    amountSubunits: payableAmountSubunitsSchema,
    currency: currencyCodeSchema,
    description: z.string().trim().min(1).max(200),
    expiresAt: canonicalTimestampSchema,
    requestedAt: canonicalTimestampSchema,
    metadata: z.object({ isSynthetic: z.literal(true) }).strict(),
  })
  .strict();

export const mockPaymentLinkStatusSchema = z.enum([
  "CREATED",
  "PARTIALLY_PAID",
  "PAID",
  "CANCELLED",
  "EXPIRED",
]);

export const adapterPaymentLinkSchema = z
  .object({
    externalLinkId: adapterResourceIdSchema,
    publicUrl: z
      .url()
      .refine((value) => value.startsWith("https://mock.razorpay.local/")),
    referenceId: adapterResourceIdSchema,
    caseReference: adapterResourceIdSchema,
    orderId: orderIdSchema,
    amountSubunits: payableAmountSubunitsSchema,
    currency: currencyCodeSchema,
    status: mockPaymentLinkStatusSchema,
    createdAt: canonicalTimestampSchema,
    expiresAt: canonicalTimestampSchema,
    updatedAt: canonicalTimestampSchema,
  })
  .strict();

export const createPaymentLinkResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("CREATED"),
      paymentLink: adapterPaymentLinkSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("EXISTING"),
      paymentLink: adapterPaymentLinkSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("REFERENCE_CONFLICT"),
      errorCode: z.literal("REFERENCE_CONFLICT"),
      explanation: boundedReasonSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("TIMEOUT"),
      errorCode: z.literal("OUTCOME_UNCERTAIN"),
      explanation: boundedReasonSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("DEPENDENCY_UNAVAILABLE"),
      errorCode: z.literal("DEPENDENCY_UNAVAILABLE"),
      explanation: boundedReasonSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("INVALID_RESPONSE"),
      errorCode: z.literal("INVALID_RESPONSE"),
      explanation: boundedReasonSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("PAYMENT_STATE_CHANGED"),
      errorCode: z.literal("ALREADY_PAID"),
      payment: adapterPaymentSchema,
    })
    .strict(),
]);

export const fetchPaymentLinkRequestSchema = z
  .object({ externalLinkId: adapterResourceIdSchema })
  .strict();
export const fetchPaymentLinkResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("AVAILABLE"),
      paymentLink: adapterPaymentLinkSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("NOT_FOUND"),
      errorCode: z.literal("NOT_FOUND"),
      explanation: boundedReasonSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("TIMEOUT"),
      errorCode: z.literal("TIMEOUT"),
      explanation: boundedReasonSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("DEPENDENCY_UNAVAILABLE"),
      errorCode: z.literal("DEPENDENCY_UNAVAILABLE"),
      explanation: boundedReasonSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("INVALID_RESPONSE"),
      errorCode: z.literal("INVALID_RESPONSE"),
      explanation: boundedReasonSchema,
    })
    .strict(),
]);

export const cancelPaymentLinkRequestSchema = z
  .object({
    externalLinkId: adapterResourceIdSchema,
    requestReference: adapterResourceIdSchema,
  })
  .strict();

export const cancelPaymentLinkResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("CANCELLED"),
      paymentLink: adapterPaymentLinkSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("ALREADY_CANCELLED"),
      paymentLink: adapterPaymentLinkSchema,
      errorCode: z.literal("ALREADY_CANCELLED"),
    })
    .strict(),
  z
    .object({
      status: z.literal("EXPIRED"),
      paymentLink: adapterPaymentLinkSchema,
      errorCode: z.literal("EXPIRED"),
    })
    .strict(),
  z
    .object({
      status: z.literal("ALREADY_PAID"),
      paymentLink: adapterPaymentLinkSchema,
      errorCode: z.literal("ALREADY_PAID"),
    })
    .strict(),
  z
    .object({
      status: z.literal("PARTIALLY_PAID"),
      paymentLink: adapterPaymentLinkSchema,
      errorCode: z.literal("PARTIALLY_PAID"),
    })
    .strict(),
  z
    .object({
      status: z.literal("NOT_FOUND"),
      errorCode: z.literal("NOT_FOUND"),
      explanation: boundedReasonSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("TIMEOUT"),
      errorCode: z.literal("OUTCOME_UNCERTAIN"),
      explanation: boundedReasonSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("DEPENDENCY_UNAVAILABLE"),
      errorCode: z.literal("DEPENDENCY_UNAVAILABLE"),
      explanation: boundedReasonSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("INVALID_RESPONSE"),
      errorCode: z.literal("INVALID_RESPONSE"),
      explanation: boundedReasonSchema,
    })
    .strict(),
]);

export const mockOperationSchema = z.enum([
  "FETCH_PAYMENT",
  "FETCH_DOWNTIME",
  "CREATE_PAYMENT_LINK",
  "FETCH_PAYMENT_LINK",
  "CANCEL_PAYMENT_LINK",
]);

export const mockFailureModeSchema = z.enum([
  "TIMEOUT",
  "DEPENDENCY_UNAVAILABLE",
  "INVALID_RESPONSE",
  "PAYMENT_AUTHORIZED_BEFORE_CREATE",
  "PAYMENT_CAPTURED_BEFORE_CREATE",
  "LINK_PAID_BEFORE_CANCEL",
]);

export const mockCallLogEntrySchema = z
  .object({
    sequence: z.number().int().positive(),
    operation: mockOperationSchema,
    resourceReference: adapterResourceIdSchema,
    outcome: boundedProviderValueSchema,
  })
  .strict();

export type AdapterCallContext = z.infer<typeof adapterCallContextSchema>;
export type FetchPaymentRequest = z.infer<typeof fetchPaymentRequestSchema>;
export type FetchPaymentResult = z.infer<typeof fetchPaymentResultSchema>;
export type FetchDowntimeRequest = z.infer<typeof fetchDowntimeRequestSchema>;
export type FetchDowntimeResult = z.infer<typeof fetchDowntimeResultSchema>;
export type CreatePaymentLinkRequest = z.infer<
  typeof createPaymentLinkRequestSchema
>;
export type CreatePaymentLinkResult = z.infer<
  typeof createPaymentLinkResultSchema
>;
export type FetchPaymentLinkRequest = z.infer<
  typeof fetchPaymentLinkRequestSchema
>;
export type FetchPaymentLinkResult = z.infer<
  typeof fetchPaymentLinkResultSchema
>;
export type CancelPaymentLinkRequest = z.infer<
  typeof cancelPaymentLinkRequestSchema
>;
export type CancelPaymentLinkResult = z.infer<
  typeof cancelPaymentLinkResultSchema
>;
export type AdapterPayment = z.infer<typeof adapterPaymentSchema>;
export type AdapterPaymentLink = z.infer<typeof adapterPaymentLinkSchema>;
export type MockOperation = z.infer<typeof mockOperationSchema>;
export type MockFailureMode = z.infer<typeof mockFailureModeSchema>;
export type MockCallLogEntry = z.infer<typeof mockCallLogEntrySchema>;
