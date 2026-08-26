import { describe, expect, it } from "vitest";

import {
  createPaymentLinkRequestSchema,
  DeterministicMockRazorpayAdapter,
  fetchPaymentRequestSchema,
} from "@/adapters/razorpay";

const now = "2026-08-25T13:00:00.000Z";
const later = "2026-08-25T13:30:00.000Z";

function fixtures() {
  return {
    payments: [
      {
        paymentId: "pay_mock_001",
        orderId: "order_mock_001",
        amountSubunits: 100_000,
        currency: "INR",
        status: "FAILED",
        fetchedAt: now,
      },
    ],
    downtime: [
      { method: "upi", bankOrProvider: "mock_bank", active: true },
      { method: "card", active: false },
    ],
  };
}

function context() {
  return {
    requestedAt: now,
    timeoutMilliseconds: 1_000,
    signal: new AbortController().signal,
  };
}

function createRequest(overrides: Record<string, unknown> = {}) {
  return createPaymentLinkRequestSchema.parse({
    referenceId: "reference_mock_001",
    caseReference: "case_mock_001",
    expectedCaseState: "AWAITING_POLICY",
    expectedCaseVersion: 1,
    paymentId: "pay_mock_001",
    orderId: "order_mock_001",
    amountSubunits: 100_000,
    currency: "INR",
    description: "Synthetic test recovery link",
    expiresAt: later,
    requestedAt: now,
    metadata: { isSynthetic: true },
    ...overrides,
  });
}

function paymentRequest(paymentId = "pay_mock_001") {
  return fetchPaymentRequestSchema.parse({ paymentId });
}

describe("deterministic credential-free mock Razorpay adapter", () => {
  it("fetches a seeded payment with the injected timestamp", async () => {
    const result = await new DeterministicMockRazorpayAdapter(
      fixtures(),
    ).fetchPayment(paymentRequest(), context());
    expect(result).toMatchObject({
      status: "AVAILABLE",
      payment: { status: "FAILED", fetchedAt: now },
    });
  });

  it("returns a typed not-found payment result", async () => {
    const result = await new DeterministicMockRazorpayAdapter(
      fixtures(),
    ).fetchPayment(paymentRequest("pay_missing"), context());
    expect(result).toMatchObject({
      status: "NOT_FOUND",
      errorCode: "NOT_FOUND",
    });
  });

  it("injects payment-fetch timeout deterministically", async () => {
    const adapter = new DeterministicMockRazorpayAdapter(fixtures());
    adapter.injectFailure("FETCH_PAYMENT", "pay_mock_001", "TIMEOUT");
    expect(
      await adapter.fetchPayment(paymentRequest(), context()),
    ).toMatchObject({ status: "TIMEOUT", errorCode: "TIMEOUT" });
  });

  it("returns active downtime", async () => {
    const result = await new DeterministicMockRazorpayAdapter(
      fixtures(),
    ).fetchDowntime({ method: "upi", bankOrProvider: "mock_bank" }, context());
    expect(result).toMatchObject({
      status: "AVAILABLE",
      downtime: { active: true },
    });
  });

  it("returns inactive downtime", async () => {
    const result = await new DeterministicMockRazorpayAdapter(
      fixtures(),
    ).fetchDowntime({ method: "card" }, context());
    expect(result).toMatchObject({
      status: "AVAILABLE",
      downtime: { active: false },
    });
  });

  it("never infers active downtime when unavailable", async () => {
    const result = await new DeterministicMockRazorpayAdapter(
      fixtures(),
    ).fetchDowntime({ method: "netbanking" }, context());
    expect(result).toMatchObject({ status: "DEPENDENCY_UNAVAILABLE" });
    expect(result).not.toHaveProperty("downtime.active");
  });

  it("creates a deterministic mock Payment Link", async () => {
    const result = await new DeterministicMockRazorpayAdapter(
      fixtures(),
    ).createPaymentLink(createRequest(), context());
    expect(result).toMatchObject({
      status: "CREATED",
      paymentLink: { referenceId: "reference_mock_001", status: "CREATED" },
    });
    if (result.status === "CREATED")
      expect(result.paymentLink.publicUrl).toContain("mock.razorpay.local");
  });

  it("returns the existing link for an identical reference request", async () => {
    const adapter = new DeterministicMockRazorpayAdapter(fixtures());
    const first = await adapter.createPaymentLink(createRequest(), context());
    const second = await adapter.createPaymentLink(createRequest(), context());
    expect(second).toMatchObject({ status: "EXISTING" });
    if (first.status === "CREATED" && second.status === "EXISTING")
      expect(second.paymentLink.externalLinkId).toBe(
        first.paymentLink.externalLinkId,
      );
  });

  it.each([
    ["amountSubunits", 200_000],
    ["currency", "USD"],
    ["orderId", "order_mock_002"],
  ])("rejects same-reference conflict on %s", async (field, value) => {
    const adapter = new DeterministicMockRazorpayAdapter(fixtures());
    await adapter.createPaymentLink(createRequest(), context());
    expect(
      await adapter.createPaymentLink(
        createRequest({ [field]: value }),
        context(),
      ),
    ).toMatchObject({ status: "REFERENCE_CONFLICT" });
  });

  it("cancels an eligible created link", async () => {
    const adapter = new DeterministicMockRazorpayAdapter(fixtures());
    const created = await adapter.createPaymentLink(createRequest(), context());
    if (created.status !== "CREATED")
      throw new Error("Fixture link was not created.");
    expect(
      await adapter.cancelPaymentLink(
        {
          externalLinkId: created.paymentLink.externalLinkId,
          requestReference: "cancel_mock_001",
        },
        context(),
      ),
    ).toMatchObject({
      status: "CANCELLED",
      paymentLink: { status: "CANCELLED" },
    });
  });

  it.each([
    ["CANCELLED", "ALREADY_CANCELLED"],
    ["EXPIRED", "EXPIRED"],
    ["PAID", "ALREADY_PAID"],
    ["PARTIALLY_PAID", "PARTIALLY_PAID"],
  ] as const)("does not cancel a %s link", async (linkStatus, expected) => {
    const adapter = new DeterministicMockRazorpayAdapter(fixtures());
    const created = await adapter.createPaymentLink(createRequest(), context());
    if (created.status !== "CREATED")
      throw new Error("Fixture link was not created.");
    adapter.setPaymentLinkStatus(
      created.paymentLink.externalLinkId,
      linkStatus,
      later,
    );
    expect(
      await adapter.cancelPaymentLink(
        {
          externalLinkId: created.paymentLink.externalLinkId,
          requestReference: "cancel_mock_001",
        },
        { ...context(), requestedAt: later },
      ),
    ).toMatchObject({ status: expected });
  });

  it("mutates payment state only through explicit test controls", async () => {
    const adapter = new DeterministicMockRazorpayAdapter(fixtures());
    adapter.setPaymentStatus("pay_mock_001", "CAPTURED");
    expect(
      await adapter.fetchPayment(paymentRequest(), context()),
    ).toMatchObject({ status: "AVAILABLE", payment: { status: "CAPTURED" } });
  });

  it("mutates link lifecycle only through explicit test controls", async () => {
    const adapter = new DeterministicMockRazorpayAdapter(fixtures());
    const created = await adapter.createPaymentLink(createRequest(), context());
    if (created.status !== "CREATED")
      throw new Error("Fixture link was not created.");
    adapter.setPaymentLinkStatus(
      created.paymentLink.externalLinkId,
      "PAID",
      later,
    );
    expect(
      adapter.inspectPaymentLink(created.paymentLink.externalLinkId),
    ).toMatchObject({ status: "PAID", updatedAt: later });
  });

  it("reproduces failure injection from the same initial state", async () => {
    const run = async () => {
      const adapter = new DeterministicMockRazorpayAdapter(fixtures());
      adapter.injectFailure(
        "FETCH_PAYMENT",
        "pay_mock_001",
        "INVALID_RESPONSE",
      );
      return adapter.fetchPayment(paymentRequest(), context());
    };
    expect(await run()).toEqual(await run());
  });

  it("records a deterministic sanitized call log", async () => {
    const adapter = new DeterministicMockRazorpayAdapter(fixtures());
    await adapter.fetchPayment(paymentRequest(), context());
    await adapter.fetchDowntime({ method: "card" }, context());
    expect(adapter.getCallLog()).toEqual([
      {
        sequence: 1,
        operation: "FETCH_PAYMENT",
        resourceReference: "pay_mock_001",
        outcome: "AVAILABLE",
      },
      {
        sequence: 2,
        operation: "FETCH_DOWNTIME",
        resourceReference: "card:all",
        outcome: "INACTIVE",
      },
    ]);
    expect(JSON.stringify(adapter.getCallLog())).not.toMatch(
      /secret|email|phone|url/i,
    );
  });

  it("returns defensive copies", async () => {
    const adapter = new DeterministicMockRazorpayAdapter(fixtures());
    const result = await adapter.fetchPayment(paymentRequest(), context());
    if (result.status !== "AVAILABLE")
      throw new Error("Fixture payment unavailable.");
    result.payment.status = "CAPTURED";
    expect(
      await adapter.fetchPayment(paymentRequest(), context()),
    ).toMatchObject({ payment: { status: "FAILED" } });
    const log = adapter.getCallLog();
    log.length = 0;
    expect(adapter.getCallLog().length).toBe(2);
  });

  it("exposes no original-payment retry, capture, refund, route, or messaging capability", () => {
    const adapter = new DeterministicMockRazorpayAdapter(
      fixtures(),
    ) as unknown as Record<string, unknown>;
    for (const capability of [
      "retryPayment",
      "capturePayment",
      "refundPayment",
      "routePayment",
      "sendMessage",
    ]) {
      expect(adapter[capability]).toBeUndefined();
    }
  });
});
