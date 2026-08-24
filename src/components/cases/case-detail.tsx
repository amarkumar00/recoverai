"use client";

import {
  ArrowLeft,
  Bot,
  CircleDollarSign,
  FileCheck2,
  LockKeyhole,
  Route,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { DemoActionControls } from "@/components/cases/demo-action-controls";
import { Badge } from "@/components/ui/badge";
import { formatInrFromPaise } from "@/lib/currency";
import type { DemoCaseReadModel } from "@/orchestration/contracts";

function stateTone(model: DemoCaseReadModel) {
  if (model.currentCaseState === "RECOVERED") return "positive" as const;
  if (model.currentCaseState === "ESCALATED") return "blocked" as const;
  return "warning" as const;
}

export function CaseDetail({
  initialModel,
}: {
  initialModel: DemoCaseReadModel;
}) {
  const [model, setModel] = useState(initialModel);
  const unsafe = model.scenario === "UNSAFE_AMOUNT_PROBE";
  const selectedBreakdown = model.expectedValueBreakdown.find(
    (item) => item.action === model.aiRecommendation?.selectedAction,
  );

  return (
    <div className="page-wrap case-detail-page">
      <Link className="back-link" href="/cases">
        <ArrowLeft aria-hidden="true" size={15} /> Cases
      </Link>
      <header className="case-detail-header">
        <div>
          <div className="heading-kicker">
            <Badge tone="demo">Synthetic demo</Badge>
            <span>{model.caseId}</span>
          </div>
          <h1>{unsafe ? "Unsafe amount proof" : "Payment recovery case"}</h1>
          <p>
            {unsafe
              ? "A fixed adversarial fixture demonstrating deterministic policy enforcement."
              : "A persisted, resumable, bounded recovery workflow using mock dependencies."}
          </p>
        </div>
        <div className="detail-actions">
          <Badge tone={stateTone(model)}>
            {model.currentCaseState ?? "NOT STARTED"}
          </Badge>
          <DemoActionControls model={model} onUpdate={setModel} />
        </div>
      </header>

      <div className="trust-strip">
        <span>
          <LockKeyhole size={15} /> {model.sourceBoundary}
        </span>
        <span>Signature: {model.signatureStatus}</span>
        <span>Real money: NO</span>
        <span>Production ready: NO</span>
      </div>

      <section className="detail-grid">
        <article className="surface-card detail-card">
          <div className="detail-card-title">
            <CircleDollarSign size={18} />
            <h2>Payment context</h2>
          </div>
          <dl className="detail-facts">
            <div>
              <dt>Simulated amount</dt>
              <dd>{formatInrFromPaise(model.simulatedAmountSubunits)}</dd>
            </div>
            <div>
              <dt>Latest payment</dt>
              <dd>{model.latestPaymentState ?? "Not observed"}</dd>
            </div>
            <div>
              <dt>Case state</dt>
              <dd>{model.currentCaseState ?? "Not started"}</dd>
            </div>
            <div>
              <dt>Simulated contacts</dt>
              <dd>{model.customerContactCount}</dd>
            </div>
          </dl>
        </article>

        <article className="surface-card detail-card">
          <div className="detail-card-title">
            <Route size={18} />
            <h2>Known-error diagnosis</h2>
          </div>
          {model.diagnosis ? (
            <>
              <Badge tone="neutral">{model.diagnosis.failureClass}</Badge>
              <p>{model.diagnosis.reason}</p>
              <ul className="evidence-list">
                {model.diagnosis.evidence.map((item) => (
                  <li key={item.code}>
                    <strong>{item.code}</strong>
                    <span>{item.detail}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>Start the fixed scenario to persist diagnosis evidence.</p>
          )}
        </article>

        <article className="surface-card detail-card">
          <div className="detail-card-title">
            <Bot size={18} />
            <h2>Passive AI ranking</h2>
          </div>
          {model.aiRecommendation ? (
            <>
              <div className="recommendation-top">
                <strong>{model.aiRecommendation.selectedAction}</strong>
                <span>
                  {Math.round(model.aiRecommendation.confidence * 100)}%
                  confidence
                </span>
              </div>
              <ol className="ranking-list">
                {model.aiRecommendation.rankedActions.map((item) => (
                  <li key={item.action}>
                    <span>#{item.rank}</span>
                    <div>
                      <strong>{item.action}</strong>
                      <p>{item.reason}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p>
              No recommendation has been persisted. AI cannot execute an action.
            </p>
          )}
        </article>

        <article className="surface-card detail-card">
          <div className="detail-card-title">
            <ShieldCheck size={18} />
            <h2>Policy firewall</h2>
          </div>
          {model.policy ? (
            <>
              <div className="recommendation-top">
                <Badge
                  tone={
                    model.policy.outcome === "APPROVED" ? "positive" : "blocked"
                  }
                >
                  {model.policy.outcome}
                </Badge>
                <strong>{model.policy.primaryRule}</strong>
              </div>
              <p>{model.policy.reason}</p>
              <div className="check-list">
                {model.policy.checks.map((check) => (
                  <div key={check.ruleId} data-status={check.status}>
                    <span>{check.status}</span>
                    <strong>{check.ruleId}</strong>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p>Policy evaluation has not run.</p>
          )}
        </article>
      </section>

      {selectedBreakdown && (
        <section className="surface-card ev-card">
          <div className="detail-card-title">
            <FileCheck2 size={18} />
            <h2>Simulated expected-value calculation</h2>
          </div>
          <div className="ev-grid">
            <div>
              <span>Simulated expected recovery</span>
              <strong>
                {formatInrFromPaise(
                  selectedBreakdown.expectedRecoveredSubunits,
                )}
              </strong>
            </div>
            <div>
              <span>Simulated total penalty</span>
              <strong>
                {formatInrFromPaise(selectedBreakdown.totalPenaltySubunits)}
              </strong>
            </div>
            <div>
              <span>Simulated expected value</span>
              <strong>
                {formatInrFromPaise(selectedBreakdown.expectedValueSubunits)}
              </strong>
            </div>
            <div>
              <span>Estimated recovery probability</span>
              <strong>
                {(
                  selectedBreakdown.recoveryProbabilityMillionths / 10_000
                ).toFixed(1)}
                %
              </strong>
            </div>
          </div>
        </section>
      )}

      {model.paymentLink && (
        <section className="surface-card link-result-card">
          <div>
            <p className="eyebrow">Mock Payment Link</p>
            <h2>{model.paymentLink.status}</h2>
            <p>No public URL is exposed and no customer message was sent.</p>
          </div>
          <dl>
            <div>
              <dt>Simulated link amount</dt>
              <dd>{formatInrFromPaise(model.paymentLink.amountSubunits)}</dd>
            </div>
            <div>
              <dt>Reference</dt>
              <dd>{model.paymentLink.recoveryLinkId}</dd>
            </div>
          </dl>
        </section>
      )}

      {model.unsafeProof && (
        <section className="unsafe-proof" role="status">
          <ShieldCheck aria-hidden="true" size={22} />
          <div>
            <p className="eyebrow">No action executed</p>
            <h2>
              10× simulated amount stopped at {model.unsafeProof.rejectingRule}
            </h2>
            <p>
              Verified simulated amount{" "}
              {formatInrFromPaise(
                model.unsafeProof.verifiedAllowedAmountSubunits,
              )}
              ; rejected proposal{" "}
              {formatInrFromPaise(
                model.unsafeProof.proposedUnsafeAmountSubunits,
              )}
              . No executor, link, or contact was created.
            </p>
          </div>
        </section>
      )}

      <section className="surface-card timeline-card">
        <div className="detail-card-title">
          <FileCheck2 size={18} />
          <h2>Tamper-evident audit timeline</h2>
          <Badge
            tone={
              model.auditVerification.status === "VALID"
                ? "positive"
                : "blocked"
            }
          >
            {model.auditVerification.status}
          </Badge>
        </div>
        {model.timeline.length === 0 ? (
          <p>No persisted steps yet.</p>
        ) : (
          <ol className="timeline-list">
            {model.timeline.map((entry) => (
              <li key={entry.entryId}>
                <span className="timeline-dot" />
                <div>
                  <div>
                    <strong>{entry.eventType.replaceAll("_", " ")}</strong>
                    <time>
                      {entry.timestamp
                        .replace("T", " ")
                        .replace(".000Z", " UTC")}
                    </time>
                  </div>
                  <p>{entry.reason}</p>
                  <small>
                    {entry.previousState ?? "—"} → {entry.newState ?? "—"}
                  </small>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
