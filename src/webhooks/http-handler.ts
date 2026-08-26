import type { SecureRazorpayWebhookIngestor } from "@/webhooks/ingestion";
import {
  MAX_WEBHOOK_BODY_BYTES,
  RAZORPAY_EVENT_ID_HEADER,
  RAZORPAY_SIGNATURE_HEADER,
} from "@/webhooks/contracts";

const SAFE_RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

function safeResponse(status: number, resultCode: string) {
  return Response.json(
    {
      status: status < 400 ? "ACCEPTED" : "ERROR_SAFE",
      resultCode,
    },
    { status, headers: SAFE_RESPONSE_HEADERS },
  );
}

export async function handleRazorpayWebhookRequest(
  request: Request,
  dependencies: {
    webhookSecret: string | undefined;
    getIngestor: () => SecureRazorpayWebhookIngestor;
    now?: () => Date;
  },
): Promise<Response> {
  if (dependencies.webhookSecret === undefined) {
    return safeResponse(503, "WEBHOOK_NOT_CONFIGURED");
  }

  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    /^\d+$/.test(declaredLength) &&
    Number(declaredLength) > MAX_WEBHOOK_BODY_BYTES
  ) {
    return safeResponse(413, "PAYLOAD_TOO_LARGE");
  }

  let rawBody: Uint8Array;
  try {
    rawBody = new Uint8Array(await request.arrayBuffer());
  } catch {
    return safeResponse(400, "PAYLOAD_REJECTED");
  }
  if (rawBody.byteLength > MAX_WEBHOOK_BODY_BYTES) {
    return safeResponse(413, "PAYLOAD_TOO_LARGE");
  }

  let result;
  try {
    result = await dependencies.getIngestor().ingest({
      rawBody,
      signature: request.headers.get(RAZORPAY_SIGNATURE_HEADER),
      providerEventId: request.headers.get(RAZORPAY_EVENT_ID_HEADER),
      webhookSecret: dependencies.webhookSecret,
      receivedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
    });
  } catch {
    return safeResponse(500, "PROCESSING_FAILED_SAFE");
  }

  if (result.status === "ACCEPTED") {
    return safeResponse(202, "EVENT_ACCEPTED");
  }
  if (result.status === "DUPLICATE") {
    return safeResponse(200, "DUPLICATE_IGNORED");
  }
  if (result.status === "IGNORED_UNSUPPORTED") {
    return safeResponse(200, "UNSUPPORTED_EVENT_IGNORED");
  }
  if (result.status === "CONFLICT") {
    return safeResponse(409, "EVENT_ID_CONFLICT");
  }
  if (result.status === "FAILED_SAFE") {
    return safeResponse(500, "PROCESSING_FAILED_SAFE");
  }
  if (
    result.reason === "MISSING_SIGNATURE" ||
    result.reason === "MALFORMED_SIGNATURE" ||
    result.reason === "INVALID_SIGNATURE"
  ) {
    return safeResponse(401, "SIGNATURE_REJECTED");
  }
  if (
    result.reason === "MISSING_EVENT_ID" ||
    result.reason === "MALFORMED_EVENT_ID"
  ) {
    return safeResponse(400, "EVENT_ID_REJECTED");
  }
  return safeResponse(400, "PAYLOAD_REJECTED");
}
