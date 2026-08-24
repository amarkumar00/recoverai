import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createSqliteAuditChain } from "@/audit";
import {
  normalizedPaymentEventSchema,
  simulatedEvaluationResultSchema,
} from "@/domain";
import {
  canonicalTime,
  syntheticCustomerHash,
  validAiRecommendation,
  validAuditEntry,
  validNormalizedEvent,
  validPolicyDecision,
  validSimulatedEvaluation,
} from "@/domain/__tests__/fixtures";
import { createLocalDatabase } from "@/lib/db/client";
import { runDatabaseMigrations } from "@/lib/db/migrations";
import {
  aiRecommendationRecordSchema,
  evaluationRunRecordSchema,
  paymentLinkLifecycleUpdateSchema,
  paymentLinkRecordSchema,
  paymentSnapshotObservationSchema,
  policyDecisionRecordSchema,
  recoveryActionRecordSchema,
  recoveryActionStatusUpdateSchema,
  recoveryCaseRecordSchema,
  recoveryCaseVersionUpdateSchema,
  webhookEventClaimSchema,
} from "@/repositories/contracts";
import {
  createSqliteRepositories,
  PersistedDataValidationError,
} from "@/repositories/sqlite";

const laterTime = "2026-08-24T12:31:00.000Z";
const latestTime = "2026-08-24T12:32:00.000Z";
const temporaryDirectories: string[] = [];

function openMigratedDatabase(name = "repository.db") {
  const directory = mkdtempSync(join(tmpdir(), "recoverai-repository-"));
  temporaryDirectories.push(directory);
  const path = join(directory, name);
  const database = createLocalDatabase(path);
  runDatabaseMigrations(database);
  return { database, path };
}

function makeRecoveryCase(overrides: Record<string, unknown> = {}) {
  return recoveryCaseRecordSchema.parse({
    caseId: "case_demo_001",
    paymentId: "pay_demo_001",
    orderId: "order_demo_001",
    syntheticCustomerHash,
    verifiedUnpaidAmountSubunits: 125_000,
    currency: "INR",
    state: "DETECTED",
    attemptNumber: 1,
    previousSuccessCount: 0,
    previousFailureCount: 1,
    contactCount: 0,
    recoveryWindowStartsAt: canonicalTime,
    recoveryWindowEndsAt: latestTime,
    version: 1,
    createdAt: canonicalTime,
    updatedAt: canonicalTime,
    ...overrides,
  });
}

function makeWebhookClaim(
  providerEventId = "provider_event_001",
  internalEventId = "event_internal_001",
) {
  return webhookEventClaimSchema.parse({
    internalEventId,
    providerEventId,
    event: normalizedPaymentEventSchema.parse(validNormalizedEvent),
    payloadDigest: "c".repeat(64),
    createdAt: canonicalTime,
    processedAt: canonicalTime,
  });
}

function makeSnapshot(
  status: "FAILED" | "AUTHORIZED" | "CAPTURED",
  observedAt: string,
) {
  return paymentSnapshotObservationSchema.parse({
    snapshot: {
      paymentId: "pay_demo_001",
      orderId: "order_demo_001",
      money: { amountSubunits: 125_000, currency: "INR" },
      status,
      method: "upi",
      bankOrProvider: "synthetic_provider",
      failure:
        status === "FAILED" ? { errorCode: "BAD_REQUEST_ERROR" } : undefined,
      paymentCreatedAt: canonicalTime,
    },
    observedAt,
    createdAt: observedAt,
  });
}

function makeAction(overrides: Record<string, unknown> = {}) {
  return recoveryActionRecordSchema.parse({
    actionRecordId: "action_record_001",
    caseId: "case_demo_001",
    action: "WAIT_FOR_RECOVERY",
    status: "REQUESTED",
    idempotencyKey: "action_idempotency_001",
    attemptCount: 0,
    requestedAt: canonicalTime,
    createdAt: canonicalTime,
    updatedAt: canonicalTime,
    ...overrides,
  });
}

function makeLink(overrides: Record<string, unknown> = {}) {
  return paymentLinkRecordSchema.parse({
    recoveryLinkId: "link_internal_001",
    caseId: "case_demo_001",
    orderId: "order_demo_001",
    referenceId: "recoverai_reference_001",
    amountSubunits: 125_000,
    currency: "INR",
    status: "CREATED",
    blocksCreation: true,
    createdAt: canonicalTime,
    updatedAt: canonicalTime,
    ...overrides,
  });
}

function toAuditCommand(entry: typeof validAuditEntry) {
  return {
    entryId: entry.entryId,
    timestamp: entry.timestamp,
    actor: entry.actor,
    inputReference: entry.inputReference,
    eventType: entry.eventType,
    reason: entry.reason,
    previousState: entry.previousState,
    newState: entry.newState,
    metadata: entry.metadata,
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("SQLite repositories", () => {
  it("round-trips validated webhook, case, AI, policy, action, link, audit, and simulated evaluation records", () => {
    const { database } = openMigratedDatabase();
    const repositories = createSqliteRepositories(database);

    try {
      const webhook = repositories.webhookEvents.claim(makeWebhookClaim());
      expect(webhook.status).toBe("FIRST_SEEN");
      expect(
        repositories.webhookEvents.findByProviderEventId("provider_event_001")
          ?.event,
      ).toEqual(normalizedPaymentEventSchema.parse(validNormalizedEvent));

      const recoveryCase = makeRecoveryCase();
      expect(repositories.recoveryCases.create(recoveryCase)).toEqual(
        recoveryCase,
      );

      const recommendation = aiRecommendationRecordSchema.parse({
        recommendationId: "recommendation_001",
        recommendation: validAiRecommendation,
        createdAt: canonicalTime,
      });
      expect(repositories.aiRecommendations.insert(recommendation)).toEqual(
        recommendation,
      );
      expect(
        repositories.aiRecommendations.listByCaseId("case_demo_001"),
      ).toEqual([recommendation]);

      const policy = policyDecisionRecordSchema.parse({
        decisionId: "decision_001",
        decision: validPolicyDecision,
        createdAt: canonicalTime,
      });
      expect(repositories.policyDecisions.insert(policy)).toEqual(policy);

      const action = makeAction();
      expect(repositories.recoveryActions.recordIdempotently(action)).toEqual({
        status: "CREATED",
        action,
      });

      const link = makeLink();
      expect(repositories.paymentLinks.insert(link)).toEqual({
        status: "CREATED",
        paymentLink: link,
      });

      const auditChain = createSqliteAuditChain(database);
      const auditCommand = toAuditCommand(validAuditEntry);
      const auditResult = auditChain.append(auditCommand);
      expect(auditResult.status).toBe("APPENDED");
      expect(repositories.auditEntries.readOrdered()).toEqual(
        auditResult.status === "APPENDED" ? [auditResult.entry] : [],
      );

      const evaluation = evaluationRunRecordSchema.parse({
        result: validSimulatedEvaluation,
        createdAt: canonicalTime,
      });
      expect(repositories.evaluationRuns.insert(evaluation)).toEqual(
        evaluation,
      );
      expect(repositories.evaluationRuns.findById("eval_demo_001")).toEqual(
        evaluation,
      );
    } finally {
      database.client.close();
    }
  });

  it("atomically distinguishes first-seen and competing duplicate webhook claims", () => {
    const { database: firstDatabase, path } = openMigratedDatabase();
    const secondDatabase = createLocalDatabase(path);
    const firstRepositories = createSqliteRepositories(firstDatabase);
    const secondRepositories = createSqliteRepositories(secondDatabase);

    try {
      const outcomes = [
        firstRepositories.webhookEvents.claim(
          makeWebhookClaim("provider_competing_001", "event_competing_001"),
        ),
        secondRepositories.webhookEvents.claim(
          makeWebhookClaim("provider_competing_001", "event_competing_002"),
        ),
      ];

      expect(outcomes.map(({ status }) => status).sort()).toEqual([
        "DUPLICATE",
        "FIRST_SEEN",
      ]);
      const count = firstDatabase.client
        .prepare(
          "SELECT count(*) AS count FROM webhook_events WHERE provider_event_id = ?",
        )
        .get("provider_competing_001") as { count: number };
      expect(count.count).toBe(1);
    } finally {
      secondDatabase.client.close();
      firstDatabase.client.close();
    }
  });

  it("preserves snapshot history and selects the latest observation deterministically", () => {
    const { database } = openMigratedDatabase();
    const repositories = createSqliteRepositories(database);

    try {
      repositories.paymentSnapshots.append(
        makeSnapshot("FAILED", canonicalTime),
      );
      repositories.paymentSnapshots.append(
        makeSnapshot("AUTHORIZED", laterTime),
      );
      repositories.paymentSnapshots.append(makeSnapshot("CAPTURED", laterTime));

      const history =
        repositories.paymentSnapshots.listByPaymentId("pay_demo_001");
      expect(history).toHaveLength(3);
      expect(history.map(({ snapshot }) => snapshot.status)).toEqual([
        "FAILED",
        "AUTHORIZED",
        "CAPTURED",
      ]);
      expect(
        repositories.paymentSnapshots.findLatestByPaymentId("pay_demo_001")
          ?.snapshot.status,
      ).toBe("CAPTURED");
    } finally {
      database.client.close();
    }
  });

  it("enforces integer money, canonical case state, allowlisted action, and foreign keys at the database boundary", () => {
    const { database } = openMigratedDatabase();

    try {
      const insertCase = database.client.prepare(`
        INSERT INTO recovery_cases (
          case_id, payment_id, order_id, synthetic_customer_hash,
          verified_unpaid_amount_subunits, currency, state, attempt_number,
          previous_success_count, previous_failure_count, contact_count,
          version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'INR', ?, 1, 0, 0, 0, 1, ?, ?)
      `);

      expect(() =>
        insertCase.run(
          "case_negative",
          "pay_negative",
          "order_negative",
          syntheticCustomerHash,
          -1,
          "DETECTED",
          canonicalTime,
          canonicalTime,
        ),
      ).toThrow();
      expect(() =>
        insertCase.run(
          "case_fractional",
          "pay_fractional",
          "order_fractional",
          syntheticCustomerHash,
          10.5,
          "DETECTED",
          canonicalTime,
          canonicalTime,
        ),
      ).toThrow();
      expect(() =>
        insertCase.run(
          "case_invalid_state",
          "pay_invalid_state",
          "order_invalid_state",
          syntheticCustomerHash,
          100,
          "RETRYING",
          canonicalTime,
          canonicalTime,
        ),
      ).toThrow();

      const repositories = createSqliteRepositories(database);
      repositories.recoveryCases.create(makeRecoveryCase());
      expect(() =>
        database.client
          .prepare(
            `INSERT INTO recovery_actions (
              action_record_id, case_id, action, status, idempotency_key,
              attempt_count, requested_at, created_at, updated_at
            ) VALUES (?, ?, ?, 'REQUESTED', ?, 0, ?, ?, ?)`,
          )
          .run(
            "action_invalid",
            "case_demo_001",
            "RETRY_ORIGINAL_PAYMENT",
            "invalid_action_key",
            canonicalTime,
            canonicalTime,
            canonicalTime,
          ),
      ).toThrow();
      expect(() =>
        database.client
          .prepare(
            `INSERT INTO ai_recommendations (
              recommendation_id, case_id, recommendation_json,
              selected_action, confidence_millionths, context_status,
              escalation_recommended, recommended_at, created_at
            ) VALUES ('recommendation_orphan', 'case_missing', '{}',
              'ESCALATE_HUMAN', 1000000, 'INSUFFICIENT', 1, ?, ?)`,
          )
          .run(canonicalTime, canonicalTime),
      ).toThrow();
    } finally {
      database.client.close();
    }
  });

  it("enforces one blocking link per order while permitting terminal history", () => {
    const { database } = openMigratedDatabase();
    const repositories = createSqliteRepositories(database);

    try {
      repositories.recoveryCases.create(makeRecoveryCase());
      const first = makeLink();
      expect(repositories.paymentLinks.insert(first).status).toBe("CREATED");

      const competing = makeLink({
        recoveryLinkId: "link_internal_002",
        referenceId: "recoverai_reference_002",
      });
      expect(repositories.paymentLinks.insert(competing)).toMatchObject({
        status: "CONFLICT",
        reason: "ORDER_ALREADY_BLOCKED",
        paymentLink: { recoveryLinkId: "link_internal_001" },
      });

      expect(
        repositories.paymentLinks.updateLifecycle(
          paymentLinkLifecycleUpdateSchema.parse({
            recoveryLinkId: "link_internal_001",
            status: "CANCELLED",
            blocksCreation: false,
            cancelledAt: laterTime,
            updatedAt: laterTime,
          }),
        )?.status,
      ).toBe("CANCELLED");

      expect(repositories.paymentLinks.insert(competing).status).toBe(
        "CREATED",
      );
      expect(
        repositories.paymentLinks.updateLifecycle(
          paymentLinkLifecycleUpdateSchema.parse({
            recoveryLinkId: "link_internal_002",
            status: "PAID",
            blocksCreation: false,
            paidAt: latestTime,
            updatedAt: latestTime,
          }),
        )?.status,
      ).toBe("PAID");

      const expiredHistory = makeLink({
        recoveryLinkId: "link_internal_003",
        referenceId: "recoverai_reference_003",
        status: "EXPIRED",
        blocksCreation: false,
        expiresAt: latestTime,
        updatedAt: latestTime,
      });
      expect(repositories.paymentLinks.insert(expiredHistory).status).toBe(
        "CREATED",
      );
    } finally {
      database.client.close();
    }
  });

  it("keeps partially paid links blocking and reports duplicate references explicitly", () => {
    const { database } = openMigratedDatabase();
    const repositories = createSqliteRepositories(database);

    try {
      repositories.recoveryCases.create(makeRecoveryCase());
      repositories.paymentLinks.insert(makeLink());
      repositories.paymentLinks.updateLifecycle(
        paymentLinkLifecycleUpdateSchema.parse({
          recoveryLinkId: "link_internal_001",
          status: "PARTIALLY_PAID",
          blocksCreation: true,
          updatedAt: laterTime,
        }),
      );

      expect(
        repositories.paymentLinks.insert(
          makeLink({
            recoveryLinkId: "link_internal_002",
            referenceId: "recoverai_reference_002",
          }),
        ),
      ).toMatchObject({
        status: "CONFLICT",
        reason: "ORDER_ALREADY_BLOCKED",
      });
      expect(
        repositories.paymentLinks.insert(
          makeLink({
            recoveryLinkId: "link_internal_003",
            referenceId: "recoverai_reference_001",
            orderId: "order_demo_002",
          }),
        ),
      ).toMatchObject({
        status: "CONFLICT",
        reason: "REFERENCE_EXISTS",
      });
    } finally {
      database.client.close();
    }
  });

  it("handles recovery-action idempotency without replacing the first record", () => {
    const { database } = openMigratedDatabase();
    const repositories = createSqliteRepositories(database);

    try {
      repositories.recoveryCases.create(makeRecoveryCase());
      const first = makeAction();
      expect(
        repositories.recoveryActions.recordIdempotently(first).status,
      ).toBe("CREATED");
      const duplicate = makeAction({
        actionRecordId: "action_record_002",
        action: "ESCALATE_HUMAN",
      });
      expect(
        repositories.recoveryActions.recordIdempotently(duplicate),
      ).toEqual({ status: "EXISTING", action: first });
    } finally {
      database.client.close();
    }
  });

  it("uses compare-and-set recovery-action lifecycle transitions", () => {
    const { database } = openMigratedDatabase();
    const repositories = createSqliteRepositories(database);

    try {
      repositories.recoveryCases.create(makeRecoveryCase());
      repositories.recoveryActions.recordIdempotently(makeAction());
      expect(
        repositories.recoveryActions.updateIfStatus(
          recoveryActionStatusUpdateSchema.parse({
            actionRecordId: "action_record_001",
            expectedStatus: "REQUESTED",
            status: "STARTED",
            attemptCount: 1,
            startedAt: laterTime,
            updatedAt: laterTime,
          }),
        ),
      ).toMatchObject({
        status: "UPDATED",
        action: { status: "STARTED", attemptCount: 1 },
      });
      expect(
        repositories.recoveryActions.updateIfStatus(
          recoveryActionStatusUpdateSchema.parse({
            actionRecordId: "action_record_001",
            expectedStatus: "REQUESTED",
            status: "FAILED_SAFE",
            attemptCount: 0,
            safeResultCode: "STALE_WRITER",
            completedAt: latestTime,
            updatedAt: latestTime,
          }),
        ),
      ).toMatchObject({
        status: "STATUS_MISMATCH",
        action: { status: "STARTED", attemptCount: 1 },
      });
      expect(
        repositories.recoveryActions.updateIfStatus(
          recoveryActionStatusUpdateSchema.parse({
            actionRecordId: "action_record_001",
            expectedStatus: "STARTED",
            status: "SUCCEEDED",
            attemptCount: 1,
            safeResultCode: "WAIT_RECORDED",
            completedAt: latestTime,
            updatedAt: latestTime,
          }),
        ),
      ).toMatchObject({
        status: "UPDATED",
        action: { status: "SUCCEEDED", safeResultCode: "WAIT_RECORDED" },
      });
    } finally {
      database.client.close();
    }
  });

  it("persists failed-safe and cancelled terminal action outcomes", () => {
    const { database } = openMigratedDatabase();
    const repositories = createSqliteRepositories(database);

    try {
      repositories.recoveryCases.create(makeRecoveryCase());
      repositories.recoveryActions.recordIdempotently(
        makeAction({
          actionRecordId: "action_record_failed",
          idempotencyKey: "action_idempotency_failed",
        }),
      );
      expect(
        repositories.recoveryActions.updateIfStatus(
          recoveryActionStatusUpdateSchema.parse({
            actionRecordId: "action_record_failed",
            expectedStatus: "REQUESTED",
            status: "FAILED_SAFE",
            attemptCount: 0,
            safeResultCode: "DEPENDENCY_UNAVAILABLE",
            safeErrorReason: "The bounded dependency was unavailable.",
            completedAt: laterTime,
            updatedAt: laterTime,
          }),
        ),
      ).toMatchObject({ status: "UPDATED", action: { status: "FAILED_SAFE" } });

      repositories.recoveryActions.recordIdempotently(
        makeAction({
          actionRecordId: "action_record_cancelled",
          idempotencyKey: "action_idempotency_cancelled",
        }),
      );
      repositories.recoveryActions.updateIfStatus(
        recoveryActionStatusUpdateSchema.parse({
          actionRecordId: "action_record_cancelled",
          expectedStatus: "REQUESTED",
          status: "STARTED",
          attemptCount: 1,
          startedAt: laterTime,
          updatedAt: laterTime,
        }),
      );
      expect(
        repositories.recoveryActions.updateIfStatus(
          recoveryActionStatusUpdateSchema.parse({
            actionRecordId: "action_record_cancelled",
            expectedStatus: "STARTED",
            status: "CANCELLED",
            attemptCount: 1,
            safeResultCode: "EXECUTION_CANCELLED",
            completedAt: latestTime,
            updatedAt: latestTime,
          }),
        ),
      ).toMatchObject({ status: "UPDATED", action: { status: "CANCELLED" } });
    } finally {
      database.client.close();
    }
  });

  it("uses optimistic versions so stale case updates cannot overwrite newer data", () => {
    const { database } = openMigratedDatabase();
    const repositories = createSqliteRepositories(database);

    try {
      repositories.recoveryCases.create(makeRecoveryCase());
      expect(
        repositories.recoveryCases.updateIfVersionMatches(
          recoveryCaseVersionUpdateSchema.parse({
            caseId: "case_demo_001",
            expectedVersion: 1,
            state: "VERIFYING",
            updatedAt: laterTime,
          }),
        ),
      ).toMatchObject({
        status: "UPDATED",
        recoveryCase: { state: "VERIFYING", version: 2 },
      });
      expect(
        repositories.recoveryCases.updateIfVersionMatches(
          recoveryCaseVersionUpdateSchema.parse({
            caseId: "case_demo_001",
            expectedVersion: 1,
            state: "STOPPED",
            updatedAt: latestTime,
          }),
        ),
      ).toMatchObject({
        status: "VERSION_MISMATCH",
        recoveryCase: { state: "VERIFYING", version: 2 },
      });
    } finally {
      database.client.close();
    }
  });

  it("keeps audit access append-only and reads entries in deterministic order", () => {
    const { database } = openMigratedDatabase();
    const repositories = createSqliteRepositories(database);

    try {
      const auditChain = createSqliteAuditChain(database);
      const baseCommand = toAuditCommand(validAuditEntry);
      expect(
        auditChain.append({
          ...baseCommand,
          entryId: "audit_demo_002",
          timestamp: laterTime,
        }).status,
      ).toBe("APPENDED");
      expect(
        auditChain.append({ ...baseCommand, entryId: "audit_demo_001" }).status,
      ).toBe("APPENDED");

      expect(
        repositories.auditEntries.readOrdered().map(({ entryId }) => entryId),
      ).toEqual(["audit_demo_002", "audit_demo_001"]);
      expect(Object.keys(repositories.auditEntries).sort()).toEqual([
        "readOrdered",
      ]);
    } finally {
      database.client.close();
    }
  });

  it("revalidates structured JSON on read and fails closed when storage is corrupt", () => {
    const { database } = openMigratedDatabase();
    const repositories = createSqliteRepositories(database);

    try {
      repositories.recoveryCases.create(makeRecoveryCase());
      repositories.aiRecommendations.insert(
        aiRecommendationRecordSchema.parse({
          recommendationId: "recommendation_001",
          recommendation: validAiRecommendation,
          createdAt: canonicalTime,
        }),
      );
      database.client
        .prepare(
          "UPDATE ai_recommendations SET recommendation_json = ? WHERE recommendation_id = ?",
        )
        .run(
          '{"selectedAction":"ARBITRARY_MONEY_ACTION"}',
          "recommendation_001",
        );

      expect(() =>
        repositories.aiRecommendations.listByCaseId("case_demo_001"),
      ).toThrow(PersistedDataValidationError);
    } finally {
      database.client.close();
    }
  });

  it("preserves a signed negative incremental simulated recovery value", () => {
    const { database } = openMigratedDatabase();
    const repositories = createSqliteRepositories(database);

    try {
      const negativeResult = simulatedEvaluationResultSchema.parse({
        ...validSimulatedEvaluation,
        evaluationRunId: "eval_negative_001",
        baselineSimulatedRecovery: {
          amountSubunits: 30_000_000,
          currency: "INR",
        },
        recoverAiSimulatedRecovery: {
          amountSubunits: 25_000_000,
          currency: "INR",
        },
        incrementalSimulatedRecovery: {
          subunitDelta: -5_000_000,
          currency: "INR",
        },
      });
      repositories.evaluationRuns.insert({
        result: negativeResult,
        createdAt: canonicalTime,
      });

      expect(
        repositories.evaluationRuns.findById("eval_negative_001")?.result
          .incrementalSimulatedRecovery.subunitDelta,
      ).toBe(-5_000_000);
      const stored = database.client
        .prepare(
          "SELECT incremental_simulated_recovery_subunits AS delta FROM evaluation_runs WHERE evaluation_run_id = ?",
        )
        .get("eval_negative_001") as { delta: number };
      expect(stored.delta).toBe(-5_000_000);
    } finally {
      database.client.close();
    }
  });

  it("supports an explicit transaction boundary without business orchestration", () => {
    const { database } = openMigratedDatabase();
    const repositories = createSqliteRepositories(database);

    try {
      repositories.transaction((transactionRepositories) => {
        transactionRepositories.recoveryCases.create(makeRecoveryCase());
        transactionRepositories.paymentSnapshots.append(
          makeSnapshot("FAILED", canonicalTime),
        );
      });
      expect(
        repositories.recoveryCases.findById("case_demo_001"),
      ).not.toBeNull();
      expect(
        repositories.paymentSnapshots.listByPaymentId("pay_demo_001"),
      ).toHaveLength(1);
    } finally {
      database.client.close();
    }
  });

  it("supports narrow conflict-aware idempotency needed for orchestration resume", () => {
    const { database } = openMigratedDatabase();
    const repositories = createSqliteRepositories(database);

    try {
      repositories.webhookEvents.claim(makeWebhookClaim());
      const snapshot = paymentSnapshotObservationSchema.parse({
        ...makeSnapshot("FAILED", canonicalTime),
        sourceEventId: "event_internal_001",
      });
      expect(
        repositories.paymentSnapshots.appendIdempotently(snapshot).status,
      ).toBe("CREATED");
      expect(
        repositories.paymentSnapshots.appendIdempotently(snapshot).status,
      ).toBe("EXISTING");
      expect(
        repositories.paymentSnapshots.appendIdempotently({
          ...snapshot,
          observedAt: laterTime,
        }).status,
      ).toBe("CONFLICT");

      const recoveryCase = makeRecoveryCase();
      expect(
        repositories.recoveryCases.createIdempotently(recoveryCase).status,
      ).toBe("CREATED");
      expect(
        repositories.recoveryCases.createIdempotently(recoveryCase).status,
      ).toBe("EXISTING");
      expect(
        repositories.recoveryCases.createIdempotently({
          ...recoveryCase,
          verifiedUnpaidAmountSubunits: 999_999,
        }).status,
      ).toBe("CONFLICT");

      const recommendation = aiRecommendationRecordSchema.parse({
        recommendationId: "recommendation_resume_001",
        recommendation: validAiRecommendation,
        createdAt: canonicalTime,
      });
      expect(
        repositories.aiRecommendations.insertIdempotently(recommendation)
          .status,
      ).toBe("CREATED");
      expect(
        repositories.aiRecommendations.insertIdempotently(recommendation)
          .status,
      ).toBe("EXISTING");
      expect(
        repositories.aiRecommendations.findById("recommendation_resume_001"),
      ).toEqual(recommendation);

      const decision = policyDecisionRecordSchema.parse({
        decisionId: "decision_resume_001",
        decision: validPolicyDecision,
        createdAt: canonicalTime,
      });
      expect(
        repositories.policyDecisions.insertIdempotently(decision).status,
      ).toBe("CREATED");
      expect(
        repositories.policyDecisions.insertIdempotently(decision).status,
      ).toBe("EXISTING");
      expect(
        repositories.policyDecisions.findById("decision_resume_001"),
      ).toEqual(decision);
    } finally {
      database.client.close();
    }
  });

  it("loads in a Node test environment with no UI or route runtime", () => {
    const { database } = openMigratedDatabase();
    try {
      const repositories = createSqliteRepositories(database);
      expect(Object.keys(repositories)).toContain("webhookEvents");
      expect(typeof document).toBe("undefined");
      expect(typeof window).toBe("undefined");
    } finally {
      database.client.close();
    }
  });
});
