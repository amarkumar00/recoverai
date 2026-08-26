import { z } from "zod";

import { normalizedPaymentStatusSchema } from "@/domain/payments";
import {
  boundedReasonSchema,
  boundedProviderValueSchema,
  canonicalTimestampSchema,
  eventIdSchema,
} from "@/domain/primitives";
import { persistedWebhookEventSchema } from "@/repositories/contracts";

export const paymentReconciliationRequestSchema = z
  .object({
    event: persistedWebhookEventSchema,
    checkedAt: canonicalTimestampSchema,
    timeoutMilliseconds: z.number().int().positive().max(30_000),
  })
  .strict();

const reconciliationResultFields = {
  eventId: eventIdSchema,
  resultCode: boundedProviderValueSchema,
  explanation: boundedReasonSchema,
  currentStatus: normalizedPaymentStatusSchema.optional(),
};

function resultVariant<T extends string>(status: T) {
  return z
    .object({ status: z.literal(status), ...reconciliationResultFields })
    .strict();
}

export const paymentReconciliationResultSchema = z.discriminatedUnion(
  "status",
  [
    resultVariant("IGNORED_EVENT"),
    resultVariant("NO_PAYMENT_TARGET"),
    resultVariant("CURRENT_STATE_UNAVAILABLE"),
    resultVariant("CURRENT_STATE_CONFLICT"),
    resultVariant("UNPAID_CONFIRMED"),
    resultVariant("SATISFIED_NO_ACTIVE_CASE"),
    resultVariant("RECOVERY_STOPPED"),
    resultVariant("STOPPED_REVIEW_REQUIRED"),
    resultVariant("IDEMPOTENT_REPLAY"),
    resultVariant("FAILED_SAFE"),
  ],
);

export type PaymentReconciliationRequest = z.infer<
  typeof paymentReconciliationRequestSchema
>;
export type PaymentReconciliationResult = z.infer<
  typeof paymentReconciliationResultSchema
>;
