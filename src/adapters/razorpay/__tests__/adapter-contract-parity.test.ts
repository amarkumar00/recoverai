import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  adapterPaymentSchema,
  createPaymentLinkRequestSchema,
  DeterministicMockRazorpayAdapter,
  fetchPaymentRequestSchema,
} from "@/adapters/razorpay";
import { RazorpayTestModeAdapter } from "@/adapters/razorpay/test-mode-adapter";
import { InMemoryTestModeLinkAttemptBudget } from "@/adapters/razorpay/test-mode-attempt-budget";
import type {
  RazorpayTestModeTransport,
  TransportResult,
} from "@/adapters/razorpay/test-mode-transport";
import type { RazorpayCapabilityPort } from "@/ports/razorpay";

const now = "2026-08-27T10:00:00.000Z";
const expiresAt = "2026-08-27T11:00:00.000Z";
const payment = adapterPaymentSchema.parse({
  paymentId: "pay_parity_001",
  orderId: "order_parity_001",
  amountSubunits: 25_000,
  currency: "INR",
  status: "FAILED",
  fetchedAt: now,
});
const referenceId = "ra_v1_parity_123456789012345678901234";

function context() {
  return {
    requestedAt: now,
    timeoutMilliseconds: 1_000,
    signal: new AbortController().signal,
  };
}

function createRequest() {
  return createPaymentLinkRequestSchema.parse({
    referenceId,
    caseReference: "case_parity_001",
    expectedCaseState: "AWAITING_POLICY" as const,
    expectedCaseVersion: 1,
    paymentId: payment.paymentId,
    orderId: payment.orderId,
    amountSubunits: payment.amountSubunits,
    currency: payment.currency,
    description: "RecoverAI adapter parity fixture",
    expiresAt,
    requestedAt: now,
    metadata: { isSynthetic: true as const },
  });
}

function providerLink(status = "created", amountPaid = 0) {
  return {
    id: "plink_parity_001",
    amount: payment.amountSubunits,
    amount_paid: amountPaid,
    currency: payment.currency,
    reference_id: referenceId,
    status,
    short_url: "https://rzp.io/i/parity-fixture",
    created_at: Math.floor(Date.parse(now) / 1_000),
    expire_by: Math.floor(Date.parse(expiresAt) / 1_000),
    updated_at: Math.floor(Date.parse(now) / 1_000),
  };
}

class ParityTransport implements RazorpayTestModeTransport {
  link = providerLink();
  paymentResult: TransportResult = {
    status: "OK",
    body: {
      id: payment.paymentId,
      order_id: payment.orderId,
      amount: payment.amountSubunits,
      currency: payment.currency,
      status: "failed",
    },
  };

  async fetchPayment() {
    return this.paymentResult;
  }

  async fetchDowntimes() {
    return {
      status: "OK" as const,
      body: {
        entity: "collection",
        count: 1,
        items: [
          {
            id: "down_parity_001",
            entity: "payment.downtime",
            method: "upi",
            status: "started",
            begin: Math.floor(Date.parse(now) / 1_000),
            instrument: { bank: "HDFC" },
          },
        ],
      },
    };
  }

  async createStandardPaymentLink() {
    return { status: "OK" as const, body: this.link };
  }

  async fetchPaymentLink() {
    return { status: "OK" as const, body: this.link };
  }

  async cancelPaymentLink() {
    this.link = providerLink("cancelled");
    return { status: "OK" as const, body: this.link };
  }
}

function adapters(): Array<{ name: string; adapter: RazorpayCapabilityPort }> {
  const transport = new ParityTransport();
  return [
    {
      name: "deterministic mock",
      adapter: new DeterministicMockRazorpayAdapter({
        payments: [payment],
        downtime: [{ method: "upi", bankOrProvider: "HDFC", active: true }],
      }),
    },
    {
      name: "Test Mode with injected fake transport",
      adapter: new RazorpayTestModeAdapter({
        transport,
        attemptBudget: new InMemoryTestModeLinkAttemptBudget(),
        writesEnabled: true,
        verifyCaseBeforeCreate: () => true,
      }),
    },
  ];
}

describe.each(adapters())(
  "shared capability contract: $name",
  ({ adapter }) => {
    it("normalizes equivalent payment and downtime state", async () => {
      expect(
        await adapter.fetchPayment(
          fetchPaymentRequestSchema.parse({ paymentId: payment.paymentId }),
          context(),
        ),
      ).toMatchObject({
        status: "AVAILABLE",
        payment: {
          paymentId: payment.paymentId,
          orderId: payment.orderId,
          amountSubunits: payment.amountSubunits,
          currency: payment.currency,
          status: "FAILED",
        },
      });
      expect(
        await adapter.fetchDowntime(
          { method: "upi", bankOrProvider: "HDFC" },
          context(),
        ),
      ).toMatchObject({
        status: "AVAILABLE",
        downtime: { active: true, method: "upi", bankOrProvider: "HDFC" },
      });
    });

    it("creates idempotently, fetches, and cancels through the same lifecycle", async () => {
      const created = await adapter.createPaymentLink(
        createRequest(),
        context(),
      );
      const replay = await adapter.createPaymentLink(
        createRequest(),
        context(),
      );
      expect(created).toMatchObject({
        status: "CREATED",
        paymentLink: {
          referenceId,
          orderId: payment.orderId,
          amountSubunits: payment.amountSubunits,
          currency: payment.currency,
          status: "CREATED",
        },
      });
      expect(replay).toMatchObject({ status: "EXISTING" });
      if (created.status !== "CREATED")
        throw new Error("Parity fixture did not create a link.");

      const trustedLink = {
        externalLinkId: created.paymentLink.externalLinkId,
        referenceId: created.paymentLink.referenceId,
        caseReference: created.paymentLink.caseReference,
        orderId: created.paymentLink.orderId,
        amountSubunits: created.paymentLink.amountSubunits,
        currency: created.paymentLink.currency,
      };
      expect(
        await adapter.fetchPaymentLink(trustedLink, context()),
      ).toMatchObject({
        status: "AVAILABLE",
        paymentLink: { status: "CREATED" },
      });
      expect(
        await adapter.cancelPaymentLink(
          { ...trustedLink, requestReference: "cancel_parity_001" },
          context(),
        ),
      ).toMatchObject({ status: "CANCELLED" });
    });
  },
);
