import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DeterministicMockRazorpayAdapter } from "@/adapters/razorpay";
import { createSqliteAuditChain } from "@/audit";
import type { RecoveryAction } from "@/domain/actions";
import { createLocalDatabase } from "@/lib/db/client";
import { runDatabaseMigrations } from "@/lib/db/migrations";
import type { RecoveryActionIntent } from "@/policy/contracts";
import { RecoveryActionExecutor } from "@/recovery/action-executor";
import type { RecoveryExecutionCommand } from "@/recovery/execution-contracts";
import {
  executionIdentifiers,
  RECOVERY_EXECUTION_IDENTIFIER_VERSION,
} from "@/recovery/idempotency";
import {
  paymentLinkRecordSchema,
  recoveryCaseRecordSchema,
} from "@/repositories/contracts";
import { createSqliteRepositories } from "@/repositories/sqlite";

const now = "2026-08-25T14:00:00.000Z";
const expiresAt = "2026-08-25T20:00:00.000Z";
const directories: string[] = [];

function caseRecord(overrides: Record<string, unknown> = {}) {
  return recoveryCaseRecordSchema.parse({
    caseId: "case_exec_001",
    paymentId: "pay_exec_001",
    orderId: "order_exec_001",
    syntheticCustomerHash: "a".repeat(64),
    verifiedUnpaidAmountSubunits: 100_000,
    currency: "INR",
    state: "AWAITING_POLICY",
    attemptNumber: 1,
    previousSuccessCount: 0,
    previousFailureCount: 1,
    contactCount: 0,
    recoveryWindowStartsAt: "2026-08-25T12:00:00.000Z",
    recoveryWindowEndsAt: expiresAt,
    version: 1,
    createdAt: "2026-08-25T12:00:00.000Z",
    updatedAt: now,
    ...overrides,
  });
}

function intent(
  action: RecoveryAction,
  overrides: Record<string, unknown> = {},
): RecoveryActionIntent {
  if (action === "SEND_PAYMENT_LINK" || action === "REQUEST_METHOD_CHANGE") {
    return {
      action,
      orderId: "order_exec_001",
      intendedAmountSubunits: 100_000,
      intendedCurrency: "INR",
      linkUse: { mode: "CREATE_NEW" },
      ...overrides,
    } as RecoveryActionIntent;
  }
  if (action === "CANCEL_RECOVERY_ALREADY_PAID") {
    return { action, ...overrides } as RecoveryActionIntent;
  }
  return { action } as RecoveryActionIntent;
}

function decision(
  action: RecoveryAction,
  outcome?: "APPROVED" | "BLOCKED" | "ESCALATED" | "STOPPED",
) {
  const resolvedOutcome =
    outcome ??
    (action === "ESCALATE_HUMAN"
      ? "ESCALATED"
      : action === "CANCEL_RECOVERY_ALREADY_PAID" ||
          action === "STOP_NON_RETRYABLE"
        ? "STOPPED"
        : "APPROVED");
  const finalAction =
    resolvedOutcome === "BLOCKED"
      ? undefined
      : resolvedOutcome === "ESCALATED"
        ? "ESCALATE_HUMAN"
        : action;
  return {
    caseId: "case_exec_001",
    proposedAction: action,
    ...(finalAction === undefined ? {} : { finalAction }),
    outcome: resolvedOutcome,
    ruleId: "EXECUTOR_TEST_RULE",
    reason: "A deterministic policy fixture supplied this bounded decision.",
    checksPerformed: [
      {
        ruleId: "EXECUTOR_TEST_RULE",
        status: resolvedOutcome === "BLOCKED" ? "FAILED" : "PASSED",
        reason: "The deterministic executor fixture evaluated the rule.",
      },
    ],
    caseState: "AWAITING_POLICY",
    decidedAt: "2026-08-25T13:59:00.000Z",
  };
}

function adapterPayment(overrides: Record<string, unknown> = {}) {
  return {
    paymentId: "pay_exec_001",
    orderId: "order_exec_001",
    amountSubunits: 100_000,
    currency: "INR",
    status: "FAILED",
    fetchedAt: now,
    ...overrides,
  };
}

function setup(
  action: RecoveryAction = "SEND_PAYMENT_LINK",
  options: {
    payment?: Record<string, unknown>;
    outcome?: "APPROVED" | "BLOCKED" | "ESCALATED" | "STOPPED";
    command?: Record<string, unknown>;
    intent?: Record<string, unknown>;
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "recoverai-executor-"));
  directories.push(directory);
  const database = createLocalDatabase(join(directory, "executor.db"));
  runDatabaseMigrations(database);
  const repositories = createSqliteRepositories(database);
  const record = caseRecord();
  repositories.recoveryCases.create(record);
  const adapter = new DeterministicMockRazorpayAdapter({
    payments: [adapterPayment(options.payment)],
    downtime: [{ method: "upi", bankOrProvider: "mock_bank", active: true }],
  });
  const audit = createSqliteAuditChain(database);
  const command = {
    caseRecord: record,
    decision: decision(action, options.outcome),
    intent: intent(action, options.intent),
    executedAt: now,
    timeoutMilliseconds: 1_000,
    linkExpiresAt: expiresAt,
    ...(action === "WAIT_FOR_RECOVERY"
      ? { downtimeLookup: { method: "upi", bankOrProvider: "mock_bank" } }
      : {}),
    ...options.command,
  } as RecoveryExecutionCommand;
  return {
    database,
    repositories,
    adapter,
    audit,
    command,
    executor: new RecoveryActionExecutor({ adapter, repositories, audit }),
  };
}

async function seedLink(
  environment: ReturnType<typeof setup>,
  status:
    "CREATED" | "PARTIALLY_PAID" | "PAID" | "CANCELLED" | "EXPIRED" = "CREATED",
) {
  const ids = executionIdentifiers(environment.command);
  const created = await environment.adapter.createPaymentLink(
    {
      referenceId: ids.paymentLinkReferenceId,
      caseReference: environment.command.caseRecord.caseId,
      paymentId: environment.command.caseRecord.paymentId,
      orderId: environment.command.caseRecord.orderId,
      amountSubunits:
        environment.command.caseRecord.verifiedUnpaidAmountSubunits,
      currency: environment.command.caseRecord.currency,
      description: "Synthetic cancellation fixture",
      expiresAt,
      requestedAt: now,
      metadata: { isSynthetic: true },
    },
    {
      requestedAt: now,
      timeoutMilliseconds: 1_000,
      signal: new AbortController().signal,
    },
  );
  if (created.status !== "CREATED")
    throw new Error("Mock link fixture was not created.");
  if (status !== "CREATED")
    environment.adapter.setPaymentLinkStatus(
      created.paymentLink.externalLinkId,
      status,
      now,
    );
  const result = environment.repositories.paymentLinks.insert(
    paymentLinkRecordSchema.parse({
      recoveryLinkId: "link_exec_001",
      externalLinkId: created.paymentLink.externalLinkId,
      caseId: environment.command.caseRecord.caseId,
      orderId: environment.command.caseRecord.orderId,
      referenceId: created.paymentLink.referenceId,
      amountSubunits: created.paymentLink.amountSubunits,
      currency: created.paymentLink.currency,
      status,
      blocksCreation: status === "CREATED" || status === "PARTIALLY_PAID",
      createdAt: now,
      expiresAt,
      ...(status === "PAID" ? { paidAt: now } : {}),
      ...(status === "CANCELLED" ? { cancelledAt: now } : {}),
      updatedAt: now,
    }),
  );
  return result.paymentLink;
}

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("idempotent audited recovery executor", () => {
  it("derives stable versioned identifiers that differ by action", () => {
    const first = setup();
    const second = setup("REQUEST_METHOD_CHANGE");
    try {
      const firstIds = executionIdentifiers(first.command);
      const replayIds = executionIdentifiers(first.command);
      expect({
        actionRecordId: replayIds.actionRecordId,
        idempotencyKey: replayIds.idempotencyKey,
        paymentLinkReferenceId: replayIds.paymentLinkReferenceId,
        recoveryLinkId: replayIds.recoveryLinkId,
        auditEntryId: replayIds.auditEntryId("requested"),
      }).toEqual({
        actionRecordId: firstIds.actionRecordId,
        idempotencyKey: firstIds.idempotencyKey,
        paymentLinkReferenceId: firstIds.paymentLinkReferenceId,
        recoveryLinkId: firstIds.recoveryLinkId,
        auditEntryId: firstIds.auditEntryId("requested"),
      });
      expect(executionIdentifiers(second.command).idempotencyKey).not.toBe(
        firstIds.idempotencyKey,
      );
      expect(RECOVERY_EXECUTION_IDENTIFIER_VERSION).toBe("recoverai_exec_v1");
      expect(firstIds.idempotencyKey).toMatch(/^ra_v1_idem_[a-f0-9]{24}$/);
      expect(JSON.stringify(firstIds)).not.toMatch(/email|phone|secret/i);
    } finally {
      first.database.client.close();
      second.database.client.close();
    }
  });

  it("creates one safe approved mock Payment Link", async () => {
    const env = setup();
    try {
      const result = await env.executor.execute(env.command);
      expect(result).toMatchObject({
        status: "EXECUTED",
        resultCode: "PAYMENT_LINK_CREATED",
        recoveryAction: { status: "SUCCEEDED" },
        paymentLink: { status: "CREATED" },
      });
      expect(env.audit.verify()).toMatchObject({ status: "VALID" });
    } finally {
      env.database.client.close();
    }
  });

  it("replays a successful execution with the same persisted link", async () => {
    const env = setup();
    try {
      const first = await env.executor.execute(env.command);
      const second = await env.executor.execute(env.command);
      expect(second).toMatchObject({ status: "IDEMPOTENT_REPLAY" });
      if ("paymentLink" in first && "paymentLink" in second)
        expect(second.paymentLink?.recoveryLinkId).toBe(
          first.paymentLink?.recoveryLinkId,
        );
    } finally {
      env.database.client.close();
    }
  });

  it("does not make a second adapter create call on replay", async () => {
    const env = setup();
    try {
      await env.executor.execute(env.command);
      await env.executor.execute(env.command);
      expect(
        env.adapter
          .getCallLog()
          .filter(({ operation }) => operation === "CREATE_PAYMENT_LINK"),
      ).toHaveLength(1);
    } finally {
      env.database.client.close();
    }
  });

  it("returns in-progress to a competing execution claim", async () => {
    const env = setup();
    try {
      const ids = executionIdentifiers(env.command);
      env.repositories.recoveryActions.recordIdempotently({
        actionRecordId: ids.actionRecordId,
        caseId: env.command.caseRecord.caseId,
        action: "SEND_PAYMENT_LINK",
        status: "STARTED",
        idempotencyKey: ids.idempotencyKey,
        attemptCount: 1,
        requestedAt: now,
        startedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      expect(await env.executor.execute(env.command)).toMatchObject({
        status: "IN_PROGRESS",
      });
      expect(env.adapter.getCallLog()).toHaveLength(0);
    } finally {
      env.database.client.close();
    }
  });

  it("allows only one adapter creation across concurrent execution attempts", async () => {
    const env = setup();
    try {
      const results = await Promise.all([
        env.executor.execute(env.command),
        env.executor.execute(env.command),
      ]);
      expect(results.map(({ status }) => status).sort()).toEqual([
        "EXECUTED",
        "IN_PROGRESS",
      ]);
      expect(
        env.adapter
          .getCallLog()
          .filter(({ operation }) => operation === "CREATE_PAYMENT_LINK"),
      ).toHaveLength(1);
    } finally {
      env.database.client.close();
    }
  });

  it.each(["AUTHORIZED", "CAPTURED"] as const)(
    "stops when payment becomes %s before creation",
    async (status) => {
      const env = setup("SEND_PAYMENT_LINK", { payment: { status } });
      try {
        expect(await env.executor.execute(env.command)).toMatchObject({
          status: "ALREADY_PAID_STOPPED",
        });
        expect(
          env.adapter
            .getCallLog()
            .filter(({ operation }) => operation === "CREATE_PAYMENT_LINK"),
        ).toHaveLength(0);
      } finally {
        env.database.client.close();
      }
    },
  );

  it("handles payment becoming captured immediately inside mock creation", async () => {
    const env = setup();
    try {
      const reference = executionIdentifiers(
        env.command,
      ).paymentLinkReferenceId;
      env.adapter.injectFailure(
        "CREATE_PAYMENT_LINK",
        reference,
        "PAYMENT_CAPTURED_BEFORE_CREATE",
      );
      expect(await env.executor.execute(env.command)).toMatchObject({
        status: "ALREADY_PAID_STOPPED",
      });
      expect(
        env.repositories.paymentLinks.findByReferenceId(reference),
      ).toBeNull();
    } finally {
      env.database.client.close();
    }
  });

  it("handles payment becoming authorized immediately inside mock creation", async () => {
    const env = setup();
    try {
      const reference = executionIdentifiers(
        env.command,
      ).paymentLinkReferenceId;
      env.adapter.injectFailure(
        "CREATE_PAYMENT_LINK",
        reference,
        "PAYMENT_AUTHORIZED_BEFORE_CREATE",
      );
      expect(await env.executor.execute(env.command)).toMatchObject({
        status: "ALREADY_PAID_STOPPED",
      });
      expect(
        env.repositories.paymentLinks.findByReferenceId(reference),
      ).toBeNull();
    } finally {
      env.database.client.close();
    }
  });

  it("prevents creation on payment-fetch timeout", async () => {
    const env = setup();
    try {
      env.adapter.injectFailure("FETCH_PAYMENT", "pay_exec_001", "TIMEOUT");
      expect(await env.executor.execute(env.command)).toMatchObject({
        status: "FAILED_SAFE",
        resultCode: "TIMEOUT",
      });
      expect(
        env.repositories.recoveryActions.findByIdempotencyKey(
          executionIdentifiers(env.command).idempotencyKey,
        ),
      ).toMatchObject({ status: "FAILED_SAFE", safeResultCode: "TIMEOUT" });
      expect(
        env.adapter
          .getCallLog()
          .filter(({ operation }) => operation === "CREATE_PAYMENT_LINK"),
      ).toHaveLength(0);
    } finally {
      env.database.client.close();
    }
  });

  it.each([
    ["TIMEOUT", "OUTCOME_UNCERTAIN"],
    ["DEPENDENCY_UNAVAILABLE", "DEPENDENCY_UNAVAILABLE"],
    ["INVALID_RESPONSE", "INVALID_RESPONSE"],
  ] as const)(
    "fails safe on create %s and never retries",
    async (failure, code) => {
      const env = setup();
      try {
        const reference = executionIdentifiers(
          env.command,
        ).paymentLinkReferenceId;
        env.adapter.injectFailure("CREATE_PAYMENT_LINK", reference, failure, 2);
        expect(await env.executor.execute(env.command)).toMatchObject({
          status: "FAILED_SAFE",
          resultCode: code,
        });
        expect(await env.executor.execute(env.command)).toMatchObject({
          status: "FAILED_SAFE",
        });
        expect(
          env.adapter
            .getCallLog()
            .filter(({ operation }) => operation === "CREATE_PAYMENT_LINK"),
        ).toHaveLength(1);
      } finally {
        env.database.client.close();
      }
    },
  );

  it.each([
    ["amountSubunits", 200_000, "AMOUNT_MISMATCH"],
    ["currency", "USD", "CURRENCY_MISMATCH"],
    ["orderId", "order_exec_other", "ORDER_ID_MISMATCH"],
  ])("prevents creation on trusted %s mismatch", async (field, value, code) => {
    const env = setup("SEND_PAYMENT_LINK", { payment: { [field]: value } });
    try {
      expect(await env.executor.execute(env.command)).toMatchObject({
        status: "FAILED_SAFE",
        resultCode: code,
      });
    } finally {
      env.database.client.close();
    }
  });

  it("reuses a safe existing blocking link without another creation", async () => {
    const env = setup();
    try {
      await seedLink(env);
      const baselineCalls = env.adapter.getCallLog().length;
      expect(await env.executor.execute(env.command)).toMatchObject({
        status: "LINK_REUSED",
      });
      expect(
        env.adapter
          .getCallLog()
          .slice(baselineCalls)
          .filter(({ operation }) => operation === "CREATE_PAYMENT_LINK"),
      ).toHaveLength(0);
    } finally {
      env.database.client.close();
    }
  });

  it("fails safe when an existing blocking link conflicts with trusted money", async () => {
    const env = setup();
    try {
      env.repositories.paymentLinks.insert(
        paymentLinkRecordSchema.parse({
          recoveryLinkId: "link_conflict_001",
          externalLinkId: "plink_conflict_001",
          caseId: env.command.caseRecord.caseId,
          orderId: env.command.caseRecord.orderId,
          referenceId: "reference_conflict_001",
          amountSubunits: 200_000,
          currency: "INR",
          status: "CREATED",
          blocksCreation: true,
          createdAt: now,
          expiresAt,
          updatedAt: now,
        }),
      );
      expect(await env.executor.execute(env.command)).toMatchObject({
        status: "FAILED_SAFE",
        resultCode: "BLOCKING_LINK_CONFLICT",
      });
      expect(
        env.adapter
          .getCallLog()
          .filter(({ operation }) => operation === "CREATE_PAYMENT_LINK"),
      ).toHaveLength(0);
    } finally {
      env.database.client.close();
    }
  });

  it("validates USE_EXISTING ownership and money", async () => {
    const env = setup("REQUEST_METHOD_CHANGE", {
      intent: {
        linkUse: { mode: "USE_EXISTING", recoveryLinkId: "link_exec_001" },
      },
    });
    try {
      await seedLink(env);
      expect(await env.executor.execute(env.command)).toMatchObject({
        status: "LINK_REUSED",
      });
    } finally {
      env.database.client.close();
    }
  });

  it("rejects USE_EXISTING when the requested local link does not exist", async () => {
    const env = setup("REQUEST_METHOD_CHANGE", {
      intent: {
        linkUse: { mode: "USE_EXISTING", recoveryLinkId: "link_missing_001" },
      },
    });
    try {
      expect(await env.executor.execute(env.command)).toMatchObject({
        status: "FAILED_SAFE",
        resultCode: "EXISTING_LINK_INVALID",
      });
      expect(
        env.adapter
          .getCallLog()
          .filter(({ operation }) => operation === "CREATE_PAYMENT_LINK"),
      ).toHaveLength(0);
    } finally {
      env.database.client.close();
    }
  });

  it("request-method-change prepares a link but never sends a message", async () => {
    const env = setup("REQUEST_METHOD_CHANGE");
    try {
      expect(await env.executor.execute(env.command)).toMatchObject({
        status: "EXECUTED",
      });
      expect(
        env.adapter
          .getCallLog()
          .some(({ operation }) => operation.includes("MESSAGE")),
      ).toBe(false);
    } finally {
      env.database.client.close();
    }
  });

  it("records a safe wait only when downtime is active", async () => {
    const env = setup("WAIT_FOR_RECOVERY");
    try {
      expect(await env.executor.execute(env.command)).toMatchObject({
        status: "EXECUTED",
        resultCode: "WAIT_RECORDED",
      });
    } finally {
      env.database.client.close();
    }
  });

  it("does not guess wait when downtime is unavailable", async () => {
    const env = setup("WAIT_FOR_RECOVERY");
    try {
      env.adapter.injectFailure(
        "FETCH_DOWNTIME",
        "upi:mock_bank",
        "DEPENDENCY_UNAVAILABLE",
      );
      expect(await env.executor.execute(env.command)).toMatchObject({
        status: "HUMAN_REVIEW_REQUIRED",
        resultCode: "DOWNTIME_UNAVAILABLE",
      });
    } finally {
      env.database.client.close();
    }
  });

  it("records stop without any adapter operation", async () => {
    const env = setup("STOP_NON_RETRYABLE");
    try {
      expect(await env.executor.execute(env.command)).toMatchObject({
        status: "EXECUTED",
      });
      expect(env.adapter.getCallLog()).toHaveLength(0);
    } finally {
      env.database.client.close();
    }
  });

  it("records human escalation without a financial operation", async () => {
    const env = setup("ESCALATE_HUMAN");
    try {
      expect(await env.executor.execute(env.command)).toMatchObject({
        status: "HUMAN_REVIEW_REQUIRED",
      });
      expect(env.adapter.getCallLog()).toHaveLength(0);
    } finally {
      env.database.client.close();
    }
  });

  it("rejects a blocked policy decision before action claim or adapter use", async () => {
    const env = setup("SEND_PAYMENT_LINK", { outcome: "BLOCKED" });
    try {
      expect(await env.executor.execute(env.command)).toMatchObject({
        status: "POLICY_REJECTED",
      });
      expect(env.adapter.getCallLog()).toHaveLength(0);
    } finally {
      env.database.client.close();
    }
  });

  it.each([
    { intent: { action: "STOP_NON_RETRYABLE" } },
    { caseRecord: { ...caseRecord(), caseId: "case_other" } },
    { timeoutMilliseconds: 0 },
    { unknownField: "unsafe" },
  ])(
    "fails malformed or inconsistent input before adapter use",
    async (override) => {
      const env = setup();
      try {
        expect(
          await env.executor.execute({ ...env.command, ...override }),
        ).toMatchObject({ status: "INVALID_INPUT" });
        expect(env.adapter.getCallLog()).toHaveLength(0);
      } finally {
        env.database.client.close();
      }
    },
  );

  it("keeps deterministic audit replay idempotent", async () => {
    const env = setup();
    try {
      await env.executor.execute(env.command);
      await env.executor.execute(env.command);
      const afterFirstReplay = env.audit.verify();
      await env.executor.execute(env.command);
      expect(env.audit.verify()).toEqual(afterFirstReplay);
      expect(env.audit.verify()).toMatchObject({ status: "VALID" });
    } finally {
      env.database.client.close();
    }
  });

  it("preserves a valid audit chain for a failed-safe adapter outcome", async () => {
    const env = setup();
    try {
      env.adapter.injectFailure("FETCH_PAYMENT", "pay_exec_001", "TIMEOUT");
      expect(await env.executor.execute(env.command)).toMatchObject({
        status: "FAILED_SAFE",
      });
      expect(env.audit.verify()).toMatchObject({ status: "VALID" });
    } finally {
      env.database.client.close();
    }
  });

  it("does not claim an action or call the adapter when the initial audit append fails", async () => {
    const env = setup();
    try {
      const executor = new RecoveryActionExecutor({
        adapter: env.adapter,
        repositories: env.repositories,
        audit: { append: () => ({ status: "CHAIN_CORRUPT" as const }) },
      });
      expect(await executor.execute(env.command)).toMatchObject({
        status: "AUDIT_INCOMPLETE",
        resultCode: "AUDIT_REQUEST_FAILED",
      });
      expect(env.adapter.getCallLog()).toHaveLength(0);
      expect(
        env.repositories.recoveryActions.findByIdempotencyKey(
          executionIdentifiers(env.command).idempotencyKey,
        ),
      ).toBeNull();
    } finally {
      env.database.client.close();
    }
  });

  it("returns audit-incomplete after creation without repeating the external operation", async () => {
    const env = setup();
    try {
      let callCount = 0;
      const executor = new RecoveryActionExecutor({
        adapter: env.adapter,
        repositories: env.repositories,
        audit: {
          append: (command) => {
            callCount += 1;
            return callCount === 6
              ? { status: "CHAIN_CORRUPT" as const }
              : env.audit.append(command);
          },
        },
      });
      expect(await executor.execute(env.command)).toMatchObject({
        status: "AUDIT_INCOMPLETE",
        resultCode: "AUDIT_POST_CALL_INCOMPLETE",
        paymentLink: { status: "CREATED" },
      });
      expect(await executor.execute(env.command)).toMatchObject({
        status: "IDEMPOTENT_REPLAY",
      });
      expect(
        env.adapter
          .getCallLog()
          .filter(({ operation }) => operation === "CREATE_PAYMENT_LINK"),
      ).toHaveLength(1);
    } finally {
      env.database.client.close();
    }
  });

  it("never copies unsafe adapter text into persisted audit entries", async () => {
    const env = setup();
    try {
      env.adapter.injectFailure(
        "CREATE_PAYMENT_LINK",
        executionIdentifiers(env.command).paymentLinkReferenceId,
        "DEPENDENCY_UNAVAILABLE",
      );
      await env.executor.execute(env.command);
      const serializedAudit = JSON.stringify(
        env.database.client
          .prepare(
            "SELECT reason, metadata_json FROM audit_entries ORDER BY sequence",
          )
          .all(),
      );
      expect(serializedAudit).not.toContain("credential");
      expect(serializedAudit).not.toContain("stack");
      expect(serializedAudit).not.toContain("secret");
      expect(serializedAudit).not.toContain("http");
    } finally {
      env.database.client.close();
    }
  });
});

describe("safe cancellation lifecycle", () => {
  it("cancels an eligible link exactly once and replays without another call", async () => {
    const env = setup("CANCEL_RECOVERY_ALREADY_PAID");
    try {
      const link = await seedLink(env);
      env.command.intent = intent("CANCEL_RECOVERY_ALREADY_PAID", {
        recoveryLinkId: link.recoveryLinkId,
      });
      expect(await env.executor.execute(env.command)).toMatchObject({
        status: "EXECUTED",
        resultCode: "PAYMENT_LINK_CANCELLED",
      });
      expect(await env.executor.execute(env.command)).toMatchObject({
        status: "IDEMPOTENT_REPLAY",
      });
      expect(
        env.adapter
          .getCallLog()
          .filter(({ operation }) => operation === "CANCEL_PAYMENT_LINK"),
      ).toHaveLength(1);
    } finally {
      env.database.client.close();
    }
  });

  it.each([
    ["PAID", "ALREADY_PAID_STOPPED"],
    ["PARTIALLY_PAID", "HUMAN_REVIEW_REQUIRED"],
    ["EXPIRED", "NO_OP_TERMINAL"],
    ["CANCELLED", "NO_OP_TERMINAL"],
  ] as const)(
    "handles local %s as %s without cancellation",
    async (linkStatus, resultStatus) => {
      const env = setup("CANCEL_RECOVERY_ALREADY_PAID");
      try {
        const link = await seedLink(env, linkStatus);
        env.command.intent = intent("CANCEL_RECOVERY_ALREADY_PAID", {
          recoveryLinkId: link.recoveryLinkId,
        });
        expect(await env.executor.execute(env.command)).toMatchObject({
          status: resultStatus,
        });
        expect(
          env.adapter
            .getCallLog()
            .filter(({ operation }) => operation === "CANCEL_PAYMENT_LINK"),
        ).toHaveLength(0);
      } finally {
        env.database.client.close();
      }
    },
  );

  it("records cancellation timeout once and never auto-retries", async () => {
    const env = setup("CANCEL_RECOVERY_ALREADY_PAID");
    try {
      const link = await seedLink(env);
      env.command.intent = intent("CANCEL_RECOVERY_ALREADY_PAID", {
        recoveryLinkId: link.recoveryLinkId,
      });
      env.adapter.injectFailure(
        "CANCEL_PAYMENT_LINK",
        link.externalLinkId!,
        "TIMEOUT",
        2,
      );
      expect(await env.executor.execute(env.command)).toMatchObject({
        status: "FAILED_SAFE",
        resultCode: "OUTCOME_UNCERTAIN",
      });
      expect(await env.executor.execute(env.command)).toMatchObject({
        status: "FAILED_SAFE",
      });
      expect(
        env.adapter
          .getCallLog()
          .filter(({ operation }) => operation === "CANCEL_PAYMENT_LINK"),
      ).toHaveLength(1);
    } finally {
      env.database.client.close();
    }
  });

  it("handles a link becoming paid immediately before cancellation", async () => {
    const env = setup("CANCEL_RECOVERY_ALREADY_PAID");
    try {
      const link = await seedLink(env);
      env.command.intent = intent("CANCEL_RECOVERY_ALREADY_PAID", {
        recoveryLinkId: link.recoveryLinkId,
      });
      env.adapter.injectFailure(
        "CANCEL_PAYMENT_LINK",
        link.externalLinkId!,
        "LINK_PAID_BEFORE_CANCEL",
      );
      expect(await env.executor.execute(env.command)).toMatchObject({
        status: "ALREADY_PAID_STOPPED",
      });
      expect(
        env.repositories.paymentLinks.findByRecoveryLinkId(link.recoveryLinkId),
      ).toMatchObject({ status: "PAID" });
    } finally {
      env.database.client.close();
    }
  });
});
