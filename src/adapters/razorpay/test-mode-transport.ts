import "server-only";

import { Buffer } from "node:buffer";

const RAZORPAY_API_ORIGIN = "https://api.razorpay.com" as const;
const MAX_RESPONSE_BYTES = 256 * 1_024;

export type TransportFailureCode =
  | "NOT_FOUND"
  | "TIMEOUT"
  | "AUTHENTICATION_REJECTED"
  | "RATE_LIMITED"
  | "DEPENDENCY_UNAVAILABLE"
  | "INVALID_RESPONSE";

export type TransportResult =
  | { status: "OK"; body: unknown }
  | { status: "FAILED"; code: TransportFailureCode };

export interface RazorpayTestModeTransport {
  fetchPayment(
    paymentId: string,
    options: TransportOptions,
  ): Promise<TransportResult>;
  fetchDowntimes(options: TransportOptions): Promise<TransportResult>;
  createStandardPaymentLink(
    body: Readonly<Record<string, unknown>>,
    options: TransportOptions,
  ): Promise<TransportResult>;
  fetchPaymentLink(
    paymentLinkId: string,
    options: TransportOptions,
  ): Promise<TransportResult>;
  cancelPaymentLink(
    paymentLinkId: string,
    options: TransportOptions,
  ): Promise<TransportResult>;
}

export type TransportOptions = {
  signal: AbortSignal;
  timeoutMilliseconds: number;
};

type FixedRequest = {
  method: "GET" | "POST";
  path: string;
  body?: Readonly<Record<string, unknown>>;
  options: TransportOptions;
};

function safeHttpFailure(status: number): TransportFailureCode {
  if (status === 401 || status === 403) return "AUTHENTICATION_REJECTED";
  if (status === 404) return "NOT_FOUND";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "DEPENDENCY_UNAVAILABLE";
  return "INVALID_RESPONSE";
}

export class NativeRazorpayTestModeTransport implements RazorpayTestModeTransport {
  readonly #authorization: string;

  constructor(credentials: { keyId: string; keySecret: string }) {
    if (!credentials.keyId.startsWith("rzp_test_")) {
      throw new Error("Only Razorpay Test Mode credentials are accepted.");
    }
    if (credentials.keyId.startsWith("rzp_live_")) {
      throw new Error("Razorpay Live Mode is prohibited.");
    }
    this.#authorization = `Basic ${Buffer.from(
      `${credentials.keyId}:${credentials.keySecret}`,
      "utf8",
    ).toString("base64")}`;
  }

  fetchPayment(paymentId: string, options: TransportOptions) {
    return this.#execute({
      method: "GET",
      path: `/v1/payments/${encodeURIComponent(paymentId)}`,
      options,
    });
  }

  fetchDowntimes(options: TransportOptions) {
    return this.#execute({
      method: "GET",
      path: "/v1/payments/downtimes",
      options,
    });
  }

  createStandardPaymentLink(
    body: Readonly<Record<string, unknown>>,
    options: TransportOptions,
  ) {
    return this.#execute({
      method: "POST",
      path: "/v1/payment_links",
      body,
      options,
    });
  }

  fetchPaymentLink(paymentLinkId: string, options: TransportOptions) {
    return this.#execute({
      method: "GET",
      path: `/v1/payment_links/${encodeURIComponent(paymentLinkId)}`,
      options,
    });
  }

  cancelPaymentLink(paymentLinkId: string, options: TransportOptions) {
    return this.#execute({
      method: "POST",
      path: `/v1/payment_links/${encodeURIComponent(paymentLinkId)}/cancel`,
      options,
    });
  }

  async #execute(request: FixedRequest): Promise<TransportResult> {
    if (request.options.signal.aborted) {
      return { status: "FAILED", code: "TIMEOUT" };
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.options.signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, request.options.timeoutMilliseconds);
    try {
      const response = await fetch(`${RAZORPAY_API_ORIGIN}${request.path}`, {
        method: request.method,
        signal: controller.signal,
        redirect: "error",
        headers: {
          Accept: "application/json",
          Authorization: this.#authorization,
          ...(request.body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
        },
        ...(request.body === undefined
          ? {}
          : { body: JSON.stringify(request.body) }),
      });
      if (!response.ok) {
        return { status: "FAILED", code: safeHttpFailure(response.status) };
      }
      const declaredLength = Number(response.headers.get("content-length"));
      if (
        Number.isFinite(declaredLength) &&
        declaredLength > MAX_RESPONSE_BYTES
      ) {
        return { status: "FAILED", code: "INVALID_RESPONSE" };
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > MAX_RESPONSE_BYTES) {
        return { status: "FAILED", code: "INVALID_RESPONSE" };
      }
      try {
        return {
          status: "OK",
          body: JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          ),
        };
      } catch {
        return { status: "FAILED", code: "INVALID_RESPONSE" };
      }
    } catch {
      if (controller.signal.aborted)
        return { status: "FAILED", code: "TIMEOUT" };
      return { status: "FAILED", code: "DEPENDENCY_UNAVAILABLE" };
    } finally {
      clearTimeout(timer);
      request.options.signal.removeEventListener("abort", abort);
    }
  }
}

export const RAZORPAY_TEST_MODE_HTTP_BOUNDARY = {
  origin: RAZORPAY_API_ORIGIN,
  maximumResponseBytes: MAX_RESPONSE_BYTES,
} as const;
