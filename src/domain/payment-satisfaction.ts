import { z } from "zod";

import {
  boundedReasonSchema,
  canonicalTimestampSchema,
} from "@/domain/primitives";

export const paymentSatisfactionContextSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("SATISFIED"),
      basis: z.enum([
        "PAYMENT_AUTHORIZED",
        "PAYMENT_CAPTURED",
        "ORDER_PAID",
        "RECOVERY_LINK_PAID",
      ]),
      verifiedAt: canonicalTimestampSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("UNSATISFIED"),
      paymentStatus: z.enum(["CREATED", "FAILED"]),
      verifiedAt: canonicalTimestampSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("UNAVAILABLE"),
      reason: boundedReasonSchema,
      checkedAt: canonicalTimestampSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("CONFLICTING"),
      reason: boundedReasonSchema,
      checkedAt: canonicalTimestampSchema,
    })
    .strict(),
]);

export type PaymentSatisfactionContext = z.infer<
  typeof paymentSatisfactionContextSchema
>;
