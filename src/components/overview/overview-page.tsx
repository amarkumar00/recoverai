import { FlaskConical, Info, ShieldCheck } from "lucide-react";

import { FailureDistribution } from "@/components/overview/failure-distribution";
import { MetricCard } from "@/components/overview/metric-card";
import { RecentActivity } from "@/components/overview/recent-activity";
import { RecoveryComparison } from "@/components/overview/recovery-comparison";
import { Badge } from "@/components/ui/badge";
import type { GoldenEvaluationReport } from "@/evaluation/contracts";
import { formatInrFromPaise } from "@/lib/currency";

export function OverviewPage({ report }: { report: GoldenEvaluationReport }) {
  const result = report.result;
  const metrics = [
    {
      label: "Unique payment cases",
      value: String(result.uniqueCaseCount),
      detail: "held-out synthetic cases",
      tone: "neutral" as const,
    },
    {
      label: "Initially at risk · simulated",
      value: formatInrFromPaise(
        result.simulatedRevenueInitiallyAtRisk.amountSubunits,
      ),
      detail: "INR 11,883,796 subunits",
      tone: "warning" as const,
    },
    {
      label: "Incremental recovery · simulated",
      value: `+${formatInrFromPaise(result.incrementalSimulatedRecovery.subunitDelta)}`,
      detail: "INR +741,949 subunits · RecoverAI minus baseline",
      tone: "positive" as const,
    },
    {
      label: "Recovery rate · simulated",
      value: `${Math.round(result.simulatedRecoveryRate * 100)}%`,
      detail: `${result.recoverAiRecoveredCaseCount} of ${result.uniqueCaseCount} cases`,
      tone: "positive" as const,
    },
    {
      label: "Duplicate deliveries ignored",
      value: String(result.duplicateEventsIgnored),
      detail: "zero repeated simulated effects",
      tone: "neutral" as const,
    },
    {
      label: "Unsafe actions blocked / redirected",
      value: String(result.unsafeActionsBlocked),
      detail: "deterministic policy outcomes",
      tone: "blocked" as const,
    },
    {
      label: "Unnecessary contacts avoided",
      value: String(result.customerContactsAvoided),
      detail: "baseline-relative simulated count",
      tone: "positive" as const,
    },
    {
      label: "Honest unresolved / escalated",
      value: String(result.unresolvedExceptionCount),
      detail: `${result.humanEscalationCount} human escalations`,
      tone: "warning" as const,
    },
  ];

  return (
    <div className="page-wrap">
      <header className="page-heading">
        <div>
          <div className="heading-kicker">
            <Badge tone="demo">Demo Mode · Synthetic Data</Badge>
            <span>Locked run · {result.completedAt.slice(0, 10)}</span>
          </div>
          <h1>Payment failure recovery, with hard boundaries.</h1>
          <p>
            Measured evidence from a locked 100-case synthetic Digital Twin,
            paired with deterministic financial controls and honest exceptions.
          </p>
        </div>
        <div className="trust-summary">
          <ShieldCheck aria-hidden="true" size={22} />
          <div>
            <strong>Prototype safety status</strong>
            <span>No real payments · No credentials · No PII</span>
          </div>
        </div>
      </header>
      <div className="prototype-notice" role="note">
        <Info aria-hidden="true" size={18} />
        <p>
          <strong>How to read this:</strong> every money figure and outcome is
          simulated. Handcrafted fixtures make diagnosis deterministic; 100%
          synthetic-fixture accuracy is not a production accuracy or real
          revenue-uplift claim.
        </p>
      </div>
      <section aria-labelledby="snapshot-heading">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Batch snapshot</p>
            <h2 id="snapshot-heading">Recovery control overview</h2>
          </div>
          <span className="section-state">
            <FlaskConical aria-hidden="true" size={15} /> Validated golden
            report
          </span>
        </div>
        <div className="metrics-grid">
          {metrics.map((metric) => (
            <MetricCard key={metric.label} metric={metric} />
          ))}
        </div>
      </section>
      <section aria-label="Simulated recovery charts" className="charts-grid">
        <RecoveryComparison result={result} />
        <FailureDistribution result={result} />
      </section>
      <RecentActivity result={result} />
      <div className="prototype-notice overview-latency-note" role="note">
        <Info aria-hidden="true" size={18} />
        <p>
          <strong>{result.meanProcessingTimeMilliseconds} ms</strong> is
          simulated deterministic logical processing time per delivery—not
          measured production latency.
        </p>
      </div>
    </div>
  );
}
