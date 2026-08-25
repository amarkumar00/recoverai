import { describe, expect, it } from "vitest";

import { verifyRazorpayWebhookSignature } from "@/webhooks";
import {
  rawWebhookBody,
  signRawBody,
  webhookSecret,
} from "@/webhooks/__tests__/fixtures";

describe("Razorpay-style raw-body signature verification", () => {
  it("accepts a valid HMAC-SHA256 signature over the exact raw bytes", () => {
    const rawBody = rawWebhookBody();
    expect(
      verifyRazorpayWebhookSignature({
        rawBody,
        receivedSignature: signRawBody(rawBody),
        webhookSecret,
      }),
    ).toEqual({ status: "VERIFIED" });
  });

  it("rejects an invalid signature", () => {
    expect(
      verifyRazorpayWebhookSignature({
        rawBody: rawWebhookBody(),
        receivedSignature: "0".repeat(64),
        webhookSecret,
      }),
    ).toEqual({ status: "REJECTED", reason: "INVALID_SIGNATURE" });
  });

  it("rejects a missing signature", () => {
    expect(
      verifyRazorpayWebhookSignature({
        rawBody: rawWebhookBody(),
        receivedSignature: null,
        webhookSecret,
      }),
    ).toEqual({ status: "REJECTED", reason: "MISSING_SIGNATURE" });
  });

  it.each([
    "",
    "not-hex",
    "a".repeat(63),
    "a".repeat(65),
    `${"a".repeat(64)},x`,
  ])("rejects malformed signature %j", (receivedSignature) => {
    expect(
      verifyRazorpayWebhookSignature({
        rawBody: rawWebhookBody(),
        receivedSignature,
        webhookSecret,
      }),
    ).toEqual({ status: "REJECTED", reason: "MALFORMED_SIGNATURE" });
  });

  it("rejects a valid signature calculated over differently serialized JSON", () => {
    const compactBody = rawWebhookBody();
    const prettyBody = rawWebhookBody(undefined, 2);
    expect(
      verifyRazorpayWebhookSignature({
        rawBody: prettyBody,
        receivedSignature: signRawBody(compactBody),
        webhookSecret,
      }),
    ).toEqual({ status: "REJECTED", reason: "INVALID_SIGNATURE" });
  });
});
