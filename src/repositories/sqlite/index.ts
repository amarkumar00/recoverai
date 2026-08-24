import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";

import {
  aiRecommendationSchema,
  auditEntrySchema,
  eventIdSchema,
  failureContextSchema,
  normalizedPaymentEventSchema,
  paymentIdSchema,
  policyDecisionSchema,
  simulatedEvaluationResultSchema,
} from "@/domain";
import type { LocalDatabase } from "@/lib/db/client";
import {
  aiRecommendations,
  auditEntries,
  evaluationRuns,
  paymentLinks,
  paymentSnapshots,
  policyDecisions,
  recoveryActions,
  recoveryCases,
  webhookEvents,
} from "@/lib/db/schema";
import {
  aiRecommendationRecordSchema,
  evaluationRunRecordSchema,
  paymentLinkLifecycleUpdateSchema,
  paymentLinkRecordSchema,
  paymentSnapshotObservationSchema,
  persistedPaymentSnapshotSchema,
  persistedWebhookEventSchema,
  policyDecisionRecordSchema,
  recoveryActionRecordSchema,
  recoveryCaseRecordSchema,
  recoveryCaseVersionUpdateSchema,
  webhookEventClaimSchema,
  type AiRecommendationRecord,
  type EvaluationRunRecord,
  type PaymentLinkLifecycleUpdate,
  type PaymentLinkRecord,
  type PaymentSnapshotObservation,
  type PersistedPaymentSnapshot,
  type PersistedWebhookEvent,
  type PolicyDecisionRecord,
  type RecoveryActionRecord,
  type RecoveryCaseRecord,
  type RecoveryCaseVersionUpdate,
  type WebhookEventClaim,
} from "@/repositories/contracts";
import type {
  AuditEntryRepository,
  EvaluationRunRepository,
  PaymentLinkInsertResult,
  RecoverAiRepositories,
  RecoverAiRepositorySet,
  RecoveryCaseVersionUpdateResult,
  WebhookClaimResult,
} from "@/repositories/interfaces";

export class PersistedDataValidationError extends Error {
  constructor(label: string, options?: ErrorOptions) {
    super(`Persisted ${label} failed validation.`, options);
    this.name = "PersistedDataValidationError";
  }
}

export class UnexpectedPersistenceConflictError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "UnexpectedPersistenceConflictError";
  }
}

function parseStoredJson<T>(
  serialized: string,
  schema: z.ZodType<T>,
  label: string,
): T {
  try {
    return schema.parse(JSON.parse(serialized));
  } catch (error) {
    throw new PersistedDataValidationError(label, { cause: error });
  }
}

function toPersistedWebhookEvent(
  row: typeof webhookEvents.$inferSelect,
): PersistedWebhookEvent {
  return persistedWebhookEventSchema.parse({
    internalEventId: row.id,
    providerEventId: row.providerEventId,
    event: parseStoredJson(
      row.normalizedEventJson,
      normalizedPaymentEventSchema,
      "webhook event JSON",
    ),
    payloadDigest: row.payloadDigest ?? undefined,
    createdAt: row.createdAt,
    processedAt: row.processedAt ?? undefined,
    safeErrorReason: row.safeErrorReason ?? undefined,
    processingStatus: row.processingStatus,
  });
}

function toPersistedPaymentSnapshot(
  row: typeof paymentSnapshots.$inferSelect,
): PersistedPaymentSnapshot {
  const failure =
    row.failureJson === null
      ? undefined
      : parseStoredJson(
          row.failureJson,
          failureContextSchema,
          "payment failure JSON",
        );

  return persistedPaymentSnapshotSchema.parse({
    snapshotSequence: row.snapshotSequence,
    snapshot: {
      paymentId: row.paymentId,
      orderId: row.orderId,
      money: {
        amountSubunits: row.amountSubunits,
        currency: row.currency,
      },
      status: row.status,
      method: row.method,
      bankOrProvider: row.bankOrProvider ?? undefined,
      failure,
      paymentCreatedAt: row.providerCreatedAt,
    },
    observedAt: row.observedAt,
    sourceEventId: row.sourceEventId ?? undefined,
    createdAt: row.createdAt,
  });
}

function toRecoveryCase(
  row: typeof recoveryCases.$inferSelect,
): RecoveryCaseRecord {
  return recoveryCaseRecordSchema.parse({
    caseId: row.caseId,
    paymentId: row.paymentId,
    orderId: row.orderId,
    syntheticCustomerHash: row.syntheticCustomerHash,
    verifiedUnpaidAmountSubunits: row.verifiedUnpaidAmountSubunits,
    currency: row.currency,
    state: row.state,
    attemptNumber: row.attemptNumber,
    previousSuccessCount: row.previousSuccessCount,
    previousFailureCount: row.previousFailureCount,
    contactCount: row.contactCount,
    recoveryWindowStartsAt: row.recoveryWindowStartsAt ?? undefined,
    recoveryWindowEndsAt: row.recoveryWindowEndsAt ?? undefined,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function toRecoveryAction(
  row: typeof recoveryActions.$inferSelect,
): RecoveryActionRecord {
  return recoveryActionRecordSchema.parse({
    actionRecordId: row.actionRecordId,
    caseId: row.caseId,
    action: row.action,
    status: row.status,
    idempotencyKey: row.idempotencyKey,
    attemptCount: row.attemptCount,
    safeResultCode: row.safeResultCode ?? undefined,
    safeResultDetail: row.safeResultDetail ?? undefined,
    safeErrorReason: row.safeErrorReason ?? undefined,
    requestedAt: row.requestedAt,
    startedAt: row.startedAt ?? undefined,
    completedAt: row.completedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function toPaymentLink(
  row: typeof paymentLinks.$inferSelect,
): PaymentLinkRecord {
  return paymentLinkRecordSchema.parse({
    recoveryLinkId: row.recoveryLinkId,
    externalLinkId: row.externalLinkId ?? undefined,
    caseId: row.caseId,
    orderId: row.orderId,
    referenceId: row.referenceId,
    amountSubunits: row.amountSubunits,
    currency: row.currency,
    status: row.status,
    blocksCreation: row.blocksCreation,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt ?? undefined,
    paidAt: row.paidAt ?? undefined,
    cancelledAt: row.cancelledAt ?? undefined,
    updatedAt: row.updatedAt,
  });
}

function createRepositorySet(database: LocalDatabase): RecoverAiRepositorySet {
  const { db } = database;

  const webhookEventRepository = {
    claim(rawInput: WebhookEventClaim): WebhookClaimResult {
      const input = webhookEventClaimSchema.parse(rawInput);
      const result = db
        .insert(webhookEvents)
        .values({
          id: input.internalEventId,
          providerEventId: input.providerEventId,
          eventName: input.event.eventName,
          occurredAt: input.event.occurredAt,
          receivedAt: input.event.receivedAt,
          signatureStatus: input.event.signatureVerification.status,
          processingStatus: "FIRST_SEEN",
          paymentId: input.event.paymentId,
          orderId: input.event.orderId,
          recoveryLinkId: input.event.recoveryLinkId,
          normalizedEventJson: JSON.stringify(input.event),
          payloadDigest: input.payloadDigest,
          createdAt: input.createdAt,
          processedAt: input.processedAt,
          safeErrorReason: input.safeErrorReason,
        })
        .onConflictDoNothing({ target: webhookEvents.providerEventId })
        .run();

      const row = db
        .select()
        .from(webhookEvents)
        .where(eq(webhookEvents.providerEventId, input.providerEventId))
        .get();

      if (row === undefined) {
        throw new UnexpectedPersistenceConflictError(
          "Webhook claim completed without a retrievable record.",
        );
      }

      return {
        status: result.changes === 1 ? "FIRST_SEEN" : "DUPLICATE",
        event: toPersistedWebhookEvent(row),
      };
    },

    findByProviderEventId(providerEventId: string) {
      const validatedId = eventIdSchema.parse(providerEventId);
      const row = db
        .select()
        .from(webhookEvents)
        .where(eq(webhookEvents.providerEventId, validatedId))
        .get();
      return row === undefined ? null : toPersistedWebhookEvent(row);
    },
  };

  const paymentSnapshotRepository = {
    append(rawInput: PaymentSnapshotObservation) {
      const input = paymentSnapshotObservationSchema.parse(rawInput);
      const result = db
        .insert(paymentSnapshots)
        .values({
          paymentId: input.snapshot.paymentId,
          orderId: input.snapshot.orderId,
          amountSubunits: input.snapshot.money.amountSubunits,
          currency: input.snapshot.money.currency,
          status: input.snapshot.status,
          method: input.snapshot.method,
          bankOrProvider: input.snapshot.bankOrProvider,
          failureJson:
            input.snapshot.failure === undefined
              ? undefined
              : JSON.stringify(input.snapshot.failure),
          providerCreatedAt: input.snapshot.paymentCreatedAt,
          observedAt: input.observedAt,
          sourceEventId: input.sourceEventId,
          createdAt: input.createdAt,
        })
        .returning()
        .get();
      return toPersistedPaymentSnapshot(result);
    },

    findLatestByPaymentId(paymentId: string) {
      const validatedId = paymentIdSchema.parse(paymentId);
      const row = db
        .select()
        .from(paymentSnapshots)
        .where(eq(paymentSnapshots.paymentId, validatedId))
        .orderBy(
          desc(paymentSnapshots.observedAt),
          desc(paymentSnapshots.snapshotSequence),
        )
        .get();
      return row === undefined ? null : toPersistedPaymentSnapshot(row);
    },

    listByPaymentId(paymentId: string) {
      const validatedId = paymentIdSchema.parse(paymentId);
      return db
        .select()
        .from(paymentSnapshots)
        .where(eq(paymentSnapshots.paymentId, validatedId))
        .orderBy(
          asc(paymentSnapshots.observedAt),
          asc(paymentSnapshots.snapshotSequence),
        )
        .all()
        .map(toPersistedPaymentSnapshot);
    },
  };

  const recoveryCaseRepository = {
    create(rawInput: RecoveryCaseRecord) {
      const input = recoveryCaseRecordSchema.parse(rawInput);
      const row = db.insert(recoveryCases).values(input).returning().get();
      return toRecoveryCase(row);
    },

    findById(caseId: string) {
      const validatedId = recoveryCaseRecordSchema.shape.caseId.parse(caseId);
      const row = db
        .select()
        .from(recoveryCases)
        .where(eq(recoveryCases.caseId, validatedId))
        .get();
      return row === undefined ? null : toRecoveryCase(row);
    },

    findByPaymentId(paymentId: string) {
      const validatedId = paymentIdSchema.parse(paymentId);
      const row = db
        .select()
        .from(recoveryCases)
        .where(eq(recoveryCases.paymentId, validatedId))
        .get();
      return row === undefined ? null : toRecoveryCase(row);
    },

    updateIfVersionMatches(
      rawInput: RecoveryCaseVersionUpdate,
    ): RecoveryCaseVersionUpdateResult {
      const input = recoveryCaseVersionUpdateSchema.parse(rawInput);
      const updated = db
        .update(recoveryCases)
        .set({
          state: input.state,
          attemptNumber: input.attemptNumber,
          previousSuccessCount: input.previousSuccessCount,
          previousFailureCount: input.previousFailureCount,
          contactCount: input.contactCount,
          updatedAt: input.updatedAt,
          version: input.expectedVersion + 1,
        })
        .where(
          and(
            eq(recoveryCases.caseId, input.caseId),
            eq(recoveryCases.version, input.expectedVersion),
          ),
        )
        .returning()
        .get();

      if (updated !== undefined) {
        return { status: "UPDATED", recoveryCase: toRecoveryCase(updated) };
      }

      const current = this.findById(input.caseId);
      return { status: "VERSION_MISMATCH", recoveryCase: current };
    },
  };

  const aiRecommendationRepository = {
    insert(rawInput: AiRecommendationRecord) {
      const input = aiRecommendationRecordSchema.parse(rawInput);
      db.insert(aiRecommendations)
        .values({
          recommendationId: input.recommendationId,
          caseId: input.recommendation.caseId,
          recommendationJson: JSON.stringify(input.recommendation),
          selectedAction: input.recommendation.selectedAction,
          confidence: Math.round(input.recommendation.confidence * 1_000_000),
          contextStatus: input.recommendation.contextStatus,
          escalationRecommended: input.recommendation.escalationRecommended,
          recommendedAt: input.recommendation.recommendedAt,
          createdAt: input.createdAt,
        })
        .run();
      return input;
    },

    listByCaseId(caseId: string) {
      const validatedId = recoveryCaseRecordSchema.shape.caseId.parse(caseId);
      return db
        .select()
        .from(aiRecommendations)
        .where(eq(aiRecommendations.caseId, validatedId))
        .orderBy(
          asc(aiRecommendations.recommendedAt),
          asc(aiRecommendations.recommendationId),
        )
        .all()
        .map((row) =>
          aiRecommendationRecordSchema.parse({
            recommendationId: row.recommendationId,
            recommendation: parseStoredJson(
              row.recommendationJson,
              aiRecommendationSchema,
              "AI recommendation JSON",
            ),
            createdAt: row.createdAt,
          }),
        );
    },
  };

  const policyDecisionRepository = {
    insert(rawInput: PolicyDecisionRecord) {
      const input = policyDecisionRecordSchema.parse(rawInput);
      db.insert(policyDecisions)
        .values({
          decisionId: input.decisionId,
          caseId: input.decision.caseId,
          decisionJson: JSON.stringify(input.decision),
          proposedAction: input.decision.proposedAction,
          finalAction: input.decision.finalAction,
          outcome: input.decision.outcome,
          ruleId: input.decision.ruleId,
          reason: input.decision.reason,
          caseState: input.decision.caseState,
          decidedAt: input.decision.decidedAt,
          createdAt: input.createdAt,
        })
        .run();
      return input;
    },

    listByCaseId(caseId: string) {
      const validatedId = recoveryCaseRecordSchema.shape.caseId.parse(caseId);
      return db
        .select()
        .from(policyDecisions)
        .where(eq(policyDecisions.caseId, validatedId))
        .orderBy(
          asc(policyDecisions.decidedAt),
          asc(policyDecisions.decisionId),
        )
        .all()
        .map((row) =>
          policyDecisionRecordSchema.parse({
            decisionId: row.decisionId,
            decision: parseStoredJson(
              row.decisionJson,
              policyDecisionSchema,
              "policy decision JSON",
            ),
            createdAt: row.createdAt,
          }),
        );
    },
  };

  const recoveryActionRepository = {
    recordIdempotently(rawInput: RecoveryActionRecord) {
      const input = recoveryActionRecordSchema.parse(rawInput);
      const result = db
        .insert(recoveryActions)
        .values(input)
        .onConflictDoNothing({ target: recoveryActions.idempotencyKey })
        .run();
      const row = db
        .select()
        .from(recoveryActions)
        .where(eq(recoveryActions.idempotencyKey, input.idempotencyKey))
        .get();
      if (row === undefined) {
        throw new UnexpectedPersistenceConflictError(
          "Recovery action idempotency claim has no persisted record.",
        );
      }
      return {
        status:
          result.changes === 1 ? ("CREATED" as const) : ("EXISTING" as const),
        action: toRecoveryAction(row),
      };
    },

    findByIdempotencyKey(idempotencyKey: string) {
      const validatedKey =
        recoveryActionRecordSchema.shape.idempotencyKey.parse(idempotencyKey);
      const row = db
        .select()
        .from(recoveryActions)
        .where(eq(recoveryActions.idempotencyKey, validatedKey))
        .get();
      return row === undefined ? null : toRecoveryAction(row);
    },
  };

  const paymentLinkRepository = {
    insert(rawInput: PaymentLinkRecord): PaymentLinkInsertResult {
      const input = paymentLinkRecordSchema.parse(rawInput);
      const result = db
        .insert(paymentLinks)
        .values(input)
        .onConflictDoNothing()
        .run();

      if (result.changes === 1) {
        return { status: "CREATED", paymentLink: input };
      }

      const sameReference = this.findByReferenceId(input.referenceId);
      if (sameReference !== null) {
        return {
          status: "CONFLICT",
          reason: "REFERENCE_EXISTS",
          paymentLink: sameReference,
        };
      }

      const blockingLink = this.findBlockingByOrderId(input.orderId);
      if (blockingLink !== null) {
        return {
          status: "CONFLICT",
          reason: "ORDER_ALREADY_BLOCKED",
          paymentLink: blockingLink,
        };
      }

      throw new UnexpectedPersistenceConflictError(
        "Payment Link insert hit an unclassified unique constraint.",
      );
    },

    findByRecoveryLinkId(recoveryLinkId: string) {
      const validatedId =
        paymentLinkRecordSchema.shape.recoveryLinkId.parse(recoveryLinkId);
      const row = db
        .select()
        .from(paymentLinks)
        .where(eq(paymentLinks.recoveryLinkId, validatedId))
        .get();
      return row === undefined ? null : toPaymentLink(row);
    },

    findByReferenceId(referenceId: string) {
      const validatedId =
        paymentLinkRecordSchema.shape.referenceId.parse(referenceId);
      const row = db
        .select()
        .from(paymentLinks)
        .where(eq(paymentLinks.referenceId, validatedId))
        .get();
      return row === undefined ? null : toPaymentLink(row);
    },

    findBlockingByOrderId(orderId: string) {
      const validatedId = paymentLinkRecordSchema.shape.orderId.parse(orderId);
      const row = db
        .select()
        .from(paymentLinks)
        .where(
          and(
            eq(paymentLinks.orderId, validatedId),
            eq(paymentLinks.blocksCreation, true),
          ),
        )
        .get();
      return row === undefined ? null : toPaymentLink(row);
    },

    updateLifecycle(rawInput: PaymentLinkLifecycleUpdate) {
      const input = paymentLinkLifecycleUpdateSchema.parse(rawInput);
      const row = db
        .update(paymentLinks)
        .set({
          status: input.status,
          blocksCreation: input.blocksCreation,
          externalLinkId: input.externalLinkId,
          expiresAt: input.expiresAt,
          paidAt: input.paidAt,
          cancelledAt: input.cancelledAt,
          updatedAt: input.updatedAt,
        })
        .where(eq(paymentLinks.recoveryLinkId, input.recoveryLinkId))
        .returning()
        .get();
      return row === undefined ? null : toPaymentLink(row);
    },
  };

  const auditEntryRepository: AuditEntryRepository = {
    append(rawInput) {
      const input = auditEntrySchema.parse(rawInput);
      db.insert(auditEntries)
        .values({
          entryId: input.entryId,
          timestamp: input.timestamp,
          actor: input.actor,
          inputReference: input.inputReference,
          eventType: input.eventType,
          reason: input.reason,
          previousState: input.previousState,
          newState: input.newState,
          previousHash: input.previousHash,
          currentHash: input.currentHash,
          metadataJson: JSON.stringify(input.metadata),
        })
        .run();
      return input;
    },

    readOrdered() {
      return db
        .select()
        .from(auditEntries)
        .orderBy(asc(auditEntries.timestamp), asc(auditEntries.sequence))
        .all()
        .map((row) =>
          auditEntrySchema.parse({
            entryId: row.entryId,
            timestamp: row.timestamp,
            actor: row.actor,
            inputReference: row.inputReference,
            eventType: row.eventType,
            reason: row.reason,
            previousState: row.previousState,
            newState: row.newState,
            previousHash: row.previousHash,
            currentHash: row.currentHash,
            metadata: parseStoredJson(
              row.metadataJson,
              auditEntrySchema.shape.metadata,
              "audit metadata JSON",
            ),
          }),
        );
    },
  };

  const evaluationRunRepository: EvaluationRunRepository = {
    insert(rawInput: EvaluationRunRecord) {
      const input = evaluationRunRecordSchema.parse(rawInput);
      const { result } = input;
      db.insert(evaluationRuns)
        .values({
          evaluationRunId: result.evaluationRunId,
          seed: result.seed,
          completedAt: result.completedAt,
          resultJson: JSON.stringify(result),
          uniqueCaseCount: result.uniqueCaseCount,
          eventDeliveryCount: result.eventDeliveryCount,
          simulatedRevenueInitiallyAtRiskSubunits:
            result.simulatedRevenueInitiallyAtRisk.amountSubunits,
          baselineSimulatedRecoverySubunits:
            result.baselineSimulatedRecovery.amountSubunits,
          recoverAiSimulatedRecoverySubunits:
            result.recoverAiSimulatedRecovery.amountSubunits,
          incrementalSimulatedRecoverySubunits:
            result.incrementalSimulatedRecovery.subunitDelta,
          currency: result.incrementalSimulatedRecovery.currency,
          unsafeActionsBlocked: result.unsafeActionsBlocked,
          duplicateEventsIgnored: result.duplicateEventsIgnored,
          unresolvedExceptionCount: result.unresolvedExceptionCount,
          createdAt: input.createdAt,
        })
        .run();
      return input;
    },

    findById(evaluationRunId: string) {
      const validatedId =
        simulatedEvaluationResultSchema.shape.evaluationRunId.parse(
          evaluationRunId,
        );
      const row = db
        .select()
        .from(evaluationRuns)
        .where(eq(evaluationRuns.evaluationRunId, validatedId))
        .get();
      return row === undefined
        ? null
        : evaluationRunRecordSchema.parse({
            result: parseStoredJson(
              row.resultJson,
              simulatedEvaluationResultSchema,
              "simulated evaluation result JSON",
            ),
            createdAt: row.createdAt,
          });
    },
  };

  return {
    webhookEvents: webhookEventRepository,
    paymentSnapshots: paymentSnapshotRepository,
    recoveryCases: recoveryCaseRepository,
    aiRecommendations: aiRecommendationRepository,
    policyDecisions: policyDecisionRepository,
    recoveryActions: recoveryActionRepository,
    paymentLinks: paymentLinkRepository,
    auditEntries: auditEntryRepository,
    evaluationRuns: evaluationRunRepository,
  };
}

export function createSqliteRepositories(
  database: LocalDatabase,
): RecoverAiRepositories {
  const repositorySet = createRepositorySet(database);

  return {
    ...repositorySet,
    transaction<T>(operation: (repositories: RecoverAiRepositorySet) => T) {
      return database.client.transaction(() => operation(repositorySet))();
    },
  };
}
