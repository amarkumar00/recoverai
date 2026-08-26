import { afterEach, describe, expect, it } from "vitest";

import {
  DeterministicMockRazorpayAdapter,
  type AdapterPayment,
  type AdapterPaymentLink,
} from "@/adapters/razorpay";
import { createSqliteAuditChain } from "@/audit";
import { normalizedPaymentEventSchema } from "@/domain";
import { createLocalDatabase } from "@/lib/db/client";
import { runDatabaseMigrations } from "@/lib/db/migrations";
import type { RazorpayCapabilityPort } from "@/ports/razorpay";
import { PaymentStateReconciler } from "@/reconciliation";
import { RecoveryActionExecutor } from "@/recovery/action-executor";
import {
  paymentLinkRecordSchema,
  recoveryCaseRecordSchema,
} from "@/repositories/contracts";
import { createSqliteRepositories } from "@/repositories/sqlite";

const checkedAt = "2026-08-26T10:00:00.000Z";
const paymentCreatedAt = "2026-08-26T09:00:00.000Z";
const databases: ReturnType<typeof createLocalDatabase>[] = [];

function currentPayment(
  overrides: Partial<AdapterPayment> = {},
): AdapterPayment {
  return {
    paymentId: "pay_reconcile_001" as AdapterPayment["paymentId"],
    orderId: "order_reconcile_001" as AdapterPayment["orderId"],
    amountSubunits: 149_900,
    currency: "INR",
    status: "FAILED",
    fetchedAt: checkedAt,
    ...overrides,
  };
}

function adapterLink(status: AdapterPaymentLink["status"]): AdapterPaymentLink {
  return {
    externalLinkId: "plink_reconcile_001",
    publicUrl: "https://mock.razorpay.local/payment-links/plink_reconcile_001",
    referenceId: "ref_reconcile_001",
    caseReference: "case_reconcile_001",
    orderId: "order_reconcile_001" as AdapterPaymentLink["orderId"],
    amountSubunits: 149_900,
    currency: "INR",
    status,
    createdAt: "2026-08-26T09:30:00.000Z",
    expiresAt: "2026-08-27T09:30:00.000Z",
    updatedAt: "2026-08-26T09:30:00.000Z",
  };
}

function setup(
  options: {
    payment?: Partial<AdapterPayment>;
    caseState?: "AWAITING_POLICY" | "LINK_CREATED" | "RECOVERED" | "STOPPED";
    withCase?: boolean;
    linkStatus?: AdapterPaymentLink["status"];
  } = {},
) {
  const database = createLocalDatabase(":memory:");
  databases.push(database);
  runDatabaseMigrations(database);
  const repositories = createSqliteRepositories(database);
  const audit = createSqliteAuditChain(database);
  const payment = currentPayment(options.payment);
  const fixtures =
    options.linkStatus === undefined
      ? { payments: [payment] }
      : {
          payments: [payment],
          paymentLinks: [adapterLink(options.linkStatus)],
        };
  const adapter = new DeterministicMockRazorpayAdapter(fixtures);
  if (options.withCase !== false) {
    repositories.recoveryCases.create(
      recoveryCaseRecordSchema.parse({
        caseId: "case_reconcile_001",
        paymentId: "pay_reconcile_001",
        orderId: "order_reconcile_001",
        syntheticCustomerHash: "c".repeat(64),
        verifiedUnpaidAmountSubunits: 149_900,
        currency: "INR",
        state: options.caseState ?? "AWAITING_POLICY",
        attemptNumber: 1,
        previousSuccessCount: 0,
        previousFailureCount: 1,
        contactCount: options.caseState === "LINK_CREATED" ? 1 : 0,
        recoveryWindowStartsAt: paymentCreatedAt,
        recoveryWindowEndsAt: "2026-08-27T09:00:00.000Z",
        version: 1,
        createdAt: paymentCreatedAt,
        updatedAt: "2026-08-26T09:20:00.000Z",
      }),
    );
  }
  if (options.linkStatus !== undefined) {
    const link = adapterLink(options.linkStatus);
    repositories.paymentLinks.insert(
      paymentLinkRecordSchema.parse({
        recoveryLinkId: "link_reconcile_001",
        externalLinkId: link.externalLinkId,
        caseId: "case_reconcile_001",
        orderId: link.orderId,
        referenceId: link.referenceId,
        amountSubunits: link.amountSubunits,
        currency: link.currency,
        status: link.status,
        blocksCreation:
          link.status === "CREATED" || link.status === "PARTIALLY_PAID",
        createdAt: link.createdAt,
        expiresAt: link.expiresAt,
        ...(link.status === "PAID" ? { paidAt: link.updatedAt } : {}),
        ...(link.status === "CANCELLED" ? { cancelledAt: link.updatedAt } : {}),
        updatedAt: link.updatedAt,
      }),
    );
  }
  return {
    database,
    repositories,
    audit,
    adapter,
    reconciler: new PaymentStateReconciler({ adapter, repositories, audit }),
  };
}

function claimedEvent(
  environment: ReturnType<typeof setup>,
  options: {
    id?: string;
    name?:
      | "payment.failed"
      | "payment.authorized"
      | "payment.captured"
      | "order.paid";
    snapshotStatus?: "FAILED" | "AUTHORIZED" | "CAPTURED";
    paymentId?: string;
    orderId?: string;
    amountSubunits?: number;
    currency?: string;
  } = {},
) {
  const id = options.id ?? "evt_reconcile_001";
  const name = options.name ?? "payment.failed";
  const orderId = options.orderId ?? "order_reconcile_001";
  const paymentId = options.paymentId ?? "pay_reconcile_001";
  const status =
    options.snapshotStatus ??
    (name === "payment.authorized"
      ? "AUTHORIZED"
      : name === "payment.captured"
        ? "CAPTURED"
        : "FAILED");
  const event = normalizedPaymentEventSchema.parse(
    name === "order.paid"
      ? {
          eventId: id,
          eventName: name,
          occurredAt: paymentCreatedAt,
          receivedAt: checkedAt,
          orderId,
          signatureVerification: { status: "VERIFIED" },
          duplicateProcessing: { status: "FIRST_SEEN" },
        }
      : {
          eventId: id,
          eventName: name,
          occurredAt: paymentCreatedAt,
          receivedAt: checkedAt,
          paymentId,
          orderId,
          paymentSnapshot: {
            paymentId,
            orderId,
            money: {
              amountSubunits: options.amountSubunits ?? 149_900,
              currency: options.currency ?? "INR",
            },
            status,
            method: "upi",
            ...(status === "FAILED"
              ? { failure: { errorReason: "incorrect_otp" } }
              : {}),
            paymentCreatedAt,
          },
          signatureVerification: { status: "VERIFIED" },
          duplicateProcessing: { status: "FIRST_SEEN" },
        },
  );
  const claim = environment.repositories.webhookEvents.claim({
    internalEventId: event.eventId,
    providerEventId: event.eventId,
    event,
    createdAt: checkedAt,
    processedAt: checkedAt,
  });
  if (claim.status === "CONFLICT") throw new Error("Fixture event conflict.");
  return claim.event;
}

function reconcile(
  environment: ReturnType<typeof setup>,
  event = claimedEvent(environment),
) {
  return environment.reconciler.reconcile({
    event,
    checkedAt,
    timeoutMilliseconds: 1_000,
  });
}

afterEach(() => {
  for (const database of databases.splice(0)) database.client.close();
});

describe("payment-state reconciliation authority", () => {
  it("keeps a failed event eligible only when fetched current state is unpaid", async () => {
    const env = setup();
    await expect(reconcile(env)).resolves.toMatchObject({
      status: "UNPAID_CONFIRMED",
      currentStatus: "FAILED",
    });
    expect(
      env.repositories.recoveryCases.findById("case_reconcile_001"),
    ).toMatchObject({
      state: "AWAITING_POLICY",
      contactCount: 0,
    });
    expect(
      env.repositories.paymentSnapshots.listByPaymentId("pay_reconcile_001"),
    ).toHaveLength(2);
  });

  it.each([
    ["AUTHORIZED", "payment.authorized"],
    ["CAPTURED", "payment.captured"],
  ] as const)(
    "stops recovery when current state is %s",
    async (status, name) => {
      const env = setup({ payment: { status } });
      const event = claimedEvent(env, { name });
      await expect(reconcile(env, event)).resolves.toMatchObject({
        status: "RECOVERY_STOPPED",
        currentStatus: status,
      });
      expect(
        env.repositories.recoveryCases.findById("case_reconcile_001"),
      ).toMatchObject({ state: "STOPPED" });
    },
  );

  it("uses a unique case relationship to reconcile order.paid", async () => {
    const env = setup({ payment: { status: "CAPTURED" } });
    await expect(
      reconcile(env, claimedEvent(env, { name: "order.paid" })),
    ).resolves.toMatchObject({
      status: "RECOVERY_STOPPED",
      currentStatus: "CAPTURED",
    });
  });

  it.each([
    ["AUTHORIZED", "payment.authorized"],
    ["CAPTURED", "payment.captured"],
    ["CAPTURED", "order.paid"],
  ] as const)(
    "stops after a failed event is followed by %s current state via %s",
    async (status, name) => {
      const env = setup();
      await reconcile(
        env,
        claimedEvent(env, { id: `evt_failed_before_${status.toLowerCase()}` }),
      );
      env.adapter.setPaymentStatus("pay_reconcile_001", status);
      await reconcile(
        env,
        claimedEvent(env, {
          id: `evt_success_after_failure_${name.replace(".", "_")}`,
          name,
        }),
      );
      expect(
        env.repositories.recoveryCases.findById("case_reconcile_001"),
      ).toMatchObject({
        state: "STOPPED",
        contactCount: 0,
      });
      expect(
        env.repositories.recoveryActions.listByCaseId("case_reconcile_001"),
      ).toHaveLength(0);
    },
  );

  it("does not downgrade captured authority when captured is delivered before authorized", async () => {
    const env = setup({ payment: { status: "CAPTURED" } });
    await reconcile(
      env,
      claimedEvent(env, { id: "evt_captured_first", name: "payment.captured" }),
    );
    await reconcile(
      env,
      claimedEvent(env, {
        id: "evt_authorized_late",
        name: "payment.authorized",
      }),
    );
    expect(
      env.repositories.paymentSnapshots.findLatestReconciledByPaymentId(
        "pay_reconcile_001",
      ),
    ).toMatchObject({
      snapshot: { status: "CAPTURED" },
    });
    expect(
      env.repositories.recoveryCases.findById("case_reconcile_001"),
    ).toMatchObject({ state: "STOPPED", contactCount: 0 });
  });

  it("records stale authorized webhook history while fetched captured state remains authority", async () => {
    const env = setup({ payment: { status: "CAPTURED" } });
    const event = claimedEvent(env, { name: "payment.authorized" });
    await reconcile(env, event);
    expect(
      env.repositories.paymentSnapshots.findBySourceEventId(
        event.internalEventId,
        "WEBHOOK_EVIDENCE",
      ),
    ).toMatchObject({ snapshot: { status: "AUTHORIZED" } });
    expect(
      env.repositories.paymentSnapshots.findBySourceEventId(
        event.internalEventId,
        "PROVIDER_RECONCILED",
      ),
    ).toMatchObject({ snapshot: { status: "CAPTURED" } });
  });

  it("does not reactivate recovery for a stale failure after success", async () => {
    const env = setup({ payment: { status: "CAPTURED" } });
    await reconcile(
      env,
      claimedEvent(env, { id: "evt_success", name: "payment.captured" }),
    );
    await reconcile(
      env,
      claimedEvent(env, { id: "evt_stale_failure", name: "payment.failed" }),
    );
    expect(
      env.repositories.recoveryCases.findById("case_reconcile_001"),
    ).toMatchObject({ state: "STOPPED", version: 2, contactCount: 0 });
    expect(
      env.repositories.recoveryActions.listByCaseId("case_reconcile_001"),
    ).toHaveLength(0);
  });

  it("reconciles repeated logical current state without recovery side effects", async () => {
    const env = setup();
    await reconcile(env, claimedEvent(env, { id: "evt_repeat_a" }));
    await reconcile(env, claimedEvent(env, { id: "evt_repeat_b" }));
    expect(
      env.repositories.paymentSnapshots.listByPaymentId("pay_reconcile_001"),
    ).toHaveLength(4);
    expect(
      env.repositories.recoveryActions.listByCaseId("case_reconcile_001"),
    ).toHaveLength(0);
  });

  it.each([
    [
      "order identity",
      { orderId: "order_wrong" as AdapterPayment["orderId"] },
      "ORDER_ID_MISMATCH",
    ],
    ["amount", { amountSubunits: 149_901 }, "AMOUNT_MISMATCH"],
    ["currency", { currency: "USD" }, "CURRENCY_MISMATCH"],
  ] as const)("fails closed on %s mismatch", async (_label, payment, code) => {
    const env = setup({ payment });
    await expect(reconcile(env)).resolves.toMatchObject({
      status: "CURRENT_STATE_CONFLICT",
      resultCode: code,
    });
    expect(
      env.repositories.paymentSnapshots.findLatestReconciledByPaymentId(
        "pay_reconcile_001",
      ),
    ).toBeNull();
    expect(
      env.repositories.paymentLinks.listByCaseId("case_reconcile_001"),
    ).toHaveLength(0);
  });

  it("fails closed when fetched payment identity differs from the requested payment", async () => {
    const env = setup();
    const mismatched = currentPayment({
      paymentId: "pay_wrong" as AdapterPayment["paymentId"],
    });
    const adapter: RazorpayCapabilityPort = {
      fetchPayment: async () => ({ status: "AVAILABLE", payment: mismatched }),
      fetchDowntime: (...args) => env.adapter.fetchDowntime(...args),
      createPaymentLink: (...args) => env.adapter.createPaymentLink(...args),
      fetchPaymentLink: (...args) => env.adapter.fetchPaymentLink(...args),
      cancelPaymentLink: (...args) => env.adapter.cancelPaymentLink(...args),
    };
    const reconciler = new PaymentStateReconciler({
      adapter,
      repositories: env.repositories,
      audit: env.audit,
    });
    await expect(
      reconciler.reconcile({
        event: claimedEvent(env),
        checkedAt,
        timeoutMilliseconds: 1_000,
      }),
    ).resolves.toMatchObject({
      status: "CURRENT_STATE_CONFLICT",
      resultCode: "PAYMENT_ID_MISMATCH",
    });
  });

  it("fails closed when current-state lookup is unavailable", async () => {
    const env = setup();
    env.adapter.injectFailure(
      "FETCH_PAYMENT",
      "pay_reconcile_001",
      "DEPENDENCY_UNAVAILABLE",
    );
    await expect(reconcile(env)).resolves.toMatchObject({
      status: "CURRENT_STATE_UNAVAILABLE",
    });
    expect(
      env.repositories.recoveryCases.findById("case_reconcile_001"),
    ).toMatchObject({ state: "AWAITING_POLICY" });
  });

  it("rejects an impossible regression from captured authority to unpaid", async () => {
    const env = setup({ payment: { status: "CAPTURED" } });
    await reconcile(
      env,
      claimedEvent(env, {
        id: "evt_authority_captured",
        name: "payment.captured",
      }),
    );
    env.adapter.setPaymentStatus("pay_reconcile_001", "FAILED");
    await expect(
      reconcile(env, claimedEvent(env, { id: "evt_conflicting_current" })),
    ).resolves.toMatchObject({
      status: "CURRENT_STATE_CONFLICT",
      resultCode: "SATISFIED_STATE_REGRESSION",
    });
    expect(
      env.repositories.paymentSnapshots.findLatestReconciledByPaymentId(
        "pay_reconcile_001",
      ),
    ).toMatchObject({ snapshot: { status: "CAPTURED" } });
  });

  it("is replay-safe for the same provider event", async () => {
    const env = setup();
    const event = claimedEvent(env);
    await reconcile(env, event);
    await expect(reconcile(env, event)).resolves.toMatchObject({
      status: "IDEMPOTENT_REPLAY",
    });
    expect(
      env.adapter
        .getCallLog()
        .filter(({ operation }) => operation === "FETCH_PAYMENT"),
    ).toHaveLength(1);
    expect(
      env.repositories.paymentSnapshots.listByPaymentId("pay_reconcile_001"),
    ).toHaveLength(2);
  });

  it("concurrent attempts converge on one reconciled snapshot", async () => {
    const env = setup();
    const event = claimedEvent(env);
    const results = await Promise.all([
      reconcile(env, event),
      reconcile(env, event),
    ]);
    expect(results.map(({ status }) => status).sort()).toEqual([
      "IDEMPOTENT_REPLAY",
      "UNPAID_CONFIRMED",
    ]);
    expect(
      env.repositories.paymentSnapshots
        .listByPaymentId("pay_reconcile_001")
        .filter(({ origin }) => origin === "PROVIDER_RECONCILED"),
    ).toHaveLength(1);
  });

  it("concurrent late-success reconciliation stops a stale Payment Link creation", async () => {
    const env = setup();
    const staleCase =
      env.repositories.recoveryCases.findById("case_reconcile_001")!;
    let releaseFetch!: () => void;
    let fetchedUnpaid!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    const firstFetchReached = new Promise<void>((resolve) => {
      fetchedUnpaid = resolve;
    });
    let firstFetch = true;
    const racingAdapter: RazorpayCapabilityPort = {
      async fetchPayment(...args) {
        if (!firstFetch) return env.adapter.fetchPayment(...args);
        firstFetch = false;
        const unpaid = await env.adapter.fetchPayment(...args);
        fetchedUnpaid();
        await gate;
        return unpaid;
      },
      fetchDowntime: (...args) => env.adapter.fetchDowntime(...args),
      createPaymentLink: (...args) => env.adapter.createPaymentLink(...args),
      fetchPaymentLink: (...args) => env.adapter.fetchPaymentLink(...args),
      cancelPaymentLink: (...args) => env.adapter.cancelPaymentLink(...args),
    };
    const executor = new RecoveryActionExecutor({
      adapter: racingAdapter,
      repositories: env.repositories,
      audit: env.audit,
    });
    const execution = executor.execute({
      caseRecord: staleCase,
      decision: {
        caseId: staleCase.caseId,
        proposedAction: "SEND_PAYMENT_LINK",
        finalAction: "SEND_PAYMENT_LINK",
        outcome: "APPROVED",
        ruleId: "RACE_TEST_APPROVED",
        reason:
          "A deterministic fixture represents the earlier policy approval.",
        checksPerformed: [
          {
            ruleId: "RACE_TEST_APPROVED",
            status: "PASSED",
            reason: "The fixture was approved before the payment changed.",
          },
        ],
        caseState: staleCase.state,
        decidedAt: "2026-08-26T09:50:00.000Z",
      },
      intent: {
        action: "SEND_PAYMENT_LINK",
        orderId: staleCase.orderId,
        intendedAmountSubunits: staleCase.verifiedUnpaidAmountSubunits,
        intendedCurrency: staleCase.currency,
        linkUse: { mode: "CREATE_NEW" },
      },
      executedAt: checkedAt,
      timeoutMilliseconds: 1_000,
      linkExpiresAt: "2026-08-27T09:00:00.000Z",
    });
    await firstFetchReached;
    env.adapter.setPaymentStatus("pay_reconcile_001", "CAPTURED");
    await reconcile(
      env,
      claimedEvent(env, {
        id: "evt_concurrent_capture",
        name: "payment.captured",
      }),
    );
    releaseFetch();
    await expect(execution).resolves.toMatchObject({
      status: "FAILED_SAFE",
      resultCode: "CASE_STATE_STALE",
    });
    expect(
      env.adapter
        .getCallLog()
        .filter(({ operation }) => operation === "CREATE_PAYMENT_LINK"),
    ).toHaveLength(0);
    expect(
      env.repositories.paymentLinks.listByCaseId(staleCase.caseId),
    ).toHaveLength(0);
  });
});

describe("late-success stopping and simulated link cancellation", () => {
  it("cancels one eligible unpaid simulated recovery link", async () => {
    const env = setup({
      payment: { status: "CAPTURED" },
      caseState: "LINK_CREATED",
      linkStatus: "CREATED",
    });
    await expect(
      reconcile(env, claimedEvent(env, { name: "payment.captured" })),
    ).resolves.toMatchObject({
      status: "RECOVERY_STOPPED",
      resultCode: "PAYMENT_LINK_CANCELLED",
    });
    expect(
      env.repositories.paymentLinks.findByRecoveryLinkId("link_reconcile_001"),
    ).toMatchObject({ status: "CANCELLED", blocksCreation: false });
    expect(
      env.adapter
        .getCallLog()
        .filter(({ operation }) => operation === "CANCEL_PAYMENT_LINK"),
    ).toHaveLength(1);
  });

  it.each(["PAID", "PARTIALLY_PAID", "EXPIRED", "CANCELLED"] as const)(
    "never cancels a %s simulated recovery link",
    async (linkStatus) => {
      const env = setup({
        payment: { status: "AUTHORIZED" },
        caseState: "LINK_CREATED",
        linkStatus,
      });
      const result = await reconcile(
        env,
        claimedEvent(env, { name: "payment.authorized" }),
      );
      expect(["RECOVERY_STOPPED", "STOPPED_REVIEW_REQUIRED"]).toContain(
        result.status,
      );
      expect(
        env.adapter
          .getCallLog()
          .filter(({ operation }) => operation === "CANCEL_PAYMENT_LINK"),
      ).toHaveLength(0);
      expect(
        env.repositories.paymentLinks.findByRecoveryLinkId(
          "link_reconcile_001",
        ),
      ).toMatchObject({ status: linkStatus });
    },
  );

  it("uses the latest fetched terminal link state and skips cancellation", async () => {
    const env = setup({
      payment: { status: "CAPTURED" },
      caseState: "LINK_CREATED",
      linkStatus: "CREATED",
    });
    env.adapter.setPaymentLinkStatus("plink_reconcile_001", "PAID", checkedAt);
    await expect(
      reconcile(env, claimedEvent(env, { name: "payment.captured" })),
    ).resolves.toMatchObject({ status: "RECOVERY_STOPPED" });
    expect(
      env.repositories.paymentLinks.findByRecoveryLinkId("link_reconcile_001"),
    ).toMatchObject({ status: "PAID" });
    expect(
      env.adapter
        .getCallLog()
        .filter(({ operation }) => operation === "CANCEL_PAYMENT_LINK"),
    ).toHaveLength(0);
  });

  it("fails closed for review when latest simulated link state is unavailable", async () => {
    const env = setup({
      payment: { status: "AUTHORIZED" },
      caseState: "LINK_CREATED",
      linkStatus: "CREATED",
    });
    env.adapter.injectFailure(
      "FETCH_PAYMENT_LINK",
      "plink_reconcile_001",
      "DEPENDENCY_UNAVAILABLE",
    );
    await expect(
      reconcile(env, claimedEvent(env, { name: "payment.authorized" })),
    ).resolves.toMatchObject({ status: "STOPPED_REVIEW_REQUIRED" });
    expect(
      env.repositories.recoveryCases.findById("case_reconcile_001"),
    ).toMatchObject({ state: "STOPPED" });
    expect(
      env.repositories.paymentLinks.findByRecoveryLinkId("link_reconcile_001"),
    ).toMatchObject({ status: "CREATED" });
    expect(
      env.adapter
        .getCallLog()
        .filter(({ operation }) => operation === "CANCEL_PAYMENT_LINK"),
    ).toHaveLength(0);
  });

  it("does not repeat cancellation across replay, later success, or concurrency", async () => {
    const env = setup({
      payment: { status: "CAPTURED" },
      caseState: "LINK_CREATED",
      linkStatus: "CREATED",
    });
    const first = claimedEvent(env, {
      id: "evt_cancel_once",
      name: "payment.captured",
    });
    await Promise.all([reconcile(env, first), reconcile(env, first)]);
    await reconcile(
      env,
      claimedEvent(env, { id: "evt_cancel_later", name: "payment.authorized" }),
    );
    expect(
      env.adapter
        .getCallLog()
        .filter(({ operation }) => operation === "CANCEL_PAYMENT_LINK"),
    ).toHaveLength(1);
    expect(
      env.repositories.recoveryActions
        .listByCaseId("case_reconcile_001")
        .filter(({ action }) => action === "CANCEL_RECOVERY_ALREADY_PAID"),
    ).toHaveLength(1);
  });

  it("never reactivates a terminal case when a later current state is unpaid", async () => {
    const env = setup({ caseState: "STOPPED" });
    await reconcile(env);
    expect(
      env.repositories.recoveryCases.findById("case_reconcile_001"),
    ).toMatchObject({ state: "STOPPED", version: 1, contactCount: 0 });
  });

  it("keeps the tamper-evident audit chain valid and distinguishes webhook from current state", async () => {
    const env = setup({
      payment: { status: "CAPTURED" },
      caseState: "LINK_CREATED",
      linkStatus: "CREATED",
    });
    await reconcile(env, claimedEvent(env, { name: "payment.failed" }));
    expect(env.audit.verify()).toMatchObject({ status: "VALID" });
    const entries = env.audit.readOrdered();
    expect(
      entries.some(
        ({ metadata }) =>
          metadata.webhookStatus === "payment.failed" &&
          metadata.currentStatus === "CAPTURED",
      ),
    ).toBe(true);
    expect(
      entries.some(
        ({ eventType }) => eventType === "LATE_SUCCESS_CANCELLATION_RESOLVED",
      ),
    ).toBe(true);
  });
});
