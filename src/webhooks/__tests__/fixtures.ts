import { createHmac } from "node:crypto";

import { validExternalWebhook } from "@/domain/__tests__/fixtures";

export const webhookSecret = "recoverai_test_webhook_secret";
export const providerEventId = "event_provider_m10_001";
export const receivedAt = "2026-08-26T09:00:00.000Z";

export function rawWebhookBody(
  payload: unknown = validExternalWebhook,
  space?: number,
): Uint8Array {
  return Buffer.from(JSON.stringify(payload, null, space), "utf8");
}

export function signRawBody(
  rawBody: Uint8Array,
  secret = webhookSecret,
): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function signedHeaders(
  rawBody: Uint8Array,
  eventId = providerEventId,
): HeadersInit {
  return {
    "content-type": "application/json",
    "x-razorpay-event-id": eventId,
    "x-razorpay-signature": signRawBody(rawBody),
  };
}
