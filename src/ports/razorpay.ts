import type {
  AdapterCallContext,
  CancelPaymentLinkRequest,
  CancelPaymentLinkResult,
  CreatePaymentLinkRequest,
  CreatePaymentLinkResult,
  FetchDowntimeRequest,
  FetchDowntimeResult,
  FetchPaymentLinkRequest,
  FetchPaymentLinkResult,
  FetchPaymentRequest,
  FetchPaymentResult,
} from "@/adapters/razorpay/contracts";

export interface RazorpayCapabilityPort {
  fetchPayment(
    request: FetchPaymentRequest,
    context: AdapterCallContext & { signal: AbortSignal },
  ): Promise<FetchPaymentResult>;
  fetchDowntime(
    request: FetchDowntimeRequest,
    context: AdapterCallContext & { signal: AbortSignal },
  ): Promise<FetchDowntimeResult>;
  createPaymentLink(
    request: CreatePaymentLinkRequest,
    context: AdapterCallContext & { signal: AbortSignal },
  ): Promise<CreatePaymentLinkResult>;
  fetchPaymentLink(
    request: FetchPaymentLinkRequest,
    context: AdapterCallContext & { signal: AbortSignal },
  ): Promise<FetchPaymentLinkResult>;
  cancelPaymentLink(
    request: CancelPaymentLinkRequest,
    context: AdapterCallContext & { signal: AbortSignal },
  ): Promise<CancelPaymentLinkResult>;
}
