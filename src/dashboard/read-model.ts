import "server-only";

import { desc, eq } from "drizzle-orm";

import type { SqliteAuditChain } from "@/audit";
import {
  auditReadModelSchema,
  eventStreamReadModelSchema,
  policyReadModelSchema,
  type AuditReadModel,
  type EventStreamReadModel,
  type PolicyReadModel,
} from "@/dashboard/contracts";
import { normalizedPaymentEventSchema } from "@/domain/events";
import { policyDecisionSchema } from "@/domain/policy";
import type { LocalDatabase } from "@/lib/db/client";
import {
  paymentSnapshots,
  policyDecisions,
  recoveryCases,
  webhookEvents,
} from "@/lib/db/schema";
import { DEFAULT_POLICY_CONFIG } from "@/policy/config";
import type { DemoScenarioStore } from "@/dashboard/scenario-store";
import { RECOVERY_ACTIONS } from "@/domain/actions";

export class DashboardReadModelService {
  readonly #database: LocalDatabase;
  readonly #audit: SqliteAuditChain;
  readonly #scenarios: DemoScenarioStore;

  constructor(input: {
    database: LocalDatabase;
    audit: SqliteAuditChain;
    scenarios: DemoScenarioStore;
  }) {
    this.#database = input.database;
    this.#audit = input.audit;
    this.#scenarios = input.scenarios;
  }

  eventStream(): EventStreamReadModel {
    const scenarioRows = this.#scenarios
      .list()
      .scenarios.flatMap((scenario) => scenario.result?.events ?? [])
      .map((row) => ({
        ...row,
        caseReference:
          row.resultingCaseState === null
            ? null
            : `case_${row.safeReference.replace(/^evt_/, "")}`.slice(0, 128),
      }));

    const persistedRows = this.#database.db
      .select()
      .from(webhookEvents)
      .orderBy(desc(webhookEvents.receivedAt))
      .limit(100)
      .all()
      .map((row, index) => {
        const event = normalizedPaymentEventSchema.parse(
          JSON.parse(row.normalizedEventJson),
        );
        const current =
          event.paymentId === undefined
            ? undefined
            : this.#database.db
                .select()
                .from(paymentSnapshots)
                .where(eq(paymentSnapshots.paymentId, event.paymentId))
                .orderBy(
                  desc(paymentSnapshots.observedAt),
                  desc(paymentSnapshots.snapshotSequence),
                )
                .limit(1)
                .get();
        const recoveryCase =
          event.paymentId === undefined
            ? undefined
            : this.#database.db
                .select()
                .from(recoveryCases)
                .where(eq(recoveryCases.paymentId, event.paymentId))
                .get();
        return {
          delivery: index + 1,
          eventType: event.eventName,
          safeReference: row.providerEventId,
          deliveredAt: event.receivedAt,
          signatureStatus:
            event.signatureVerification.status === "VERIFIED"
              ? "VERIFIED"
              : "NOT_CHECKED",
          deliveryStatus: "ORIGINAL" as const,
          webhookSnapshotState: event.paymentSnapshot?.status ?? null,
          authoritativeCurrentState: current?.status ?? null,
          diagnosis: null,
          proposedAction: null,
          policyOutcome: null,
          finalAction: null,
          resultingCaseState: recoveryCase?.state ?? null,
          caseReference: recoveryCase?.caseId ?? null,
        };
      });

    const rows = [...scenarioRows, ...persistedRows].slice(0, 250);
    const generatedFrom =
      scenarioRows.length > 0 && persistedRows.length > 0
        ? "COMBINED"
        : scenarioRows.length > 0
          ? "PERSISTED_DEMO_SCENARIOS"
          : persistedRows.length > 0
            ? "PERSISTED_OPERATIONAL_EVENTS"
            : "EMPTY_DEMO";
    return eventStreamReadModelSchema.parse({ rows, generatedFrom });
  }

  policy(): PolicyReadModel {
    const persisted = this.#database.db
      .select()
      .from(policyDecisions)
      .orderBy(desc(policyDecisions.decidedAt))
      .limit(50)
      .all()
      .map((row) => {
        const decision = policyDecisionSchema.parse(
          JSON.parse(row.decisionJson),
        );
        return {
          caseReference: decision.caseId,
          proposedAction: decision.proposedAction,
          finalAction: decision.finalAction ?? null,
          outcome: decision.outcome,
          primaryRule: decision.ruleId,
          reason: decision.reason,
          checks: decision.checksPerformed,
        };
      });
    const scenarioDecisions = this.#scenarios
      .list()
      .scenarios.flatMap((scenario) => {
        const result = scenario.result;
        if (
          result === undefined ||
          result.policyOutcome === null ||
          result.primaryRule === null ||
          result.proposedAction === null
        ) {
          return [];
        }
        return [
          {
            caseReference: `scenario:${result.scenarioKey}`,
            proposedAction: result.proposedAction,
            finalAction: result.finalAction,
            outcome: result.policyOutcome,
            primaryRule: result.primaryRule,
            reason: result.summary,
            checks: result.policyChecks,
          },
        ];
      });
    return policyReadModelSchema.parse({
      maxPaymentLinksPerOrder: DEFAULT_POLICY_CONFIG.maxPaymentLinksPerOrder,
      maxCustomerContacts: DEFAULT_POLICY_CONFIG.maxCustomerContacts,
      maxRecoveryWindowHours:
        DEFAULT_POLICY_CONFIG.maxRecoveryWindowMilliseconds / 3_600_000,
      minimumConfidencePercent:
        DEFAULT_POLICY_CONFIG.minAiConfidenceMillionths / 10_000,
      allowedActions: [...RECOVERY_ACTIONS],
      integrityRules: [
        "Exact verified amount and currency must match the server-owned action intent.",
        "Current payment state is re-fetched before a material recovery action.",
        "Only one active simulated Payment Link may block an order at a time.",
        "Expected value must remain positive after explicit simulated costs and risk penalties.",
        "Paid, terminal, expired, cancelled, or out-of-window cases cannot continue recovery.",
      ],
      recentDecisions: [...scenarioDecisions, ...persisted].slice(0, 100),
    });
  }

  audit(): AuditReadModel {
    const verification = this.#audit.verify();
    if (verification.status === "INVALID") {
      return auditReadModelSchema.parse({
        status: "INVALID",
        issue: verification.issue,
        entries: [],
      });
    }
    const entries = this.#audit.readOrdered().map((entry) => ({
      sequence: entry.sequence,
      timestamp: entry.timestamp,
      actor: entry.actor,
      inputReference: entry.inputReference,
      eventType: entry.eventType,
      reason: entry.reason,
      previousState: entry.previousState,
      newState: entry.newState,
      previousHash: entry.previousHash,
      currentHash: entry.currentHash,
    }));
    return auditReadModelSchema.parse({
      status: "VALID",
      chainVersion: verification.checkpoint.chainVersion,
      entryCount: verification.checkpoint.entryCount,
      latestSequence: verification.checkpoint.lastSequence,
      headHash: verification.checkpoint.headHash,
      entries,
    });
  }
}
