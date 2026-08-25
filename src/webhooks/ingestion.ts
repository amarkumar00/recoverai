import { eventIdSchema } from "@/domain";
import type { RecoverAiRepositories } from "@/repositories";
import type {
  SecureWebhookIngestionResult,
  VerifiedWebhookEventProcessor,
} from "@/webhooks/contracts";
import { normalizeVerifiedRazorpayWebhook } from "@/webhooks/normalizer";
import {
  digestRawWebhookBody,
  verifyRazorpayWebhookSignature,
} from "@/webhooks/signature";

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export class SecureRazorpayWebhookIngestor {
  readonly #repositories: RecoverAiRepositories;
  readonly #processor: VerifiedWebhookEventProcessor;

  constructor(input: {
    repositories: RecoverAiRepositories;
    processor: VerifiedWebhookEventProcessor;
  }) {
    this.#repositories = input.repositories;
    this.#processor = input.processor;
  }

  async ingest(input: {
    rawBody: Uint8Array;
    signature: string | null;
    providerEventId: string | null;
    webhookSecret: string;
    receivedAt: string;
  }): Promise<SecureWebhookIngestionResult> {
    const signature = verifyRazorpayWebhookSignature({
      rawBody: input.rawBody,
      receivedSignature: input.signature,
      webhookSecret: input.webhookSecret,
    });
    if (signature.status === "REJECTED") {
      return { status: "REJECTED", reason: signature.reason };
    }

    if (input.providerEventId === null) {
      return { status: "REJECTED", reason: "MISSING_EVENT_ID" };
    }
    const providerEventId = eventIdSchema.safeParse(input.providerEventId);
    if (!providerEventId.success) {
      return { status: "REJECTED", reason: "MALFORMED_EVENT_ID" };
    }

    let externalPayload: unknown;
    try {
      externalPayload = JSON.parse(utf8Decoder.decode(input.rawBody));
    } catch {
      return { status: "REJECTED", reason: "INVALID_JSON" };
    }

    let event;
    try {
      event = normalizeVerifiedRazorpayWebhook({
        externalPayload,
        providerEventId: providerEventId.data,
        receivedAt: input.receivedAt,
      });
    } catch {
      return { status: "REJECTED", reason: "INVALID_PAYLOAD" };
    }

    let claim;
    try {
      claim = this.#repositories.webhookEvents.claim({
        internalEventId: providerEventId.data,
        providerEventId: providerEventId.data,
        event,
        payloadDigest: digestRawWebhookBody(input.rawBody),
        createdAt: input.receivedAt,
        processedAt: input.receivedAt,
        safeErrorReason:
          "Signature-verified provider event accepted through the public webhook boundary.",
      });
    } catch {
      return { status: "FAILED_SAFE" };
    }
    if (claim.status === "CONFLICT") return { status: "CONFLICT" };
    if (claim.status === "DUPLICATE") {
      return { status: "DUPLICATE", event: claim.event };
    }

    try {
      await this.#processor.process(claim.event);
    } catch {
      return { status: "FAILED_SAFE" };
    }
    return { status: "ACCEPTED", event: claim.event };
  }
}
