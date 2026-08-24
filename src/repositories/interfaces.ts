import type {
  AiRecommendationRecord,
  EvaluationRunRecord,
  PaymentLinkLifecycleUpdate,
  PaymentLinkRecord,
  PaymentSnapshotObservation,
  PersistedPaymentSnapshot,
  PersistedWebhookEvent,
  PolicyDecisionRecord,
  RecoveryActionRecord,
  RecoveryActionStatusUpdate,
  RecoveryCaseRecord,
  RecoveryCaseVersionUpdate,
  WebhookEventClaim,
} from "@/repositories/contracts";
import type { AuditEntry } from "@/domain";

export type FirstSeenWebhookClaim = {
  status: "FIRST_SEEN";
  event: PersistedWebhookEvent;
};

export type DuplicateWebhookClaim = {
  status: "DUPLICATE";
  event: PersistedWebhookEvent;
};

export type WebhookClaimResult = FirstSeenWebhookClaim | DuplicateWebhookClaim;

export interface WebhookEventRepository {
  claim(input: WebhookEventClaim): WebhookClaimResult;
  findByProviderEventId(providerEventId: string): PersistedWebhookEvent | null;
}

export interface PaymentSnapshotRepository {
  append(input: PaymentSnapshotObservation): PersistedPaymentSnapshot;
  appendIdempotently(
    input: PaymentSnapshotObservation,
  ):
    | { status: "CREATED"; snapshot: PersistedPaymentSnapshot }
    | { status: "EXISTING"; snapshot: PersistedPaymentSnapshot }
    | { status: "CONFLICT"; snapshot: PersistedPaymentSnapshot };
  findBySourceEventId(sourceEventId: string): PersistedPaymentSnapshot | null;
  findLatestByPaymentId(paymentId: string): PersistedPaymentSnapshot | null;
  listByPaymentId(paymentId: string): PersistedPaymentSnapshot[];
}

export type RecoveryCaseVersionUpdateResult =
  | { status: "UPDATED"; recoveryCase: RecoveryCaseRecord }
  | { status: "VERSION_MISMATCH"; recoveryCase: RecoveryCaseRecord | null };

export interface RecoveryCaseRepository {
  create(input: RecoveryCaseRecord): RecoveryCaseRecord;
  createIdempotently(
    input: RecoveryCaseRecord,
  ):
    | { status: "CREATED"; recoveryCase: RecoveryCaseRecord }
    | { status: "EXISTING"; recoveryCase: RecoveryCaseRecord }
    | { status: "CONFLICT"; recoveryCase: RecoveryCaseRecord };
  findById(caseId: string): RecoveryCaseRecord | null;
  findByPaymentId(paymentId: string): RecoveryCaseRecord | null;
  updateIfVersionMatches(
    input: RecoveryCaseVersionUpdate,
  ): RecoveryCaseVersionUpdateResult;
}

export interface AiRecommendationRepository {
  insert(input: AiRecommendationRecord): AiRecommendationRecord;
  insertIdempotently(
    input: AiRecommendationRecord,
  ):
    | { status: "CREATED"; recommendation: AiRecommendationRecord }
    | { status: "EXISTING"; recommendation: AiRecommendationRecord }
    | { status: "CONFLICT"; recommendation: AiRecommendationRecord };
  findById(recommendationId: string): AiRecommendationRecord | null;
  listByCaseId(caseId: string): AiRecommendationRecord[];
}

export interface PolicyDecisionRepository {
  insert(input: PolicyDecisionRecord): PolicyDecisionRecord;
  insertIdempotently(
    input: PolicyDecisionRecord,
  ):
    | { status: "CREATED"; decision: PolicyDecisionRecord }
    | { status: "EXISTING"; decision: PolicyDecisionRecord }
    | { status: "CONFLICT"; decision: PolicyDecisionRecord };
  findById(decisionId: string): PolicyDecisionRecord | null;
  listByCaseId(caseId: string): PolicyDecisionRecord[];
}

export type IdempotentRecoveryActionResult =
  | { status: "CREATED"; action: RecoveryActionRecord }
  | { status: "EXISTING"; action: RecoveryActionRecord };

export interface RecoveryActionRepository {
  recordIdempotently(
    input: RecoveryActionRecord,
  ): IdempotentRecoveryActionResult;
  findByIdempotencyKey(idempotencyKey: string): RecoveryActionRecord | null;
  listByCaseId(caseId: string): RecoveryActionRecord[];
  updateIfStatus(
    input: RecoveryActionStatusUpdate,
  ):
    | { status: "UPDATED"; action: RecoveryActionRecord }
    | { status: "STATUS_MISMATCH"; action: RecoveryActionRecord | null };
}

export type PaymentLinkInsertResult =
  | { status: "CREATED"; paymentLink: PaymentLinkRecord }
  | {
      status: "CONFLICT";
      reason: "REFERENCE_EXISTS" | "ORDER_ALREADY_BLOCKED";
      paymentLink: PaymentLinkRecord;
    };

export interface PaymentLinkRepository {
  insert(input: PaymentLinkRecord): PaymentLinkInsertResult;
  findByRecoveryLinkId(recoveryLinkId: string): PaymentLinkRecord | null;
  findByReferenceId(referenceId: string): PaymentLinkRecord | null;
  findBlockingByOrderId(orderId: string): PaymentLinkRecord | null;
  listByCaseId(caseId: string): PaymentLinkRecord[];
  updateLifecycle(input: PaymentLinkLifecycleUpdate): PaymentLinkRecord | null;
}

export interface AuditEntryRepository {
  readOrdered(): AuditEntry[];
}

export interface EvaluationRunRepository {
  insert(input: EvaluationRunRecord): EvaluationRunRecord;
  findById(evaluationRunId: string): EvaluationRunRecord | null;
}

export interface RecoverAiRepositorySet {
  webhookEvents: WebhookEventRepository;
  paymentSnapshots: PaymentSnapshotRepository;
  recoveryCases: RecoveryCaseRepository;
  aiRecommendations: AiRecommendationRepository;
  policyDecisions: PolicyDecisionRepository;
  recoveryActions: RecoveryActionRepository;
  paymentLinks: PaymentLinkRepository;
  auditEntries: AuditEntryRepository;
  evaluationRuns: EvaluationRunRepository;
}

export interface RecoverAiRepositories extends RecoverAiRepositorySet {
  transaction<T>(operation: (repositories: RecoverAiRepositorySet) => T): T;
}
