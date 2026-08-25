import {
  normalizedPaymentEventSchema,
  razorpayStyleExternalWebhookEnvelopeSchema,
  supportedWebhookEventNameSchema,
  type NormalizedPaymentEvent,
  type RazorpayStyleExternalWebhookEnvelope,
  type SupportedWebhookEventName,
} from "@/domain";

function canonicalProviderTime(seconds: number): string {
  const date = new Date(seconds * 1_000);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("Provider timestamp is outside the supported range.");
  }
  return date.toISOString();
}

function requireContains(
  envelope: RazorpayStyleExternalWebhookEnvelope,
  entity: "payment" | "order" | "payment_link",
) {
  if (!envelope.contains.includes(entity)) {
    throw new Error("Webhook contains list conflicts with its event payload.");
  }
}

function normalizePaymentEvent(
  envelope: RazorpayStyleExternalWebhookEnvelope,
  eventName: "payment.failed" | "payment.authorized" | "payment.captured",
  eventId: string,
  receivedAt: string,
): NormalizedPaymentEvent {
  requireContains(envelope, "payment");
  const payment = envelope.payload.payment?.entity;
  if (payment === undefined || payment.order_id === null) {
    throw new Error("Payment webhook is missing required payment identity.");
  }

  const expected = {
    "payment.failed": { provider: "failed", internal: "FAILED" },
    "payment.authorized": { provider: "authorized", internal: "AUTHORIZED" },
    "payment.captured": { provider: "captured", internal: "CAPTURED" },
  } as const;
  const expectedStatus = expected[eventName];
  if (payment.status.toLowerCase() !== expectedStatus.provider) {
    throw new Error("Payment status conflicts with webhook event name.");
  }

  const failure = {
    ...(payment.error_code == null ? {} : { errorCode: payment.error_code }),
    ...(payment.error_description == null
      ? {}
      : { errorDescription: payment.error_description }),
    ...(payment.error_source == null
      ? {}
      : { errorSource: payment.error_source }),
    ...(payment.error_step == null ? {} : { errorStep: payment.error_step }),
    ...(payment.error_reason == null
      ? {}
      : { errorReason: payment.error_reason }),
  };
  const hasFailure = Object.keys(failure).length > 0;

  return normalizedPaymentEventSchema.parse({
    eventId,
    eventName,
    occurredAt: canonicalProviderTime(envelope.created_at),
    receivedAt,
    paymentId: payment.id,
    orderId: payment.order_id,
    paymentSnapshot: {
      paymentId: payment.id,
      orderId: payment.order_id,
      money: { amountSubunits: payment.amount, currency: payment.currency },
      status: expectedStatus.internal,
      method: payment.method,
      ...(payment.bank == null && payment.wallet == null
        ? {}
        : { bankOrProvider: payment.bank ?? payment.wallet }),
      failure: hasFailure ? failure : undefined,
      paymentCreatedAt: canonicalProviderTime(payment.created_at),
    },
    signatureVerification: { status: "VERIFIED" },
    duplicateProcessing: { status: "FIRST_SEEN" },
  });
}

export function normalizeVerifiedRazorpayWebhook(input: {
  externalPayload: unknown;
  providerEventId: string;
  receivedAt: string;
}): NormalizedPaymentEvent {
  const envelope = razorpayStyleExternalWebhookEnvelopeSchema.parse(
    input.externalPayload,
  );
  const eventName = supportedWebhookEventNameSchema.parse(envelope.event);

  if (
    eventName === "payment.failed" ||
    eventName === "payment.authorized" ||
    eventName === "payment.captured"
  ) {
    return normalizePaymentEvent(
      envelope,
      eventName,
      input.providerEventId,
      input.receivedAt,
    );
  }

  return normalizeNonPaymentEvent(
    envelope,
    eventName,
    input.providerEventId,
    input.receivedAt,
  );
}

function normalizeNonPaymentEvent(
  envelope: RazorpayStyleExternalWebhookEnvelope,
  eventName: Exclude<SupportedWebhookEventName, `payment.${string}`>,
  eventId: string,
  receivedAt: string,
): NormalizedPaymentEvent {
  const common = {
    eventId,
    eventName,
    occurredAt: canonicalProviderTime(envelope.created_at),
    receivedAt,
    signatureVerification: { status: "VERIFIED" as const },
    duplicateProcessing: { status: "FIRST_SEEN" as const },
  };

  if (eventName === "order.paid") {
    requireContains(envelope, "order");
    const order = envelope.payload.order?.entity;
    if (
      order === undefined ||
      order.status.toLowerCase() !== "paid" ||
      order.amount_paid < order.amount
    ) {
      throw new Error("Order payload conflicts with order.paid event.");
    }
    return normalizedPaymentEventSchema.parse({
      ...common,
      orderId: order.id,
    });
  }

  requireContains(envelope, "payment_link");
  const paymentLink = envelope.payload.payment_link?.entity;
  if (paymentLink === undefined) {
    throw new Error("Payment Link webhook is missing its entity.");
  }
  const expectedStatus = {
    "payment_link.paid": "paid",
    "payment_link.partially_paid": "partially_paid",
    "payment_link.cancelled": "cancelled",
    "payment_link.expired": "expired",
  } as const;
  if (paymentLink.status.toLowerCase() !== expectedStatus[eventName]) {
    throw new Error("Payment Link status conflicts with webhook event name.");
  }
  return normalizedPaymentEventSchema.parse({
    ...common,
    recoveryLinkId: paymentLink.id,
  });
}
