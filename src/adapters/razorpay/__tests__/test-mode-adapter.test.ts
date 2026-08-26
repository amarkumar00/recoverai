import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { RazorpayTestModeAdapter } from "@/adapters/razorpay/test-mode-adapter";
import { InMemoryTestModeLinkAttemptBudget } from "@/adapters/razorpay/test-mode-attempt-budget";
import {
  createPaymentLinkRequestSchema,
  fetchPaymentLinkRequestSchema,
  fetchPaymentRequestSchema,
} from "@/adapters/razorpay/contracts";
import type {
  RazorpayTestModeTransport,
  TransportResult,
} from "@/adapters/razorpay/test-mode-transport";

const now = "2026-08-26T10:00:00.000Z";
const expires = "2026-08-26T11:00:00.000Z";
const payment = {
  id: "pay_test001",
  order_id: "order_test001",
  amount: 12_500,
  currency: "INR",
  status: "failed",
};

function link(status = "created", amountPaid = 0) {
  return {
    id: "plink_test001",
    amount: 12_500,
    amount_paid: amountPaid,
    currency: "INR",
    reference_id: "ra_v1_plinkref_123456789012345678901234",
    status,
    short_url: "https://rzp.io/i/test001",
    created_at: 1_777_000_000,
    expire_by: 1_777_003_600,
    updated_at: 1_777_000_000,
  };
}

class FakeTransport implements RazorpayTestModeTransport {
  paymentResult: TransportResult = { status: "OK", body: payment };
  downtimeResult: TransportResult = {
    status: "OK",
    body: {
      entity: "collection",
      count: 1,
      items: [
        {
          id: "down_test001",
          entity: "payment.downtime",
          method: "upi",
          status: "started",
          begin: 1_777_000_000,
          instrument: { bank: "HDFC" },
        },
      ],
    },
  };
  createResult: TransportResult = { status: "OK", body: link() };
  fetchLinkResult: TransportResult = { status: "OK", body: link() };
  cancelResult: TransportResult = {
    status: "OK",
    body: link("cancelled"),
  };
  createBodies: Readonly<Record<string, unknown>>[] = [];
  calls = { payment: 0, downtime: 0, create: 0, fetchLink: 0, cancel: 0 };

  async fetchPayment() {
    this.calls.payment += 1;
    return this.paymentResult;
  }
  async fetchDowntimes() {
    this.calls.downtime += 1;
    return this.downtimeResult;
  }
  async createStandardPaymentLink(body: Readonly<Record<string, unknown>>) {
    this.calls.create += 1;
    this.createBodies.push(body);
    return this.createResult;
  }
  async fetchPaymentLink() {
    this.calls.fetchLink += 1;
    return this.fetchLinkResult;
  }
  async cancelPaymentLink() {
    this.calls.cancel += 1;
    return this.cancelResult;
  }
}

function context() {
  return {
    requestedAt: now,
    timeoutMilliseconds: 1_000,
    signal: new AbortController().signal,
  };
}

function createRequest(referenceId = link().reference_id) {
  return createPaymentLinkRequestSchema.parse({
    referenceId,
    caseReference: "case_test001",
    expectedCaseState: "AWAITING_POLICY" as const,
    expectedCaseVersion: 1,
    paymentId: "pay_test001",
    orderId: "order_test001",
    amountSubunits: 12_500,
    currency: "INR",
    description: "RecoverAI Test Mode recovery link",
    expiresAt: expires,
    requestedAt: now,
    metadata: { isSynthetic: true as const },
  });
}

function paymentRequest() {
  return fetchPaymentRequestSchema.parse({ paymentId: "pay_test001" });
}

function adapter(
  transport = new FakeTransport(),
  writesEnabled = true,
  verifyCaseBeforeCreate = () => true,
) {
  return {
    transport,
    adapter: new RazorpayTestModeAdapter({
      transport,
      attemptBudget: new InMemoryTestModeLinkAttemptBudget(),
      writesEnabled,
      verifyCaseBeforeCreate,
    }),
  };
}

function knownLinkRequest() {
  return fetchPaymentLinkRequestSchema.parse({
    externalLinkId: "plink_test001",
    referenceId: link().reference_id,
    caseReference: "case_test001",
    orderId: "order_test001",
    amountSubunits: 12_500,
    currency: "INR",
  });
}

describe("Razorpay Test Mode adapter with injected transport", () => {
  it("normalizes a payment and fails closed on identity or unsupported state", async () => {
    const env = adapter();
    expect(
      await env.adapter.fetchPayment(paymentRequest(), context()),
    ).toMatchObject({ status: "AVAILABLE", payment: { status: "FAILED" } });
    env.transport.paymentResult = {
      status: "OK",
      body: { ...payment, id: "pay_conflict" },
    };
    expect(
      await env.adapter.fetchPayment(paymentRequest(), context()),
    ).toMatchObject({ status: "INVALID_RESPONSE" });
    env.transport.paymentResult = {
      status: "OK",
      body: { ...payment, status: "refunded" },
    };
    expect(
      await env.adapter.fetchPayment(paymentRequest(), context()),
    ).toMatchObject({ status: "INVALID_RESPONSE" });
  });

  it.each(["authorized", "captured"])(
    "stops link creation when payment is %s",
    async (status) => {
      const env = adapter();
      env.transport.paymentResult = {
        status: "OK",
        body: { ...payment, status },
      };
      expect(
        await env.adapter.createPaymentLink(createRequest(), context()),
      ).toMatchObject({ status: "PAYMENT_STATE_CHANGED" });
      expect(env.transport.calls.create).toBe(0);
    },
  );

  it("matches structured downtime and fails closed on malformed data", async () => {
    const env = adapter();
    expect(
      await env.adapter.fetchDowntime(
        { method: "upi", bankOrProvider: "HDFC" },
        context(),
      ),
    ).toMatchObject({ status: "AVAILABLE", downtime: { active: true } });
    env.transport.downtimeResult = {
      status: "OK",
      body: { count: 1, items: [] },
    };
    expect(
      await env.adapter.fetchDowntime({ method: "upi" }, context()),
    ).toMatchObject({ status: "INVALID_RESPONSE" });
  });

  it("creates one bounded Standard link without customer notification data", async () => {
    const env = adapter();
    const first = await env.adapter.createPaymentLink(
      createRequest(),
      context(),
    );
    const replay = await env.adapter.createPaymentLink(
      createRequest(),
      context(),
    );
    expect(first).toMatchObject({ status: "CREATED" });
    expect(replay).toMatchObject({ status: "EXISTING" });
    expect(env.transport.calls.create).toBe(1);
    expect(env.transport.createBodies[0]).toEqual({
      amount: 12_500,
      currency: "INR",
      accept_partial: false,
      reference_id: link().reference_id,
      description: "RecoverAI Test Mode recovery link",
      expire_by: 1_787_742_000,
      notify: { sms: false, email: false },
      reminder_enable: false,
    });
    expect(JSON.stringify(env.transport.createBodies[0])).not.toMatch(
      /customer|phone|notes/,
    );
  });

  it("consumes an uncertain attempt without retry", async () => {
    const env = adapter();
    env.transport.createResult = { status: "FAILED", code: "TIMEOUT" };
    expect(
      await env.adapter.createPaymentLink(createRequest(), context()),
    ).toMatchObject({ status: "TIMEOUT", errorCode: "OUTCOME_UNCERTAIN" });
    expect(
      await env.adapter.createPaymentLink(createRequest(), context()),
    ).toMatchObject({ status: "TIMEOUT", errorCode: "OUTCOME_UNCERTAIN" });
    expect(env.transport.calls.create).toBe(1);
  });

  it("enforces the local three-attempt cap", async () => {
    const env = adapter();
    for (let index = 0; index < 3; index += 1) {
      env.transport.createResult = { status: "FAILED", code: "RATE_LIMITED" };
      await env.adapter.createPaymentLink(
        createRequest(`ra_v1_plinkref_1234567890123456789012${index}`),
        context(),
      );
    }
    expect(
      await env.adapter.createPaymentLink(
        createRequest("ra_v1_plinkref_123456789012345678901299"),
        context(),
      ),
    ).toMatchObject({ errorCode: "LOCAL_ATTEMPT_LIMIT_REACHED" });
    expect(env.transport.calls.create).toBe(3);
  });

  it("fetches a known link and cancels only created links with zero paid amount", async () => {
    const env = adapter();
    expect(
      await env.adapter.fetchPaymentLink(knownLinkRequest(), context()),
    ).toMatchObject({
      status: "AVAILABLE",
      paymentLink: { status: "CREATED" },
    });
    expect(
      await env.adapter.cancelPaymentLink(
        { ...knownLinkRequest(), requestReference: "cancel_test001" },
        context(),
      ),
    ).toMatchObject({ status: "CANCELLED" });
    expect(env.transport.calls.cancel).toBe(1);
  });

  it.each([
    ["paid", 12_500, "ALREADY_PAID"],
    ["partially_paid", 5_000, "PARTIALLY_PAID"],
    ["expired", 0, "EXPIRED"],
    ["cancelled", 0, "ALREADY_CANCELLED"],
  ])("does not cancel provider state %s", async (status, paid, expected) => {
    const env = adapter();
    env.transport.fetchLinkResult = {
      status: "OK",
      body: link(status, paid as number),
    };
    expect(
      await env.adapter.cancelPaymentLink(
        { ...knownLinkRequest(), requestReference: "cancel_test001" },
        context(),
      ),
    ).toMatchObject({ status: expected });
    expect(env.transport.calls.cancel).toBe(0);
  });

  it("sanitizes auth, rate and malformed responses without secret leakage", async () => {
    const env = adapter();
    env.transport.paymentResult = {
      status: "FAILED",
      code: "AUTHENTICATION_REJECTED",
    };
    const auth = await env.adapter.fetchPayment(paymentRequest(), context());
    expect(auth).toMatchObject({
      status: "DEPENDENCY_UNAVAILABLE",
      errorCode: "AUTHENTICATION_REJECTED",
    });
    expect(JSON.stringify(auth)).not.toContain("fixture_secret");
    env.transport.paymentResult = {
      status: "OK",
      body: { raw: "secret-provider-body" },
    };
    const malformed = await env.adapter.fetchPayment(
      paymentRequest(),
      context(),
    );
    expect(malformed).toMatchObject({ status: "INVALID_RESPONSE" });
    expect(JSON.stringify(malformed)).not.toContain("secret-provider-body");
  });

  it("requires explicit write opt-in", async () => {
    const env = adapter(new FakeTransport(), false);
    expect(
      await env.adapter.createPaymentLink(createRequest(), context()),
    ).toMatchObject({ status: "DEPENDENCY_UNAVAILABLE" });
    expect(env.transport.calls.create).toBe(0);
  });

  it("rechecks the recovery case immediately before provider creation", async () => {
    const env = adapter(new FakeTransport(), true, () => false);
    expect(
      await env.adapter.createPaymentLink(createRequest(), context()),
    ).toMatchObject({ status: "REFERENCE_CONFLICT" });
    expect(env.transport.calls.payment).toBe(1);
    expect(env.transport.calls.create).toBe(0);
  });
});
