import { describe, expect, it } from "vitest";

import {
  duplicateProcessingResultSchema,
  normalizedPaymentEventSchema,
  razorpayStyleExternalWebhookEnvelopeSchema,
  signatureVerificationResultSchema,
  supportedWebhookEventNameSchema,
} from "@/domain/events";
import { paymentContextSchema } from "@/domain/payments";

import {
  validExternalWebhook,
  validNormalizedEvent,
  validPaymentContext,
} from "@/domain/__tests__/fixtures";

describe("normalized payment context", () => {
  it("accepts the trusted payment context RecoverAI requires", () => {
    const parsed = paymentContextSchema.parse(validPaymentContext);

    expect(parsed.money).toEqual({
      amountSubunits: 125_000,
      currency: "INR",
    });
    expect(parsed.downtimeContext.availability).toBe("AVAILABLE");
  });

  it("rejects missing trusted fields and malformed counts", () => {
    const withoutMoney = structuredClone(validPaymentContext) as Record<
      string,
      unknown
    >;
    delete withoutMoney.money;
    expect(paymentContextSchema.safeParse(withoutMoney).success).toBe(false);
    expect(
      paymentContextSchema.safeParse({
        ...validPaymentContext,
        previousContactCount: -1,
      }).success,
    ).toBe(false);
  });

  it("requires explicit downtime unavailability evidence", () => {
    expect(
      paymentContextSchema.safeParse({
        ...validPaymentContext,
        downtimeContext: {
          availability: "UNAVAILABLE",
          reason: "Synthetic downtime service timed out.",
          checkedAt: "2026-08-24T12:30:00.000Z",
        },
      }).success,
    ).toBe(true);
    expect(
      paymentContextSchema.safeParse({
        ...validPaymentContext,
        downtimeContext: { availability: "UNAVAILABLE" },
      }).success,
    ).toBe(false);
  });
});

describe("external and internal event boundaries", () => {
  it("allows additional provider fields only at the external boundary", () => {
    const external =
      razorpayStyleExternalWebhookEnvelopeSchema.parse(validExternalWebhook);

    expect(external.external_envelope_extension).toBe(true);
    expect(
      normalizedPaymentEventSchema.safeParse({
        ...validNormalizedEvent,
        provider_extension: "must-not-cross-boundary",
      }).success,
    ).toBe(false);
  });

  it("rejects external envelopes missing relied-upon provider fields", () => {
    const invalid = structuredClone(validExternalWebhook);
    delete (invalid.payload.payment?.entity as { amount?: number }).amount;

    expect(
      razorpayStyleExternalWebhookEnvelopeSchema.safeParse(invalid).success,
    ).toBe(false);
  });

  it("validates supported names separately from provider event strings", () => {
    expect(
      supportedWebhookEventNameSchema.safeParse("payment.failed").success,
    ).toBe(true);
    expect(
      supportedWebhookEventNameSchema.safeParse("refund.processed").success,
    ).toBe(false);
    expect(
      razorpayStyleExternalWebhookEnvelopeSchema.safeParse({
        ...validExternalWebhook,
        event: "provider.future_event",
      }).success,
    ).toBe(true);
  });

  it("accepts a strict normalized event and rejects missing references", () => {
    expect(
      normalizedPaymentEventSchema.safeParse(validNormalizedEvent).success,
    ).toBe(true);

    const withoutReferences = structuredClone(validNormalizedEvent) as Record<
      string,
      unknown
    >;
    delete withoutReferences.paymentId;
    delete withoutReferences.orderId;
    delete withoutReferences.recoveryLinkId;

    expect(
      normalizedPaymentEventSchema.safeParse(withoutReferences).success,
    ).toBe(false);
  });

  it("defines passive verification and duplicate result contracts only", () => {
    expect(
      signatureVerificationResultSchema.parse({ status: "VERIFIED" }),
    ).toEqual({ status: "VERIFIED" });
    expect(
      duplicateProcessingResultSchema.safeParse({
        status: "DUPLICATE",
        firstProcessedAt: "not-a-time",
      }).success,
    ).toBe(false);
  });
});
