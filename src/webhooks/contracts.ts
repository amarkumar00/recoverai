import type { PersistedWebhookEvent } from "@/repositories";

export const RAZORPAY_SIGNATURE_HEADER = "x-razorpay-signature" as const;
export const RAZORPAY_EVENT_ID_HEADER = "x-razorpay-event-id" as const;
export const MAX_WEBHOOK_BODY_BYTES = 256 * 1_024;

export type WebhookSignatureResult =
  | { status: "VERIFIED" }
  | {
      status: "REJECTED";
      reason: "MISSING_SIGNATURE" | "MALFORMED_SIGNATURE" | "INVALID_SIGNATURE";
    };

export type SecureWebhookIngestionResult =
  | { status: "ACCEPTED"; event: PersistedWebhookEvent }
  | { status: "DUPLICATE"; event: PersistedWebhookEvent }
  | {
      status: "REJECTED";
      reason:
        | "MISSING_SIGNATURE"
        | "MALFORMED_SIGNATURE"
        | "INVALID_SIGNATURE"
        | "MISSING_EVENT_ID"
        | "MALFORMED_EVENT_ID"
        | "INVALID_JSON"
        | "INVALID_PAYLOAD";
    }
  | { status: "CONFLICT" }
  | { status: "FAILED_SAFE" };

export interface VerifiedWebhookEventProcessor {
  process(event: PersistedWebhookEvent): Promise<void> | void;
}
