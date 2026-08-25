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
    expectedValueBreakdown: [],
    customerContactCount: 0,
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
});
