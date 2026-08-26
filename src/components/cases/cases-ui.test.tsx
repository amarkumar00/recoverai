import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  demoCaseReadModelSchema,
  type DemoCaseReadModel,
} from "@/orchestration/contracts";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { CaseDetail } from "@/components/cases/case-detail";
import { CasesWorkspace } from "@/components/cases/cases-workspace";

function model(overrides: Record<string, unknown> = {}): DemoCaseReadModel {
  return demoCaseReadModelSchema.parse({
    mode: "SYNTHETIC_DEMO",
    scenario: "PRIMARY_RECOVERY",
    sourceBoundary: "Trusted Synthetic Demo Event",
    signatureStatus: "NOT_CHECKED",
    productionReady: false,
    movesRealMoney: false,
    caseId: "case_demo_primary_v1",
    paymentId: "pay_demo_primary_v1",
    orderId: "order_demo_primary_v1",
    simulatedAmountSubunits: 149_900,
    currency: "INR",
    currentCaseState: null,
    latestPaymentState: null,
    currentFetchedPaymentState: null,
    downtimeContext: {
      availability: "AVAILABLE",
      active: false,
      explanation: "No active synthetic downtime.",
    },
    paymentTimeline: [],
    expectedValueBreakdown: [],
    customerContactCount: 0,
    finalSimulatedOutcome: "Simulated outcome is not yet terminal.",
    recoveryStoppedAfterPaymentSuccess: false,
    timeline: [],
    auditVerification: { status: "VALID", entryCount: 0 },
    workflowStage: "NOT_STARTED",
    controls: {
      canStartOrResume: true,
      canMarkMockLinkPaid: false,
      canRunUnsafeProbe: false,
      noFurtherAction: false,
    },
    operation: {
      status: "READY",
      resultCode: "DEMO_READY",
      explanation: "The synthetic demo is ready.",
    },
    ...overrides,
  });
}

describe("Milestone 9 cases UI", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders credential-free cases with explicit simulated wording", () => {
    const unsafe = model({
      scenario: "UNSAFE_AMOUNT_PROBE",
      caseId: "case_demo_unsafe_v1",
      paymentId: "pay_demo_unsafe_v1",
      orderId: "order_demo_unsafe_v1",
      simulatedAmountSubunits: 50_000,
      controls: {
        canStartOrResume: false,
        canMarkMockLinkPaid: false,
        canRunUnsafeProbe: true,
        noFurtherAction: false,
      },
    });
    const html = renderToStaticMarkup(
      <CasesWorkspace initialModel={{ primary: model(), unsafe }} />,
    );
    expect(html).toContain(
      "Every money value and outcome shown here is simulated",
    );
    expect(html).toContain("Signature verification: NOT_CHECKED");
    expect(html).toContain(
      "remain separate from the signature-verified public webhook boundary",
    );
    expect(html).toContain("Start bounded recovery");
    expect(html).toContain("Run fixed 10× safety probe");
  });

  it("renders ready, recovered, and unsafe detail states", () => {
    const ready = renderToStaticMarkup(
      <CaseDetail
        initialModel={model({
          currentCaseState: "LINK_CREATED",
          latestPaymentState: "FAILED",
          workflowStage: "READY_FOR_SIMULATED_PAYMENT",
          controls: {
            canStartOrResume: true,
            canMarkMockLinkPaid: true,
            canRunUnsafeProbe: false,
            noFurtherAction: false,
          },
          paymentLink: {
            recoveryLinkId: "link_demo_001",
            status: "CREATED",
            amountSubunits: 149_900,
            currency: "INR",
            createdAt: "2026-08-25T08:05:00.000Z",
          },
        })}
      />,
    );
    expect(ready).toContain("Simulate mock link paid");
    expect(ready).toContain("No public URL is exposed");

    const recovered = renderToStaticMarkup(
      <CaseDetail
        initialModel={model({
          currentCaseState: "RECOVERED",
          workflowStage: "RECOVERED_STOPPED",
          controls: {
            canStartOrResume: false,
            canMarkMockLinkPaid: false,
            canRunUnsafeProbe: false,
            noFurtherAction: true,
          },
        })}
      />,
    );
    expect(recovered).toContain("No further action");

    const unsafe = renderToStaticMarkup(
      <CaseDetail
        initialModel={model({
          scenario: "UNSAFE_AMOUNT_PROBE",
          currentCaseState: "ESCALATED",
          workflowStage: "UNSAFE_ACTION_BLOCKED",
          controls: {
            canStartOrResume: false,
            canMarkMockLinkPaid: false,
            canRunUnsafeProbe: false,
            noFurtherAction: true,
          },
          unsafeProof: {
            verifiedAllowedAmountSubunits: 50_000,
            proposedUnsafeAmountSubunits: 500_000,
            rejectingBoundary: "DETERMINISTIC_POLICY_FIREWALL",
            rejectingRule: "INTENT_MONEY_INTEGRITY",
            finalOutcome: "ESCALATED",
            noActionExecuted: true,
          },
        })}
      />,
    );
    expect(unsafe).toContain("No action executed");
    expect(unsafe).toContain("INTENT_MONEY_INTEGRITY");
    expect(unsafe).not.toContain("publicUrl");
  });

  it("renders payment evidence, AI ranking, expected value, and ordered policy checks", () => {
    const html = renderToStaticMarkup(
      <CaseDetail
        initialModel={model({
          currentCaseState: "LINK_CREATED",
          latestPaymentState: "FAILED",
          currentFetchedPaymentState: "FAILED",
          downtimeContext: {
            availability: "AVAILABLE",
            active: false,
            explanation: "No active synthetic downtime was found.",
          },
          paymentTimeline: [
            {
              observedAt: "2026-08-25T08:00:00.000Z",
              origin: "WEBHOOK_EVIDENCE",
              status: "FAILED",
            },
            {
              observedAt: "2026-08-25T08:00:01.000Z",
              origin: "PROVIDER_RECONCILED",
              status: "FAILED",
            },
          ],
          diagnosis: {
            failureClass: "INSUFFICIENT_FUNDS",
            reason: "Known failure evidence supports bounded recovery.",
            evidence: [
              {
                code: "KNOWN_ERROR_CODE",
                detail: "A mapped synthetic failure code was observed.",
              },
            ],
          },
          aiRecommendation: {
            selectedAction: "SEND_PAYMENT_LINK",
            confidence: 0.84,
            rankedActions: [
              {
                rank: 1,
                action: "SEND_PAYMENT_LINK",
                recoveryProbability: 0.65,
                reason: "Highest positive simulated expected value.",
              },
            ],
          },
          expectedValueBreakdown: [
            {
              action: "SEND_PAYMENT_LINK",
              recoveryProbabilityMillionths: 650_000,
              expectedRecoveredSubunits: 97_435,
              contactCostSubunits: 100,
              frictionPenaltySubunits: 200,
              duplicatePaymentRiskPenaltySubunits: 0,
              operationalCostSubunits: 50,
              totalPenaltySubunits: 350,
              expectedValueSubunits: 97_085,
              currency: "INR",
            },
          ],
          policy: {
            proposedAction: "SEND_PAYMENT_LINK",
            finalAction: "SEND_PAYMENT_LINK",
            outcome: "APPROVED",
            primaryRule: "ALL_GUARDRAILS_PASSED",
            reason: "Every deterministic financial guardrail passed.",
            checks: [
              {
                ruleId: "INTENT_MONEY_INTEGRITY",
                status: "PASSED",
                reason: "Amount and currency match trusted context.",
              },
              {
                ruleId: "ALL_GUARDRAILS_PASSED",
                status: "PASSED",
                reason: "The allowlisted action may proceed once.",
              },
            ],
          },
          finalSimulatedOutcome:
            "Mock Payment Link created; simulated payment remains unpaid.",
        })}
      />,
    );

    expect(html).toContain("Fetched current state");
    expect(html).toContain("PROVIDER RECONCILED");
    expect(html).toContain("KNOWN_ERROR_CODE");
    expect(html).toContain("84% confidence");
    expect(html).toContain("Simulated expected-value calculation");
    expect(html).toContain("AI proposed");
    expect(html).toContain("Firewall final");
    expect(html).toContain("INTENT_MONEY_INTEGRITY");
    expect(html).toContain("ALL_GUARDRAILS_PASSED");
    expect(html).toContain("Mock Payment Link created");
  });
});
