import { canonicalizeJson, type SqliteAuditChain } from "@/audit";
import {
  DeterministicMockAiProvider,
  scoreRecoveryRecommendation,
  type AiScoringResult,
} from "@/ai";
import { DeterministicMockRazorpayAdapter } from "@/adapters/razorpay";
import { normalizedPaymentEventSchema } from "@/domain";
import type { PaymentContext } from "@/domain/payments";
import { diagnoseKnownPaymentFailure } from "@/diagnosis";
import { DEFAULT_POLICY_CONFIG, evaluateRecoveryPolicy } from "@/policy";
import type { RecoveryActionIntent } from "@/policy/contracts";
import { RecoveryActionExecutor } from "@/recovery/action-executor";
import { executionIdentifiers } from "@/recovery/idempotency";
import { transitionRecoveryCase } from "@/recovery/transition-service";
import type {
  PaymentLinkRecord,
  PolicyDecisionRecord,
  RecoveryCaseRecord,
} from "@/repositories/contracts";
import type { RecoverAiRepositories } from "@/repositories/interfaces";

import {
  PRIMARY_DEMO_SCENARIO,
  type DemoScenario,
  UNSAFE_DEMO_SCENARIO,
  UNSAFE_PROPOSED_AMOUNT_SUBUNITS,
} from "@/orchestration/demo-scenario";

export const DEMO_FAILPOINTS = [
  "AFTER_EVENT_CLAIM",
  "AFTER_CASE_CREATION",
  "AFTER_RECOMMENDATION",
  "AFTER_POLICY",
  "AFTER_LINK_CREATION",
  "AFTER_LINK_PAYMENT",
  "BEFORE_FINAL_AUDIT",
] as const;

export type DemoFailpoint = (typeof DEMO_FAILPOINTS)[number];

export class DemoInterruption extends Error {
  constructor(readonly failpoint: DemoFailpoint) {
    super(`Deterministic test interruption at ${failpoint}.`);
    this.name = "DemoInterruption";
  }
}

export type DemoOperationResult = {
  status:
    "EXECUTED" | "IDEMPOTENT_REPLAY" | "ALREADY_COMPLETE" | "BLOCKED_SAFE";
  resultCode: string;
  explanation: string;
};

type Dependencies = {
  repositories: RecoverAiRepositories;
  audit: SqliteAuditChain;
  adapterFactory?: (
    fixtures: ConstructorParameters<typeof DeterministicMockRazorpayAdapter>[0],
  ) => DeterministicMockRazorpayAdapter;
};

const UNSATISFIED = (verifiedAt: string) => ({
  status: "UNSATISFIED" as const,
  paymentStatus: "FAILED" as const,
  verifiedAt,
});

function same(left: unknown, right: unknown) {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

function interrupt(selected: DemoFailpoint | undefined, at: DemoFailpoint) {
  if (selected === at) throw new DemoInterruption(at);
}

function safeAdapterPayment(scenario: DemoScenario) {
  return {
    paymentId: scenario.paymentId,
    orderId: scenario.orderId,
    amountSubunits: scenario.amountSubunits,
    currency: scenario.currency,
    status: "FAILED" as const,
    fetchedAt: scenario.times.policy,
  };
}

function mockLinkFixture(link: PaymentLinkRecord) {
  if (link.externalLinkId === undefined || link.expiresAt === undefined) {
    throw new Error("Persisted demo Payment Link is incomplete.");
  }
  return {
    externalLinkId: link.externalLinkId,
    publicUrl: `https://mock.razorpay.local/payment-links/${link.externalLinkId}`,
    referenceId: link.referenceId,
    caseReference: link.caseId,
    orderId: link.orderId,
    amountSubunits: link.amountSubunits,
    currency: link.currency,
    status: link.status === "FAILED_SAFE" ? ("EXPIRED" as const) : link.status,
    createdAt: link.createdAt,
    expiresAt: link.expiresAt,
    updatedAt: link.updatedAt,
  };
}

export class RecoverAiDemoOrchestrator {
  readonly #repositories: RecoverAiRepositories;
  readonly #audit: SqliteAuditChain;
  readonly #adapterFactory: NonNullable<Dependencies["adapterFactory"]>;

  constructor(dependencies: Dependencies) {
    this.#repositories = dependencies.repositories;
    this.#audit = dependencies.audit;
    this.#adapterFactory =
      dependencies.adapterFactory ??
      ((fixtures) => new DeterministicMockRazorpayAdapter(fixtures));
  }

  async startOrResumePrimary(
    options: { failpoint?: DemoFailpoint } = {},
  ): Promise<DemoOperationResult> {
    this.#requireValidAudit();
    const scenario = PRIMARY_DEMO_SCENARIO;
    const existingCase = this.#repositories.recoveryCases.findById(
      scenario.caseId,
    );
    if (existingCase?.state === "RECOVERED") {
      this.#auditStage(
        scenario,
        "start_after_recovered",
        "RECOVERY_ALREADY_COMPLETE",
        "Further recovery is stopped because the simulated case is already recovered.",
        "HUMAN_OPERATOR",
        "RECOVERED",
        "RECOVERED",
      );
      return {
        status: "ALREADY_COMPLETE",
        resultCode: "RECOVERY_ALREADY_COMPLETE",
        explanation:
          "The simulated recovery is complete and stopping rules prevent another action.",
      };
    }

    const claim = this.#claimFailureEvent(scenario);
    interrupt(options.failpoint, "AFTER_EVENT_CLAIM");
    this.#persistFailureSnapshot(scenario);
    this.#createCase(scenario);
    interrupt(options.failpoint, "AFTER_CASE_CREATION");

    this.#advance(scenario, "DETECTED", "VERIFYING", scenario.times.verifying);
    this.#advance(scenario, "VERIFYING", "DIAGNOSED", scenario.times.diagnosed);
    this.#auditDiagnosis(scenario);

    const scoring = await this.#score(scenario);
    this.#persistRecommendation(scenario, scoring);
    interrupt(options.failpoint, "AFTER_RECOMMENDATION");

    this.#advance(
      scenario,
      "DIAGNOSED",
      "AWAITING_POLICY",
      scenario.times.policy,
    );
    const decision = this.#persistPolicy(scenario, scoring, false);
    interrupt(options.failpoint, "AFTER_POLICY");

    const currentCase = this.#requireCase(scenario.caseId);
    if (currentCase.state === "LINK_CREATED") {
      this.#finalAudit(scenario);
      return {
        status: "IDEMPOTENT_REPLAY",
        resultCode: "SIMULATED_LINK_ALREADY_READY",
        explanation:
          "The existing simulated Payment Link was reused without another financial operation.",
      };
    }
    if (currentCase.state !== "AWAITING_POLICY") {
      throw new Error(`Unexpected primary demo state: ${currentCase.state}.`);
    }

    const adapter = this.#adapterFor(scenario);
    const intent = this.#linkIntent(scenario, scenario.amountSubunits);
    const executor = new RecoveryActionExecutor({
      adapter,
      repositories: this.#repositories,
      audit: this.#audit,
    });
    const execution = await executor.execute({
      caseRecord: currentCase,
      decision: decision.decision,
      intent,
      executedAt: scenario.times.executed,
      timeoutMilliseconds: 1_000,
      linkExpiresAt: scenario.times.linkExpires,
    });
    if (
      execution.status !== "EXECUTED" &&
      execution.status !== "IDEMPOTENT_REPLAY" &&
      execution.status !== "LINK_REUSED"
    ) {
      throw new Error(`Demo recovery failed safely: ${execution.resultCode}.`);
    }
    interrupt(options.failpoint, "AFTER_LINK_CREATION");

    this.#recordContactOnce(
      scenario,
      executionIdentifiers({
        caseRecord: currentCase,
        decision: decision.decision,
        intent,
        executedAt: scenario.times.executed,
        timeoutMilliseconds: 1_000,
        linkExpiresAt: scenario.times.linkExpires,
      }).idempotencyKey,
    );
    this.#advance(
      scenario,
      "AWAITING_POLICY",
      "LINK_CREATED",
      scenario.times.executed,
    );
    this.#finalAudit(scenario);
    return {
      status: claim === "FIRST_SEEN" ? "EXECUTED" : "IDEMPOTENT_REPLAY",
      resultCode: "SIMULATED_PAYMENT_LINK_READY",
      explanation:
        "One bounded mock Payment Link is ready for a simulated customer payment.",
    };
  }

  async completePrimary(
    options: { failpoint?: DemoFailpoint } = {},
  ): Promise<DemoOperationResult> {
    this.#requireValidAudit();
    const scenario = PRIMARY_DEMO_SCENARIO;
    const recoveryCase = this.#requireCase(scenario.caseId);
    if (recoveryCase.state === "RECOVERED") {
      this.#auditStage(
        scenario,
        "completion_after_recovered",
        "RECOVERY_ALREADY_COMPLETE",
        "The simulated completion was already persisted and no further action is allowed.",
        "HUMAN_OPERATOR",
        "RECOVERED",
        "RECOVERED",
      );
      this.#finalAudit(scenario);
      return {
        status: "ALREADY_COMPLETE",
        resultCode: "SIMULATED_RECOVERY_ALREADY_COMPLETE",
        explanation:
          "The simulated payment was already recorded and no further action is allowed.",
      };
    }
    if (recoveryCase.state !== "LINK_CREATED") {
      throw new Error(
        "The simulated Payment Link is not ready for completion.",
      );
    }
    const link = this.#singleLink(scenario.caseId);
    if (link.status !== "CREATED" && link.status !== "PAID") {
      throw new Error("The mock Payment Link is not eligible for completion.");
    }

    if (link.status === "CREATED") {
      if (link.externalLinkId === undefined) {
        throw new Error("The mock Payment Link has no external identifier.");
      }
      const adapter = this.#adapterFor(scenario);
      adapter.setPaymentLinkStatus(
        link.externalLinkId,
        "PAID",
        scenario.times.paid,
      );
      const persisted = this.#repositories.paymentLinks.updateLifecycle({
        recoveryLinkId: link.recoveryLinkId,
        status: "PAID",
        blocksCreation: false,
        externalLinkId: link.externalLinkId,
        expiresAt: link.expiresAt,
        paidAt: scenario.times.paid,
        updatedAt: scenario.times.paid,
      });
      if (persisted?.status !== "PAID") {
        throw new Error("The simulated paid-link state was not persisted.");
      }
    }
    interrupt(options.failpoint, "AFTER_LINK_PAYMENT");

    this.#claimPaidEvent(scenario, link.recoveryLinkId);
    const latestCase = this.#requireCase(scenario.caseId);
    const result = transitionRecoveryCase(this.#repositories.recoveryCases, {
      caseId: latestCase.caseId,
      expectedCurrentState: "LINK_CREATED",
      requestedState: "RECOVERED",
      expectedVersion: latestCase.version,
      paymentSatisfaction: {
        status: "SATISFIED",
        basis: "ORDER_PAID",
        verifiedAt: scenario.times.recovered,
      },
      reasonCode: "TRUSTED_SYNTHETIC_LINK_PAID",
      reason:
        "A trusted synthetic demo event confirms the mock Payment Link is paid.",
      transitionedAt: scenario.times.recovered,
    });
    if (result.status !== "APPLIED" && result.status !== "IDEMPOTENT_NO_OP") {
      throw new Error(`Recovery transition failed: ${result.status}.`);
    }
    this.#auditStage(
      scenario,
      "recovered",
      "RECOVERY_STATE_APPLIED",
      "The trusted synthetic paid event moved the case to recovered.",
      "STATE_RECONCILER",
      "LINK_CREATED",
      "RECOVERED",
    );
    interrupt(options.failpoint, "BEFORE_FINAL_AUDIT");
    this.#finalAudit(scenario);
    return {
      status: "EXECUTED",
      resultCode: "SIMULATED_RECOVERY_COMPLETE",
      explanation:
        "The mock Payment Link is paid, the simulated case is recovered, and recovery is stopped.",
    };
  }

  async runUnsafeAmountProbe(): Promise<DemoOperationResult> {
    this.#requireValidAudit();
    const scenario = UNSAFE_DEMO_SCENARIO;
    const terminal = this.#repositories.recoveryCases.findById(scenario.caseId);
    if (terminal?.state === "ESCALATED") {
      return {
        status: "IDEMPOTENT_REPLAY",
        resultCode: "UNSAFE_AMOUNT_ALREADY_BLOCKED",
        explanation:
          "The fixed unsafe amount probe remains blocked with no recovery action executed.",
      };
    }
    this.#claimFailureEvent(scenario);
    this.#persistFailureSnapshot(scenario);
    this.#createCase(scenario);
    this.#advance(scenario, "DETECTED", "VERIFYING", scenario.times.verifying);
    this.#advance(scenario, "VERIFYING", "DIAGNOSED", scenario.times.diagnosed);
    this.#auditDiagnosis(scenario);
    const scoring = await this.#score(scenario);
    this.#persistRecommendation(scenario, scoring);
    this.#advance(
      scenario,
      "DIAGNOSED",
      "AWAITING_POLICY",
      scenario.times.policy,
    );
    const record = this.#persistPolicy(scenario, scoring, true);
    if (
      record.decision.outcome !== "ESCALATED" ||
      record.decision.ruleId !== "INTENT_MONEY_INTEGRITY"
    ) {
      throw new Error(
        "The unsafe demo probe did not fail at the money boundary.",
      );
    }
    this.#advance(
      scenario,
      "AWAITING_POLICY",
      "ESCALATED",
      scenario.times.executed,
    );
    this.#auditStage(
      scenario,
      "unsafe_blocked",
      "UNSAFE_ACTION_BLOCKED",
      "The deterministic policy firewall rejected the fixed 10x simulated amount probe.",
      "POLICY_FIREWALL",
      "AWAITING_POLICY",
      "ESCALATED",
    );
    this.#requireValidAudit();
    return {
      status: "BLOCKED_SAFE",
      resultCode: "INTENT_MONEY_INTEGRITY",
      explanation:
        "The 10x simulated amount proposal was escalated before any executor or Payment Link call.",
    };
  }

  async scoringFor(scenario: DemoScenario): Promise<AiScoringResult> {
    return this.#score(scenario);
  }

  diagnosisFor(scenario: DemoScenario) {
    return this.#diagnosis(scenario, false);
  }

  #claimFailureEvent(scenario: DemoScenario) {
    const claim = this.#repositories.webhookEvents.claim({
      internalEventId: scenario.failureEventId,
      providerEventId: scenario.failureProviderEventId,
      event: scenario.failureEvent,
      createdAt: scenario.times.event,
      processedAt: scenario.times.event,
      safeErrorReason:
        "Trusted synthetic demo event; external signature verification was not checked.",
    });
    if (!same(claim.event.event, scenario.failureEvent)) {
      throw new Error(
        "Persisted synthetic failure event conflicts with fixture.",
      );
    }
    this.#auditStage(
      scenario,
      "failure_event_claimed",
      "SYNTHETIC_EVENT_CLAIMED",
      "A trusted synthetic demo failure event was claimed with signature status not checked.",
      "WEBHOOK_INGESTOR",
      null,
      null,
    );
    if (claim.status === "DUPLICATE") {
      this.#auditStage(
        scenario,
        "failure_event_resume",
        "SYNTHETIC_EVENT_RESUMED",
        "An identical persisted synthetic event was detected and the workflow resumed safely.",
        "WEBHOOK_INGESTOR",
        null,
        null,
      );
    }
    return claim.status;
  }

  #claimPaidEvent(scenario: DemoScenario, recoveryLinkId: string) {
    const event = normalizedPaymentEventSchema.parse({
      eventId: scenario.paidEventId,
      eventName: "payment_link.paid",
      occurredAt: scenario.times.paid,
      receivedAt: scenario.times.paid,
      paymentId: scenario.paymentId,
      orderId: scenario.orderId,
      recoveryLinkId,
      signatureVerification: { status: "NOT_CHECKED" },
      duplicateProcessing: { status: "NOT_CHECKED" },
    });
    const claim = this.#repositories.webhookEvents.claim({
      internalEventId: scenario.paidEventId,
      providerEventId: scenario.paidProviderEventId,
      event,
      createdAt: scenario.times.paid,
      processedAt: scenario.times.paid,
      safeErrorReason:
        "Trusted synthetic demo event; external signature verification was not checked.",
    });
    if (!same(claim.event.event, event)) {
      throw new Error("Persisted synthetic paid event conflicts with fixture.");
    }
    this.#auditStage(
      scenario,
      "paid_event_claimed",
      "SYNTHETIC_PAID_EVENT_CLAIMED",
      "A trusted synthetic demo paid event was claimed with signature status not checked.",
      "WEBHOOK_INGESTOR",
      "LINK_CREATED",
      "LINK_CREATED",
      { recoveryLinkId },
    );
    if (claim.status === "DUPLICATE") {
      this.#auditStage(
        scenario,
        "paid_event_resume",
        "SYNTHETIC_PAID_EVENT_RESUMED",
        "An identical persisted synthetic paid event was detected and completion resumed safely.",
        "WEBHOOK_INGESTOR",
        "LINK_CREATED",
        "LINK_CREATED",
        { recoveryLinkId },
      );
    }
  }

  #persistFailureSnapshot(scenario: DemoScenario) {
    const result = this.#repositories.paymentSnapshots.appendIdempotently({
      snapshot: scenario.failureEvent.paymentSnapshot!,
      observedAt: scenario.times.event,
      sourceEventId: scenario.failureEventId,
      createdAt: scenario.times.event,
    });
    if (result.status === "CONFLICT") {
      throw new Error("Persisted payment snapshot conflicts with fixture.");
    }
    this.#auditStage(
      scenario,
      "failure_snapshot",
      "PAYMENT_SNAPSHOT_PERSISTED",
      "The normalized synthetic failed-payment snapshot was persisted idempotently.",
      "STATE_RECONCILER",
      null,
      null,
    );
  }

  #createCase(scenario: DemoScenario) {
    const result = this.#repositories.recoveryCases.createIdempotently(
      scenario.initialCase,
    );
    if (result.status === "CONFLICT") {
      throw new Error("Persisted recovery case conflicts with fixture.");
    }
    this.#auditStage(
      scenario,
      "case_created",
      "RECOVERY_CASE_CREATED",
      "The synthetic recovery case was created or safely resumed.",
      "STATE_RECONCILER",
      null,
      "DETECTED",
    );
  }

  #advance(
    scenario: DemoScenario,
    from: RecoveryCaseRecord["state"],
    to: RecoveryCaseRecord["state"],
    at: string,
  ) {
    const current = this.#requireCase(scenario.caseId);
    if (current.state === to) {
      this.#auditStage(
        scenario,
        `state_${to.toLowerCase()}_noop`,
        "RECOVERY_STATE_NOOP",
        "The requested synthetic recovery-case state was already persisted.",
        "STATE_RECONCILER",
        to,
        to,
      );
      return current;
    }
    const stateOrder = [
      "DETECTED",
      "VERIFYING",
      "DIAGNOSED",
      "AWAITING_POLICY",
      "LINK_CREATED",
      "RECOVERED",
    ];
    if (
      current.state !== from &&
      stateOrder.indexOf(current.state) > stateOrder.indexOf(to)
    ) {
      return current;
    }
    if (current.state !== from) {
      throw new Error(
        `Cannot resume ${scenario.caseId} from ${current.state}.`,
      );
    }
    const result = transitionRecoveryCase(this.#repositories.recoveryCases, {
      caseId: scenario.caseId,
      expectedCurrentState: from,
      requestedState: to,
      expectedVersion: current.version,
      paymentSatisfaction: UNSATISFIED(at),
      reasonCode: `DEMO_${from}_TO_${to}`,
      reason:
        "The trusted synthetic demo workflow applied a legal bounded transition.",
      transitionedAt: at,
    });
    if (result.status !== "APPLIED") {
      throw new Error(`Demo state transition failed: ${result.status}.`);
    }
    this.#auditStage(
      scenario,
      `state_${to.toLowerCase()}`,
      "RECOVERY_STATE_APPLIED",
      "A legal synthetic recovery-case transition was persisted.",
      "STATE_RECONCILER",
      from,
      to,
    );
    return this.#requireCase(scenario.caseId);
  }

  async #score(scenario: DemoScenario) {
    const current = this.#requireCase(scenario.caseId);
    const record = { ...current, contactCount: 0 };
    const diagnosis = this.#diagnosis(scenario, false);
    const result = await scoreRecoveryRecommendation(
      {
        caseId: scenario.caseId,
        seed: scenario.seed,
        recommendedAt: scenario.times.recommended,
        paymentContext: this.#paymentContext(scenario, record, false),
        diagnosis,
        scoringConfig: scenario.scoringConfig,
      },
      new DeterministicMockAiProvider(),
    );
    if (
      result.status !== "SUCCESS" ||
      result.recommendation.selectedAction !== "SEND_PAYMENT_LINK"
    ) {
      throw new Error(
        "The locked demo scorer did not select SEND_PAYMENT_LINK.",
      );
    }
    return result;
  }

  #auditDiagnosis(scenario: DemoScenario) {
    const diagnosis = this.#diagnosis(scenario, false);
    this.#auditStage(
      scenario,
      "diagnosis",
      "KNOWN_ERROR_DIAGNOSIS_PRODUCED",
      "An exact structured failure reason produced a deterministic diagnosis.",
      "KNOWN_ERROR_DIAGNOSER",
      "DIAGNOSED",
      "DIAGNOSED",
      { failureClass: diagnosis.failureClass },
    );
  }

  #persistRecommendation(scenario: DemoScenario, scoring: AiScoringResult) {
    const result = this.#repositories.aiRecommendations.insertIdempotently({
      recommendationId: scenario.recommendationId,
      recommendation: scoring.recommendation,
      createdAt: scenario.times.recommended,
    });
    if (result.status === "CONFLICT") {
      throw new Error("Persisted AI recommendation conflicts with fixture.");
    }
    this.#auditStage(
      scenario,
      "recommendation",
      "AI_RECOMMENDATION_PERSISTED",
      "A passive deterministic mock-AI recommendation was persisted.",
      "AI_SCORER",
      "DIAGNOSED",
      "DIAGNOSED",
      {
        action: scoring.recommendation.selectedAction,
        confidence: scoring.recommendation.confidence,
      },
    );
  }

  #persistPolicy(
    scenario: DemoScenario,
    scoring: AiScoringResult,
    unsafeAmount: boolean,
  ): PolicyDecisionRecord {
    const existing = this.#repositories.policyDecisions.findById(
      scenario.decisionId,
    );
    if (existing !== null) return existing;
    const currentCase = this.#requireCase(scenario.caseId);
    const intent = this.#linkIntent(
      scenario,
      unsafeAmount ? UNSAFE_PROPOSED_AMOUNT_SUBUNITS : scenario.amountSubunits,
    );
    const result = evaluateRecoveryPolicy({
      caseRecord: currentCase,
      paymentContext: this.#paymentContext(scenario, currentCase, false),
      paymentSatisfaction: UNSATISFIED(scenario.times.policy),
      diagnosis: this.#diagnosis(scenario, false),
      aiScoringResult: scoring,
      intent,
      totalPaymentLinksCreated: 0,
      paymentLinks: [],
      evaluatedAt: scenario.times.policy,
      config: DEFAULT_POLICY_CONFIG,
    });
    if (result.status !== "DECIDED") {
      throw new Error(`Policy input was invalid: ${result.errorCode}.`);
    }
    const persisted = this.#repositories.policyDecisions.insertIdempotently({
      decisionId: scenario.decisionId,
      decision: result.decision,
      createdAt: scenario.times.policy,
    });
    if (persisted.status === "CONFLICT") {
      throw new Error("Persisted policy decision conflicts with fixture.");
    }
    this.#auditStage(
      scenario,
      "policy",
      "POLICY_DECISION_PERSISTED",
      unsafeAmount
        ? "The deterministic policy firewall rejected the fixed unsafe simulated amount."
        : "The deterministic policy firewall approved one bounded mock recovery action.",
      "POLICY_FIREWALL",
      "AWAITING_POLICY",
      "AWAITING_POLICY",
      {
        action: result.decision.proposedAction,
        checkCount: result.decision.checksPerformed.length,
        providerStatus: result.decision.outcome,
      },
    );
    return persisted.decision;
  }

  #diagnosis(scenario: DemoScenario, activeLink: boolean) {
    return diagnoseKnownPaymentFailure({
      caseId: scenario.caseId,
      paymentSnapshot: scenario.failureEvent.paymentSnapshot!,
      paymentSatisfaction: UNSATISFIED(scenario.times.diagnosed),
      downtimeContext: {
        availability: "AVAILABLE",
        active: false,
        bankOrProvider: "synthetic_psp",
        observedAt: scenario.times.diagnosed,
      },
      activeRecoveryLink: activeLink
        ? {
            exists: true as const,
            recoveryLinkId: this.#singleLink(scenario.caseId).recoveryLinkId,
          }
        : { exists: false as const },
      diagnosedAt: scenario.times.diagnosed,
    });
  }

  #paymentContext(
    scenario: DemoScenario,
    record: RecoveryCaseRecord,
    activeLink: boolean,
  ): PaymentContext {
    return {
      ...scenario.failureEvent.paymentSnapshot!,
      caseId: scenario.caseId,
      syntheticCustomerHash: scenario.syntheticCustomerHash,
      attemptNumber: record.attemptNumber,
      previousSuccessCount: record.previousSuccessCount,
      previousFailureCount: record.previousFailureCount,
      previousContactCount: record.contactCount,
      eventCreatedAt: scenario.times.event,
      currentReconciledState: {
        availability: "AVAILABLE",
        status: "FAILED",
        fetchedAt: scenario.times.policy,
      },
      activeRecoveryLink: activeLink
        ? {
            exists: true,
            recoveryLinkId: this.#singleLink(scenario.caseId).recoveryLinkId,
          }
        : { exists: false },
      downtimeContext: {
        availability: "AVAILABLE",
        active: false,
        bankOrProvider: "synthetic_psp",
        observedAt: scenario.times.policy,
      },
    };
  }

  #linkIntent(
    scenario: DemoScenario,
    amountSubunits: number,
  ): RecoveryActionIntent {
    return {
      action: "SEND_PAYMENT_LINK",
      orderId: scenario.orderId,
      intendedAmountSubunits: amountSubunits,
      intendedCurrency: scenario.currency,
      linkUse: { mode: "CREATE_NEW" },
    };
  }

  #adapterFor(scenario: DemoScenario) {
    const links = this.#repositories.paymentLinks.listByCaseId(scenario.caseId);
    return this.#adapterFactory({
      payments: [safeAdapterPayment(scenario)],
      paymentLinks: links.map(mockLinkFixture),
    });
  }

  #recordContactOnce(scenario: DemoScenario, idempotencyKey: string) {
    const action =
      this.#repositories.recoveryActions.findByIdempotencyKey(idempotencyKey);
    if (action?.status !== "SUCCEEDED") {
      throw new Error("A successful persisted contact action is required.");
    }
    const record = this.#requireCase(scenario.caseId);
    if (record.contactCount === 1) return;
    if (record.contactCount !== 0) {
      throw new Error("Unexpected synthetic contact count.");
    }
    const update = this.#repositories.recoveryCases.updateIfVersionMatches({
      caseId: record.caseId,
      expectedVersion: record.version,
      contactCount: 1,
      updatedAt: scenario.times.executed,
    });
    if (update.status === "VERSION_MISMATCH") {
      const latest = this.#requireCase(scenario.caseId);
      if (latest.contactCount !== 1) {
        throw new Error("Contact-count update lost without safe convergence.");
      }
    }
    this.#auditStage(
      scenario,
      "contact_recorded",
      "CUSTOMER_CONTACT_RECORDED",
      "One simulated customer-facing recovery instrument was counted; no message was sent.",
      "RECOVERY_EXECUTOR",
      "AWAITING_POLICY",
      "AWAITING_POLICY",
      { action: "SEND_PAYMENT_LINK" },
    );
  }

  #singleLink(caseId: string) {
    const links = this.#repositories.paymentLinks.listByCaseId(caseId);
    if (links.length !== 1) {
      throw new Error(
        `Expected exactly one mock Payment Link; found ${links.length}.`,
      );
    }
    return links[0]!;
  }

  #requireCase(caseId: string) {
    const record = this.#repositories.recoveryCases.findById(caseId);
    if (record === null)
      throw new Error(`Recovery case ${caseId} was not found.`);
    return record;
  }

  #auditStage(
    scenario: DemoScenario,
    stage: string,
    eventType: string,
    reason: string,
    actor:
      | "WEBHOOK_INGESTOR"
      | "STATE_RECONCILER"
      | "KNOWN_ERROR_DIAGNOSER"
      | "AI_SCORER"
      | "POLICY_FIREWALL"
      | "RECOVERY_EXECUTOR"
      | "AUDIT_SYSTEM"
      | "HUMAN_OPERATOR",
    previousState: RecoveryCaseRecord["state"] | null,
    newState: RecoveryCaseRecord["state"] | null,
    metadata: Record<string, unknown> = {},
  ) {
    const timestamp = stage.startsWith("state_verifying")
      ? scenario.times.verifying
      : stage.startsWith("state_diagnosed") || stage === "diagnosis"
        ? scenario.times.diagnosed
        : stage === "recommendation"
          ? scenario.times.recommended
          : stage === "policy" || stage.startsWith("state_awaiting_policy")
            ? scenario.times.policy
            : stage === "contact_recorded" ||
                stage.startsWith("state_link_created") ||
                stage === "final_link_ready" ||
                stage === "unsafe_blocked"
              ? scenario.times.executed
              : stage.startsWith("paid_event")
                ? scenario.times.paid
                : stage === "recovered" ||
                    stage === "final_recovered" ||
                    stage === "start_after_recovered" ||
                    stage === "completion_after_recovered"
                  ? scenario.times.recovered
                  : scenario.times.event;
    const result = this.#audit.append({
      entryId: `demo_v1_audit_${scenario.caseId}_${stage}`,
      timestamp,
      actor,
      inputReference: scenario.caseId,
      eventType,
      reason,
      previousState,
      newState,
      metadata: {
        caseId: scenario.caseId,
        paymentId: scenario.paymentId,
        orderId: scenario.orderId,
        isSynthetic: true,
        ...metadata,
      },
    });
    if (result.status !== "APPENDED" && result.status !== "IDEMPOTENT_REPLAY") {
      throw new Error(`Audit append failed safely: ${result.status}.`);
    }
  }

  #finalAudit(scenario: DemoScenario) {
    const state = this.#requireCase(scenario.caseId).state;
    this.#auditStage(
      scenario,
      state === "RECOVERED" ? "final_recovered" : "final_link_ready",
      "DEMO_WORKFLOW_CHECKPOINT",
      state === "RECOVERED"
        ? "The simulated recovery result is persisted and no further action is allowed."
        : "The bounded simulated recovery action and link-ready state are persisted.",
      "AUDIT_SYSTEM",
      state,
      state,
    );
    this.#requireValidAudit();
  }

  #requireValidAudit() {
    const verification = this.#audit.verify();
    if (verification.status !== "VALID") {
      throw new Error(`Audit chain is invalid: ${verification.issue}.`);
    }
  }
}
