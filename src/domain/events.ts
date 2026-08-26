import { z } from "zod";

import {
  boundedProviderValueSchema,
  boundedReasonSchema,
  canonicalTimestampSchema,
  currencyCodeSchema,
  eventIdSchema,
  orderIdSchema,
  paymentIdSchema,
  recoveryLinkIdSchema,
  unixTimestampSecondsSchema,
} from "@/domain/primitives";
import {
  normalizedPaymentSnapshotSchema,
  paymentMethodSchema,
} from "@/domain/payments";

export const SUPPORTED_WEBHOOK_EVENT_NAMES = [
  "payment.failed",
  "payment.authorized",
  "payment.captured",
  "order.paid",
  "payment.downtime.started",
  "payment.downtime.resolved",
  "payment.downtime.updated",
  "payment_link.paid",
  "payment_link.partially_paid",
  "payment_link.cancelled",
  "payment_link.expired",
] as const;

export const supportedWebhookEventNameSchema = z.enum(
  SUPPORTED_WEBHOOK_EVENT_NAMES,
);

const externalProviderIdSchema = z.string().trim().min(1).max(128);
const nullableProviderValueSchema = boundedProviderValueSchema.nullable();

// External provider objects intentionally preserve additional fields. Only
// explicitly declared fields may be copied into strict internal contracts.
export const razorpayStyleExternalPaymentEntitySchema = z
  .object({
    id: externalProviderIdSchema,
    order_id: externalProviderIdSchema.nullable(),
    amount: z.number().int().nonnegative().safe(),
    currency: currencyCodeSchema,
    status: boundedProviderValueSchema,
    method: paymentMethodSchema,
    bank: nullableProviderValueSchema.optional(),
    wallet: nullableProviderValueSchema.optional(),
    error_code: nullableProviderValueSchema.optional(),
    error_description: z
      .string()
      .trim()
      .min(1)
      .max(1_000)
      .nullable()
      .optional(),
    error_source: nullableProviderValueSchema.optional(),
    error_step: nullableProviderValueSchema.optional(),
    error_reason: nullableProviderValueSchema.optional(),
    created_at: unixTimestampSecondsSchema,
  })
  .passthrough();

export const razorpayStyleExternalOrderEntitySchema = z
  .object({
    id: externalProviderIdSchema,
    amount: z.number().int().nonnegative().safe(),
    amount_paid: z.number().int().nonnegative().safe(),
    currency: currencyCodeSchema,
    status: boundedProviderValueSchema,
  })
  .passthrough();

export const razorpayStyleExternalPaymentLinkEntitySchema = z
  .object({
    id: externalProviderIdSchema,
    amount: z.number().int().nonnegative().safe(),
    amount_paid: z.number().int().nonnegative().safe(),
    currency: currencyCodeSchema,
    status: boundedProviderValueSchema,
    reference_id: externalProviderIdSchema,
  })
  .passthrough();

export const razorpayStyleExternalDowntimeEntitySchema = z
  .object({
    id: externalProviderIdSchema,
    entity: z.literal("payment.downtime"),
    method: paymentMethodSchema,
    status: boundedProviderValueSchema,
    begin: unixTimestampSecondsSchema,
    end: unixTimestampSecondsSchema.nullable().optional(),
  })
  .passthrough();

const externalWebhookPayloadSchema = z
  .object({
    payment: z
      .object({ entity: razorpayStyleExternalPaymentEntitySchema })
      .passthrough()
      .optional(),
    order: z
      .object({ entity: razorpayStyleExternalOrderEntitySchema })
      .passthrough()
      .optional(),
    payment_link: z
      .object({ entity: razorpayStyleExternalPaymentLinkEntitySchema })
      .passthrough()
      .optional(),
    payment_downtime: z
      .object({ entity: razorpayStyleExternalDowntimeEntitySchema })
      .passthrough()
      .optional(),
  })
  .passthrough()
  .refine(
    ({
      payment,
      order,
      payment_link: paymentLink,
      payment_downtime: downtime,
    }) =>
      payment !== undefined ||
      order !== undefined ||
      paymentLink !== undefined ||
      downtime !== undefined,
    { message: "Webhook payload must contain a relevant entity." },
  );

export const razorpayStyleExternalWebhookEnvelopeSchema = z
  .object({
    entity: z.literal("event"),
    account_id: externalProviderIdSchema.optional(),
    event: z.string().trim().min(1).max(128),
    contains: z.array(z.string().trim().min(1).max(64)).min(1).max(16),
    payload: externalWebhookPayloadSchema,
    created_at: unixTimestampSecondsSchema,
  })
  .passthrough();

export const signatureVerificationResultSchema = z.discriminatedUnion(
  "status",
  [
    z.object({ status: z.literal("VERIFIED") }).strict(),
    z
      .object({
        status: z.literal("REJECTED"),
        reason: boundedReasonSchema,
      })
      .strict(),
    z.object({ status: z.literal("NOT_CHECKED") }).strict(),
  ],
);

export const duplicateProcessingResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("FIRST_SEEN") }).strict(),
  z
    .object({
      status: z.literal("DUPLICATE"),
      firstProcessedAt: canonicalTimestampSchema,
    })
    .strict(),
  z.object({ status: z.literal("NOT_CHECKED") }).strict(),
]);

export const normalizedPaymentLinkWebhookSnapshotSchema = z
  .object({
    externalLinkId: externalProviderIdSchema,
    referenceId: externalProviderIdSchema,
    amountSubunits: z.number().int().nonnegative().safe(),
    amountPaidSubunits: z.number().int().nonnegative().safe(),
    currency: currencyCodeSchema,
    status: z.enum(["PAID", "PARTIALLY_PAID", "CANCELLED", "EXPIRED"]),
  })
  .strict();

export const normalizedDowntimeWebhookSnapshotSchema = z
  .object({
    downtimeId: externalProviderIdSchema,
    method: paymentMethodSchema,
    status: z.enum(["STARTED", "RESOLVED", "UPDATED"]),
  })
  .strict();

export const normalizedPaymentEventSchema = z
  .object({
    eventId: eventIdSchema,
    eventName: supportedWebhookEventNameSchema,
    occurredAt: canonicalTimestampSchema,
    receivedAt: canonicalTimestampSchema,
    paymentId: paymentIdSchema.optional(),
    orderId: orderIdSchema.optional(),
    recoveryLinkId: recoveryLinkIdSchema.optional(),
    paymentSnapshot: normalizedPaymentSnapshotSchema.optional(),
    paymentLinkSnapshot: normalizedPaymentLinkWebhookSnapshotSchema.optional(),
    downtimeSnapshot: normalizedDowntimeWebhookSnapshotSchema.optional(),
    signatureVerification: signatureVerificationResultSchema,
    duplicateProcessing: duplicateProcessingResultSchema,
  })
  .strict()
  .refine(
    ({ paymentId, orderId, recoveryLinkId, downtimeSnapshot }) =>
      paymentId !== undefined ||
      orderId !== undefined ||
      recoveryLinkId !== undefined ||
      downtimeSnapshot !== undefined,
    { message: "Normalized events require at least one internal reference." },
  );

export type SupportedWebhookEventName = z.infer<
  typeof supportedWebhookEventNameSchema
>;
export type RazorpayStyleExternalPaymentEntity = z.infer<
  typeof razorpayStyleExternalPaymentEntitySchema
>;
export type RazorpayStyleExternalWebhookEnvelope = z.infer<
  typeof razorpayStyleExternalWebhookEnvelopeSchema
>;
export type SignatureVerificationResult = z.infer<
  typeof signatureVerificationResultSchema
>;
export type DuplicateProcessingResult = z.infer<
  typeof duplicateProcessingResultSchema
>;
export type NormalizedPaymentEvent = z.infer<
  typeof normalizedPaymentEventSchema
>;
