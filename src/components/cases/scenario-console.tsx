"use client";

import { RotateCcw, ShieldCheck, TestTube2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  dashboardScenarioResultSchema,
  demoScenarioDashboardSchema,
  type DemoScenarioDashboard,
} from "@/dashboard/contracts";

export function ScenarioConsole({
  initialModel,
}: {
  initialModel: DemoScenarioDashboard;
}) {
  const [model, setModel] = useState(initialModel);
  const [pending, setPending] = useState<string>();
  const [message, setMessage] = useState<string>();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();

  async function run(
    scenarioKey: DemoScenarioDashboard["scenarios"][number]["scenarioKey"],
  ) {
    setPending(scenarioKey);
    setMessage(undefined);
    try {
      const response = await fetch("/api/demo/scenarios/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioKey }),
      });
      const payload: unknown = await response.json();
      if (
        !response.ok ||
        typeof payload !== "object" ||
        payload === null ||
        !("result" in payload)
      )
        throw new Error();
      const result = dashboardScenarioResultSchema.parse(payload.result);
      setModel((current) =>
        demoScenarioDashboardSchema.parse({
          ...current,
          scenarios: current.scenarios.map((scenario) =>
            scenario.scenarioKey === result.scenarioKey
              ? { ...scenario, status: "COMPLETED", result }
              : scenario,
          ),
        }),
      );
      setMessage(result.summary);
      router.refresh();
    } catch {
      setMessage(
        "The fixed simulated scenario stopped safely. No financial action was attempted.",
      );
    } finally {
      setPending(undefined);
    }
  }

  async function reset() {
    setPending("RESET");
    try {
      const response = await fetch("/api/demo/scenarios/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "RESET_DETERMINISTIC_DEMO" }),
      });
      const payload: unknown = await response.json();
      if (
        !response.ok ||
        typeof payload !== "object" ||
        payload === null ||
        !("dashboard" in payload)
      )
        throw new Error();
      setModel(demoScenarioDashboardSchema.parse(payload.dashboard));
      setMessage(
        "Known demo fixtures returned to their exact initial state. Tamper-evident audit history was preserved.",
      );
      dialogRef.current?.close();
      router.refresh();
    } catch {
      setMessage(
        "Reset rolled back safely; existing demo state was preserved.",
      );
    } finally {
      setPending(undefined);
    }
  }

  return (
    <section
      aria-labelledby="scenario-console-heading"
      className="scenario-section"
    >
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">Five-minute proof</p>
          <h2 id="scenario-console-heading">Deterministic safety scenarios</h2>
        </div>
        <button
          className="secondary-button"
          onClick={() => dialogRef.current?.showModal()}
          type="button"
        >
          <RotateCcw aria-hidden="true" size={15} /> Reset demo
        </button>
      </div>
      <div className="scenario-grid">
        {model.scenarios.map((scenario) => (
          <article
            className="surface-card scenario-card"
            key={scenario.scenarioKey}
          >
            <div className="scenario-topline">
              <TestTube2 aria-hidden="true" size={19} />
              <Badge
                tone={scenario.status === "COMPLETED" ? "positive" : "neutral"}
              >
                {scenario.status}
              </Badge>
            </div>
            <h3>{scenario.title}</h3>
            <p>{scenario.description}</p>
            {scenario.result && (
              <div className="scenario-result" role="status">
                <strong>
                  {scenario.result.resultCode.replaceAll("_", " ")}
                </strong>
                <p>{scenario.result.summary}</p>
                <dl>
                  <div>
                    <dt>Final action</dt>
                    <dd>{scenario.result.finalAction ?? "No action"}</dd>
                  </div>
                  <div>
                    <dt>Mock links</dt>
                    <dd>
                      {scenario.result.counters.paymentLinksCreated} created ·{" "}
                      {scenario.result.counters.paymentLinksCancelled} cancelled
                    </dd>
                  </div>
                  <div>
                    <dt>Contacts</dt>
                    <dd>{scenario.result.counters.customerContacts}</dd>
                  </div>
                  <div>
                    <dt>Simulated revenue</dt>
                    <dd>
                      INR{" "}
                      {
                        scenario.result.counters
                          .simulatedRevenueRecoveredSubunits
                      }{" "}
                      subunits
                    </dd>
                  </div>
                </dl>
                <details>
                  <summary>Inspect policy and audit evidence</summary>
                  <ul>
                    {scenario.result.evidence.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </details>
              </div>
            )}
            <button
              className="primary-button"
              disabled={pending !== undefined}
              onClick={() => void run(scenario.scenarioKey)}
              type="button"
            >
              <ShieldCheck aria-hidden="true" size={16} />
              {pending === scenario.scenarioKey
                ? "Running fixed scenario…"
                : scenario.status === "COMPLETED"
                  ? "Replay deterministically"
                  : "Run fixed scenario"}
            </button>
          </article>
        ))}
      </div>
      {message && (
        <p aria-live="polite" className="scenario-message">
          {message}
        </p>
      )}
      <dialog
        aria-labelledby="reset-title"
        className="reset-dialog"
        ref={dialogRef}
      >
        <form method="dialog">
          <button
            aria-label="Close reset confirmation"
            className="dialog-close"
            type="submit"
          >
            ×
          </button>
        </form>
        <p className="eyebrow">Demo Mode only</p>
        <h2 id="reset-title">Reset known synthetic fixtures?</h2>
        <p>
          This removes only allowlisted demo operational records and scenario
          results. Migrations, unknown records, the locked evaluation report,
          and tamper-evident audit history are preserved.
        </p>
        <div className="dialog-actions">
          <button
            className="secondary-button"
            onClick={() => dialogRef.current?.close()}
            type="button"
          >
            Keep current state
          </button>
          <button
            className="danger-button"
            disabled={pending === "RESET"}
            onClick={() => void reset()}
            type="button"
          >
            {pending === "RESET" ? "Resetting…" : "Confirm deterministic reset"}
          </button>
        </div>
      </dialog>
    </section>
  );
}
