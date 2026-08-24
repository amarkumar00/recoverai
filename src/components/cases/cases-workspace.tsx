"use client";

import {
  ArrowRight,
  FlaskConical,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { DemoActionControls } from "@/components/cases/demo-action-controls";
import { Badge } from "@/components/ui/badge";
import { formatInrFromPaise } from "@/lib/currency";
import type {
  DemoCaseReadModel,
  DemoDashboardReadModel,
} from "@/orchestration/contracts";

function tone(model: DemoCaseReadModel) {
  if (model.workflowStage === "RECOVERED_STOPPED") return "positive" as const;
  if (model.workflowStage === "UNSAFE_ACTION_BLOCKED")
    return "blocked" as const;
  if (model.currentCaseState === null) return "neutral" as const;
  return "warning" as const;
}

function DemoCaseCard({ initialModel }: { initialModel: DemoCaseReadModel }) {
  const [model, setModel] = useState(initialModel);
  const unsafe = model.scenario === "UNSAFE_AMOUNT_PROBE";
  return (
    <article className="surface-card case-card">
      <div className="case-card-topline">
        <div className="case-icon" data-unsafe={unsafe}>
          {unsafe ? <ShieldAlert size={20} /> : <FlaskConical size={20} />}
        </div>
        <Badge tone={tone(model)}>
          {model.workflowStage.replaceAll("_", " ")}
        </Badge>
      </div>
      <p className="eyebrow">
        {unsafe ? "Adversarial proof" : "Primary vertical slice"}
      </p>
      <h2>{unsafe ? "10× amount policy probe" : "Payment failure recovery"}</h2>
      <p className="case-description">
        {unsafe
          ? "A fixed unsafe proposal proves money integrity is enforced before execution."
          : "A deterministic failed UPI payment moves through diagnosis, AI ranking, policy, mock link, and stopping."}
      </p>
      <dl className="compact-facts">
        <div>
          <dt>Simulated amount</dt>
          <dd>{formatInrFromPaise(model.simulatedAmountSubunits)}</dd>
        </div>
        <div>
          <dt>Case state</dt>
          <dd>{model.currentCaseState ?? "Not started"}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{model.sourceBoundary}</dd>
        </div>
      </dl>
      <div className="case-card-actions">
        <DemoActionControls model={model} onUpdate={setModel} />
        <Link className="secondary-link" href={`/cases/${model.caseId}`}>
          Inspect case <ArrowRight aria-hidden="true" size={15} />
        </Link>
      </div>
    </article>
  );
}

export function CasesWorkspace({
  initialModel,
}: {
  initialModel: DemoDashboardReadModel;
}) {
  return (
    <div className="page-wrap cases-page">
      <header className="page-heading">
        <div>
          <div className="heading-kicker">
            <Badge tone="demo">Trusted synthetic demo</Badge>
            <span>Track 03 · AI Revenue Recovery</span>
          </div>
          <h1>One recovery path, fully bounded.</h1>
          <p>
            Run the first persisted RecoverAI vertical slice without Razorpay or
            LLM credentials. Every money value and outcome shown here is
            simulated.
          </p>
        </div>
        <div className="trust-summary">
          <ShieldCheck aria-hidden="true" size={20} />
          <div>
            <strong>
              Audit chain {initialModel.primary.auditVerification.status}
            </strong>
            <span>Signature verification: NOT_CHECKED</span>
          </div>
        </div>
      </header>
      <div className="prototype-notice" role="note">
        <ShieldAlert aria-hidden="true" size={18} />
        <p>
          Trusted synthetic demo events bypass external webhook verification in
          this milestone. No public webhook exists, no real payment moves, and
          no production-readiness claim is made.
        </p>
      </div>
      <section aria-labelledby="demo-cases-heading">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Interactive scenarios</p>
            <h2 id="demo-cases-heading">Credential-free recovery cases</h2>
          </div>
          <span className="section-state">2 fixed synthetic fixtures</span>
        </div>
        <div className="case-grid">
          <DemoCaseCard initialModel={initialModel.primary} />
          <DemoCaseCard initialModel={initialModel.unsafe} />
        </div>
      </section>
    </div>
  );
}
