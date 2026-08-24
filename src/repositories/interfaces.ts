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
  findLatestByPaymentId(paymentId: string): PersistedPaymentSnapshot | null;
  listByPaymentId(paymentId: string): PersistedPaymentSnapshot[];
}

export type RecoveryCaseVersionUpdateResult =
  | { status: "UPDATED"; recoveryCase: RecoveryCaseRecord }
  | { status: "VERSION_MISMATCH"; recoveryCase: RecoveryCaseRecord | null };

export interface RecoveryCaseRepository {
  create(input: RecoveryCaseRecord): RecoveryCaseRecord;
  findById(caseId: string): RecoveryCaseRecord | null;
  findByPaymentId(paymentId: string): RecoveryCaseRecord | null;
  updateIfVersionMatches(
    input: RecoveryCaseVersionUpdate,
  ): RecoveryCaseVersionUpdateResult;
}

export interface AiRecommendationRepository {
  insert(input: AiRecommendationRecord): AiRecommendationRecord;
  listByCaseId(caseId: string): AiRecommendationRecord[];
}

export interface PolicyDecisionRepository {
  insert(input: PolicyDecisionRecord): PolicyDecisionRecord;
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
  updateLifecycle(input: PaymentLinkLifecycleUpdate): PaymentLinkRecord | null;
}

export interface AuditEntryRepository {
  append(input: AuditEntry): AuditEntry;
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
