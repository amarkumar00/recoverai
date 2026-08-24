import type { SqliteAuditChain } from "@/audit";
import type { RecoveryCaseState } from "@/domain/states";
import {
  demoCaseReadModelSchema,
  demoDashboardReadModelSchema,
  type DemoCaseReadModel,
  type DemoDashboardReadModel,
} from "@/orchestration/contracts";
import {
  PRIMARY_DEMO_SCENARIO,
  type DemoScenario,
  UNSAFE_DEMO_SCENARIO,
  UNSAFE_PROPOSED_AMOUNT_SUBUNITS,
} from "@/orchestration/demo-scenario";
import { RecoverAiDemoOrchestrator } from "@/orchestration/recovery-orchestrator";
import type { RecoverAiRepositories } from "@/repositories/interfaces";

type Dependencies = {
  repositories: RecoverAiRepositories;
  audit: SqliteAuditChain;
  orchestrator: RecoverAiDemoOrchestrator;
};

function stage(
  state: RecoveryCaseState | null,
  unsafe: boolean,
): DemoCaseReadModel["workflowStage"] {
  if (state === null) return "NOT_STARTED";
  if (unsafe && state === "ESCALATED") return "UNSAFE_ACTION_BLOCKED";
  if (state === "LINK_CREATED") return "READY_FOR_SIMULATED_PAYMENT";
  if (state === "RECOVERED") return "RECOVERED_STOPPED";
  if (
    state === "DETECTED" ||
    state === "VERIFYING" ||
    state === "DIAGNOSED" ||
    state === "AWAITING_POLICY"
  ) {
    return state;
  }
  return "ERROR_SAFE";
}

export class DemoReadModelService {
  readonly #repositories: RecoverAiRepositories;
  readonly #audit: SqliteAuditChain;
  readonly #orchestrator: RecoverAiDemoOrchestrator;

  constructor(dependencies: Dependencies) {
    this.#repositories = dependencies.repositories;
    this.#audit = dependencies.audit;
    this.#orchestrator = dependencies.orchestrator;
  }

  async dashboard(): Promise<DemoDashboardReadModel> {
    return demoDashboardReadModelSchema.parse({
      primary: await this.case(PRIMARY_DEMO_SCENARIO, false),
      unsafe: await this.case(UNSAFE_DEMO_SCENARIO, true),
    });
  }

  async caseById(caseId: string): Promise<DemoCaseReadModel | null> {
    if (caseId === PRIMARY_DEMO_SCENARIO.caseId) {
      return this.case(PRIMARY_DEMO_SCENARIO, false);
    }
    if (caseId === UNSAFE_DEMO_SCENARIO.caseId) {
      return this.case(UNSAFE_DEMO_SCENARIO, true);
    }
    return null;
  }

  async case(
    scenario: DemoScenario,
    unsafe: boolean,
  ): Promise<DemoCaseReadModel> {
    const verification = this.#audit.verify();
    const recoveryCase = this.#repositories.recoveryCases.findById(
      scenario.caseId,
    );
    const snapshot = this.#repositories.paymentSnapshots.findLatestByPaymentId(
      scenario.paymentId,
    );
    const recommendations = this.#repositories.aiRecommendations.listByCaseId(
      scenario.caseId,
    );
    const recommendation = recommendations.at(-1)?.recommendation;
    const decisions = this.#repositories.policyDecisions.listByCaseId(
      scenario.caseId,
    );
    const decision = decisions.at(-1)?.decision;
    const actions = this.#repositories.recoveryActions.listByCaseId(
      scenario.caseId,
    );
    const action = actions.at(-1);
    const links = this.#repositories.paymentLinks.listByCaseId(scenario.caseId);
    const link = links.at(-1);

    const diagnosis =
      recoveryCase === null
        ? undefined
        : this.#orchestrator.diagnosisFor(scenario);
    const scoring =
      recoveryCase === null
        ? undefined
        : await this.#orchestrator.scoringFor(scenario);

    const timeline =
      verification.status === "VALID"
        ? this.#audit
            .readOrdered()
            .filter(
              (entry) =>
                entry.inputReference === scenario.caseId ||
                entry.metadata.caseId === scenario.caseId,
            )
            .map((entry) => ({
              entryId: entry.entryId,
              sequence: entry.sequence,
              timestamp: entry.timestamp,
              actor: entry.actor,
              eventType: entry.eventType,
              reason: entry.reason,
              previousState: entry.previousState,
              newState: entry.newState,
            }))
        : [];
    const currentStage = stage(recoveryCase?.state ?? null, unsafe);

    return demoCaseReadModelSchema.parse({
      mode: "SYNTHETIC_DEMO",
      scenario: unsafe ? "UNSAFE_AMOUNT_PROBE" : "PRIMARY_RECOVERY",
      sourceBoundary: "Trusted Synthetic Demo Event",
      signatureStatus: "NOT_CHECKED",
      productionReady: false,
      movesRealMoney: false,
      caseId: scenario.caseId,
      paymentId: scenario.paymentId,
      orderId: scenario.orderId,
      simulatedAmountSubunits: scenario.amountSubunits,
      currency: scenario.currency,
      currentCaseState: recoveryCase?.state ?? null,
      latestPaymentState: snapshot?.snapshot.status ?? null,
      ...(diagnosis === undefined
        ? {}
        : {
            diagnosis: {
              failureClass: diagnosis.failureClass,
              reason: diagnosis.reason,
              evidence: diagnosis.evidence,
            },
          }),
      ...(recommendation === undefined
        ? {}
        : {
            aiRecommendation: {
              selectedAction: recommendation.selectedAction,
              confidence: recommendation.confidence,
              rankedActions: recommendation.rankedActions.map((ranked) => ({
                rank: ranked.rank,
                action: ranked.action,
                recoveryProbability: ranked.recoveryProbability,
                reason: ranked.reason,
              })),
            },
          }),
      expectedValueBreakdown: scoring?.scoreBreakdowns ?? [],
      ...(decision === undefined
        ? {}
        : {
            policy: {
              outcome: decision.outcome,
              primaryRule: decision.ruleId,
              reason: decision.reason,
              checks: decision.checksPerformed,
            },
          }),
      ...(action === undefined
        ? {}
        : {
            recoveryAction: {
              action: action.action,
              status: action.status,
              ...(action.safeResultCode === undefined
                ? {}
                : { resultCode: action.safeResultCode }),
            },
          }),
      ...(link === undefined
        ? {}
        : {
            paymentLink: {
              recoveryLinkId: link.recoveryLinkId,
              status: link.status,
              amountSubunits: link.amountSubunits,
              currency: link.currency,
              createdAt: link.createdAt,
              ...(link.paidAt === undefined ? {} : { paidAt: link.paidAt }),
            },
          }),
      customerContactCount: recoveryCase?.contactCount ?? 0,
      timeline,
      auditVerification:
        verification.status === "VALID"
          ? {
              status: "VALID",
              entryCount: verification.checkpoint.entryCount,
            }
          : { status: "INVALID", issue: verification.issue },
      workflowStage: currentStage,
      controls: {
        canStartOrResume: !unsafe && recoveryCase?.state !== "RECOVERED",
        canMarkMockLinkPaid: !unsafe && recoveryCase?.state === "LINK_CREATED",
        canRunUnsafeProbe: unsafe && recoveryCase?.state !== "ESCALATED",
        noFurtherAction:
          recoveryCase?.state === "RECOVERED" ||
          (unsafe && recoveryCase?.state === "ESCALATED"),
      },
      ...(unsafe && recoveryCase?.state === "ESCALATED"
        ? {
            unsafeProof: {
              verifiedAllowedAmountSubunits: scenario.amountSubunits,
              proposedUnsafeAmountSubunits: UNSAFE_PROPOSED_AMOUNT_SUBUNITS,
              rejectingBoundary: "DETERMINISTIC_POLICY_FIREWALL",
              rejectingRule: "INTENT_MONEY_INTEGRITY",
              finalOutcome: "ESCALATED",
              noActionExecuted: true,
            },
          }
        : {}),
      operation: {
        status:
          currentStage === "RECOVERED_STOPPED"
            ? "ALREADY_COMPLETE"
            : currentStage === "UNSAFE_ACTION_BLOCKED"
              ? "BLOCKED_SAFE"
              : "READY",
        resultCode:
          currentStage === "RECOVERED_STOPPED"
            ? "SIMULATED_RECOVERY_COMPLETE"
            : currentStage === "UNSAFE_ACTION_BLOCKED"
              ? "INTENT_MONEY_INTEGRITY"
              : "DEMO_READY",
        explanation:
          currentStage === "RECOVERED_STOPPED"
            ? "The simulated recovery is complete and further action is stopped."
            : currentStage === "UNSAFE_ACTION_BLOCKED"
              ? "The fixed unsafe simulated amount was blocked before execution."
              : "The credential-free synthetic demo is ready for its next bounded step.",
      },
    });
  }
}
