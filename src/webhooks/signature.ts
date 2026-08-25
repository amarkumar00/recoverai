import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { WebhookSignatureResult } from "@/webhooks/contracts";

const SHA256_HEX_PATTERN = /^[a-fA-F0-9]{64}$/;

export function verifyRazorpayWebhookSignature(input: {
  rawBody: Uint8Array;
  receivedSignature: string | null;
  webhookSecret: string;
}): WebhookSignatureResult {
  if (input.receivedSignature === null) {
    return { status: "REJECTED", reason: "MISSING_SIGNATURE" };
  }
  if (!SHA256_HEX_PATTERN.test(input.receivedSignature)) {
    return { status: "REJECTED", reason: "MALFORMED_SIGNATURE" };
  }

  const expected = createHmac("sha256", input.webhookSecret)
    .update(input.rawBody)
    .digest();
  const received = Buffer.from(input.receivedSignature, "hex");

  return timingSafeEqual(expected, received)
    ? { status: "VERIFIED" }
    : { status: "REJECTED", reason: "INVALID_SIGNATURE" };
}

export function digestRawWebhookBody(rawBody: Uint8Array): string {
  return createHash("sha256").update(rawBody).digest("hex");
}
