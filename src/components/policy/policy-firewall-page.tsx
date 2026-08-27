import { LockKeyhole, Scale, ShieldCheck } from "lucide-react";

import { PolicyCheckStatus } from "@/components/policy/policy-check-status";
import { Badge } from "@/components/ui/badge";
import type { PolicyReadModel } from "@/dashboard/contracts";

function decisionTone(outcome: string) {
  if (outcome === "APPROVED") return "positive" as const;
  if (outcome === "STOPPED") return "warning" as const;
  return "blocked" as const;
}

export function PolicyFirewallPage({ model }: { model: PolicyReadModel }) {
  return (
    <div className="page-wrap operational-page">
      <header className="page-heading">
        <div>
          <div className="heading-kicker">
            <Badge tone="positive">Read-only deterministic controls</Badge>
            <span>Financial safety boundary</span>
          </div>
          <h1>Policy Firewall</h1>
          <p>AI proposes; deterministic financial policy disposes.</p>
        </div>
        <div className="trust-summary">
          <LockKeyhole aria-hidden="true" size={20} />
          <div>
            <strong>No editable policy controls</strong>
            <span>UI has zero financial execution authority</span>
          </div>
        </div>
      </header>
      <div className="policy-layout">
        <section
          className="surface-card policy-limits"
          aria-labelledby="limits-heading"
        >
          <div className="card-header">
            <div>
              <p className="eyebrow">Active limits</p>
              <h2 id="limits-heading">Hard safety defaults</h2>
            </div>
            <ShieldCheck aria-hidden="true" size={20} />
          </div>
          <div className="limit-grid">
            <div>
              <span>Minimum AI confidence</span>
              <strong>{model.minimumConfidencePercent}%</strong>
            </div>
            <div>
              <span>Maximum customer contacts</span>
              <strong>{model.maxCustomerContacts}</strong>
            </div>
            <div>
              <span>Recovery window</span>
              <strong>{model.maxRecoveryWindowHours} hours</strong>
            </div>
            <div>
              <span>Active mock links / order</span>
              <strong>{model.maxPaymentLinksPerOrder}</strong>
            </div>
          </div>
          <ul className="rule-list">
            {model.integrityRules.map((rule) => (
              <li key={rule}>
                <Scale aria-hidden="true" size={15} />
                <span>{rule}</span>
              </li>
            ))}
          </ul>
        </section>
        <section
          className="surface-card allowed-actions"
          aria-labelledby="actions-heading"
        >
          <div className="card-header">
            <div>
              <p className="eyebrow">Closed allowlist</p>
              <h2 id="actions-heading">Six permitted actions</h2>
            </div>
          </div>
          <ol>
            {model.allowedActions.map((action, index) => (
              <li key={action}>
                <span>{index + 1}</span>
                <code>{action}</code>
              </li>
            ))}
          </ol>
          <p>No prompt or client control can create another action.</p>
        </section>
      </div>
      <section
        className="surface-card decisions-surface"
        aria-labelledby="decisions-heading"
      >
        <div className="card-header">
          <div>
            <p className="eyebrow">Explainable evidence</p>
            <h2 id="decisions-heading">Recent policy decisions</h2>
          </div>
          <span className="chart-context">
            {model.recentDecisions.length} visible
          </span>
        </div>
        {model.recentDecisions.length === 0 ? (
          <div className="empty-state">
            <ShieldCheck aria-hidden="true" size={24} />
            <h3>No decisions yet</h3>
            <p>
              Run a bounded case or safety scenario to populate this read-only
              evidence.
            </p>
          </div>
        ) : (
          <div className="decision-list">
            {model.recentDecisions.map((decision, index) => (
              <article key={`${decision.caseReference}:${index}`}>
                <div className="decision-heading">
                  <div>
                    <code>{decision.caseReference}</code>
                    <h3>{decision.primaryRule.replaceAll("_", " ")}</h3>
                  </div>
                  <Badge tone={decisionTone(decision.outcome)}>
                    {decision.outcome}
                  </Badge>
                </div>
                <p>{decision.reason}</p>
                <dl>
                  <div>
                    <dt>AI proposed</dt>
                    <dd>{decision.proposedAction}</dd>
                  </div>
                  <div>
                    <dt>Final action</dt>
                    <dd>{decision.finalAction ?? "NONE"}</dd>
                  </div>
                </dl>
                <details>
                  <summary>
                    Ordered supporting checks ({decision.checks.length})
                  </summary>
                  <ol className="policy-checks">
                    {decision.checks.map((check) => (
                      <li key={check.ruleId} data-status={check.status}>
                        <PolicyCheckStatus status={check.status} />
                        <strong className="policy-check-rule">
                          {check.ruleId}
                        </strong>
                        <p>{check.reason}</p>
                      </li>
                    ))}
                  </ol>
                </details>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
