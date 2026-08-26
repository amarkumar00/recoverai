import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import goldenReportJson from "../../../docs/evaluation/golden-report.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { AuditTrailPage } from "@/components/audit/audit-trail-page";
import { ScenarioConsole } from "@/components/cases/scenario-console";
import { EvaluationPageView } from "@/components/evaluation/evaluation-page";
import { EventStream } from "@/components/events/event-stream";
import { OverviewPage } from "@/components/overview/overview-page";
import { PolicyFirewallPage } from "@/components/policy/policy-firewall-page";
import { createSqliteAuditChain } from "@/audit";
import {
  auditReadModelSchema,
  eventStreamReadModelSchema,
  policyReadModelSchema,
  resetDemoRequestSchema,
  runScenarioRequestSchema,
} from "@/dashboard/contracts";
import { SCENARIO_CATALOG } from "@/dashboard/scenario-catalog";
import { DemoScenarioStore } from "@/dashboard/scenario-store";
import { LOCKED_DEFAULT_HELD_OUT_FINGERPRINT_SHA256 } from "@/digital-twin/contracts";
import { goldenEvaluationReportSchema } from "@/evaluation/contracts";
import { createLocalDatabase } from "@/lib/db/client";
import { runDatabaseMigrations } from "@/lib/db/migrations";

const openDatabases: ReturnType<typeof createLocalDatabase>[] = [];

function store() {
  const database = createLocalDatabase(":memory:");
  openDatabases.push(database);
  runDatabaseMigrations(database);
  return { database, scenarios: new DemoScenarioStore(database) };
}

afterEach(() => {
  for (const database of openDatabases.splice(0)) database.client.close();
});

describe("Milestone 14 dashboard evidence", () => {
  it("renders exact validated golden metrics without evaluator-only outcomes", () => {
    const report = goldenEvaluationReportSchema.parse(goldenReportJson);
    const html = renderToStaticMarkup(<OverviewPage report={report} />);
    expect(html).toContain("100");
    expect(html).toContain("11,883,796 subunits");
    expect(html).toContain("₹47,843.83");
    expect(html).toContain("₹55,263.32");
    expect(html).toContain("42%");
    expect(html).toContain("741,949");
    expect(html).toContain("Duplicate deliveries ignored");
    expect(html).toContain("Unsafe actions blocked / redirected");
    expect(html).toContain("Unnecessary contacts avoided");
    expect(html).toContain("19 human escalations");
    expect(html).toContain("43");
    expect(html).toContain("simulated deterministic logical processing time");
    expect(html).not.toContain("hiddenSimulatedOutcomeByAction");
    expect(report.result.datasetFingerprintSha256).toBe(
      LOCKED_DEFAULT_HELD_OUT_FINGERPRINT_SHA256,
    );
  });

  it("renders all evaluation groups, the complete matrix, and honest exceptions", () => {
    const report = goldenEvaluationReportSchema.parse(goldenReportJson);
    const html = renderToStaticMarkup(<EvaluationPageView report={report} />);
    for (const group of report.result.resultsByFailureClass)
      expect(html).toContain(group.failureClass.replaceAll("_", " "));
    for (const group of report.result.resultsBySelectedAction)
      expect(html).toContain(group.selectedAction);
    expect((html.match(/data-diagonal=/g) ?? []).length).toBe(49);
    expect(html).toContain("43 unresolved or escalated simulated outcomes");
    expect(html).toContain("False-positive simulated cost");
  });

  it("renders privacy-safe event, policy, audit-invalid, and keyboard controls", () => {
    const { scenarios } = store();
    const duplicate = scenarios.run("DUPLICATE_DELIVERY");
    const eventModel = eventStreamReadModelSchema.parse({
      rows: duplicate.events.map((event) => ({
        ...event,
        caseReference: "case_demo_safe_v1",
      })),
      generatedFrom: "PERSISTED_DEMO_SCENARIOS",
    });
    const eventHtml = renderToStaticMarkup(
      <EventStream initialModel={eventModel} />,
    );
    expect(eventHtml).toContain("DUPLICATE IGNORED");
    expect(eventHtml).toContain("Snapshot → current");
    expect(eventHtml).not.toMatch(
      /rawBody|payloadDigest|customerHash|rzp_live/i,
    );

    const policy = policyReadModelSchema.parse({
      maxPaymentLinksPerOrder: 1,
      maxCustomerContacts: 2,
      maxRecoveryWindowHours: 24,
      minimumConfidencePercent: 70,
      allowedActions: [
        "WAIT_FOR_RECOVERY",
        "SEND_PAYMENT_LINK",
        "REQUEST_METHOD_CHANGE",
        "CANCEL_RECOVERY_ALREADY_PAID",
        "STOP_NON_RETRYABLE",
        "ESCALATE_HUMAN",
      ],
      integrityRules: ["Exact amount and currency must match."],
      recentDecisions: [],
    });
    const policyHtml = renderToStaticMarkup(
      <PolicyFirewallPage model={policy} />,
    );
    expect(policyHtml).toContain(
      "AI proposes; deterministic financial policy disposes",
    );
    expect(policyHtml).toContain("70%");
    expect(policyHtml).toContain("24 hours");

    const auditHtml = renderToStaticMarkup(
      <AuditTrailPage
        model={auditReadModelSchema.parse({
          status: "INVALID",
          issue: "CURRENT_HASH_MISMATCH",
          entries: [],
        })}
      />,
    );
    expect(auditHtml).toContain("Verification failed");
    expect(auditHtml).not.toContain("Chain valid");

    const scenarioHtml = renderToStaticMarkup(
      <ScenarioConsole initialModel={scenarios.list()} />,
    );
    expect(scenarioHtml).toContain("Reset known synthetic fixtures?");
    expect(scenarioHtml).toContain('aria-labelledby="reset-title"');
    expect((scenarioHtml.match(/class="primary-button"/g) ?? []).length).toBe(
      6,
    );
  });

  it("keeps the committed golden report byte hash unchanged", () => {
    const bytes = readFileSync("docs/evaluation/golden-report.json");
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      "0405a6621ba88f362877907ba7dea1624643696b92907ef5f4b13cf9bf22f30c",
    );
  });
});

describe("fixed deterministic scenario store and reset", () => {
  it("rejects arbitrary scenarios, actions, amounts, identifiers, and reset commands", () => {
    expect(
      runScenarioRequestSchema.safeParse({
        scenarioKey: "DUPLICATE_DELIVERY",
        amountSubunits: 999_999,
      }).success,
    ).toBe(false);
    expect(
      runScenarioRequestSchema.safeParse({ scenarioKey: "REFUND_PAYMENT" })
        .success,
    ).toBe(false);
    expect(
      resetDemoRequestSchema.safeParse({ confirmation: "yes", table: "*" })
        .success,
    ).toBe(false);
    expect(
      resetDemoRequestSchema.safeParse({
        confirmation: "RESET_DETERMINISTIC_DEMO",
      }).success,
    ).toBe(true);
  });

  it("runs every allowlisted scenario with its required safe outcome", () => {
    const { scenarios } = store();
    for (const item of SCENARIO_CATALOG) scenarios.run(item.scenarioKey);
    const dashboard = scenarios.list();
    expect(dashboard.scenarios).toHaveLength(6);
    expect(
      dashboard.scenarios.every((item) => item.status === "COMPLETED"),
    ).toBe(true);

    const duplicate = dashboard.scenarios.find(
      (item) => item.scenarioKey === "DUPLICATE_DELIVERY",
    )!.result!;
    expect(duplicate.counters).toMatchObject({
      acceptedDeliveries: 1,
      duplicatesIgnored: 1,
      customerContacts: 0,
      paymentLinksCreated: 0,
      simulatedRevenueRecoveredSubunits: 0,
    });
    expect(duplicate.events[1]?.deliveryStatus).toBe("DUPLICATE_IGNORED");

    const outOfOrder = dashboard.scenarios.find(
      (item) => item.scenarioKey === "OUT_OF_ORDER",
    )!.result!;
    expect(
      outOfOrder.events.map((event) => event.webhookSnapshotState),
    ).toEqual(["CAPTURED", "AUTHORIZED"]);
    expect(
      outOfOrder.events.every(
        (event) => event.authoritativeCurrentState === "CAPTURED",
      ),
    ).toBe(true);

    const late = dashboard.scenarios.find(
      (item) => item.scenarioKey === "LATE_SUCCESS",
    )!.result!;
    expect(late.counters.paymentLinksCancelled).toBe(1);
    expect(late.finalCaseState).toBe("STOPPED");
    expect(late.evidence.join(" ")).toContain("PARTIALLY_PAID");

    const unsafe = dashboard.scenarios.find(
      (item) => item.scenarioKey === "INVALID_AI_AMOUNT",
    )!.result!;
    expect(unsafe.primaryRule).toBe("INTENT_MONEY_INTEGRITY");
    expect(unsafe.counters.paymentLinksCreated).toBe(0);

    const timeout = dashboard.scenarios.find(
      (item) => item.scenarioKey === "AI_TIMEOUT",
    )!.result!;
    expect(timeout.finalAction).toBe("ESCALATE_HUMAN");
    expect(timeout.counters.automaticRetries).toBe(0);

    const downtime = dashboard.scenarios.find(
      (item) => item.scenarioKey === "DOWNTIME_FAILURE",
    )!.result!;
    expect(downtime.evidence.join(" ")).toContain(
      "No active downtime was inferred",
    );
    expect(downtime.finalAction).toBe("ESCALATE_HUMAN");
  });

  it("reset is repeatable, scoped to demo fixtures, and cannot change evaluation artifacts", () => {
    const { database, scenarios } = store();
    database.client
      .prepare(
        "INSERT INTO recovery_cases (case_id,payment_id,order_id,synthetic_customer_hash,verified_unpaid_amount_subunits,currency,state,attempt_number,previous_success_count,previous_failure_count,contact_count,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        "case_unknown_preserved",
        "pay_unknown_preserved",
        "order_unknown_preserved",
        "f".repeat(64),
        100,
        "INR",
        "DETECTED",
        1,
        0,
        1,
        0,
        1,
        "2026-08-26T00:00:00.000Z",
        "2026-08-26T00:00:00.000Z",
      );
    scenarios.run("DUPLICATE_DELIVERY");
    const audit = createSqliteAuditChain(database);
    expect(
      audit.append({
        entryId: "audit_reset_preservation_v1",
        timestamp: "2026-08-26T10:00:00.000Z",
        actor: "AUDIT_SYSTEM",
        inputReference: "demo_reset_boundary",
        eventType: "DEMO_RESET_BOUNDARY_VERIFIED",
        reason: "A fixed test checkpoint proves reset preserves audit history.",
        previousState: null,
        newState: null,
        metadata: { isSynthetic: true },
      }).status,
    ).toBe("APPENDED");
    const before = readFileSync("docs/evaluation/golden-report.json");
    expect(
      scenarios
        .resetKnownDemoFixtures()
        .scenarios.every((item) => item.status === "READY"),
    ).toBe(true);
    expect(
      scenarios
        .resetKnownDemoFixtures()
        .scenarios.every((item) => item.status === "READY"),
    ).toBe(true);
    expect(
      database.client
        .prepare(
          "SELECT count(*) AS count FROM recovery_cases WHERE case_id = ?",
        )
        .get("case_unknown_preserved"),
    ).toEqual({ count: 1 });
    expect(audit.verify()).toMatchObject({
      status: "VALID",
      checkpoint: { entryCount: 1 },
    });
    expect(readFileSync("docs/evaluation/golden-report.json")).toEqual(before);
  });
});
