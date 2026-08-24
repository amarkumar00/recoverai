import { FlaskConical, Info, ShieldCheck } from "lucide-react";

import { FailureDistribution } from "@/components/overview/failure-distribution";
import { MetricCard } from "@/components/overview/metric-card";
import { RecentActivity } from "@/components/overview/recent-activity";
import { RecoveryComparison } from "@/components/overview/recovery-comparison";
import { Badge } from "@/components/ui/badge";
import { overviewFixture } from "@/lib/fixtures/overview";

export function OverviewPage() {
  return (
    <div className="page-wrap">
      <header className="page-heading">
        <div>
          <div className="heading-kicker">
            <Badge tone="demo">Demo Mode · Synthetic Data</Badge>
            <span>{overviewFixture.generatedAt}</span>
          </div>
          <h1>Payment failure recovery, with hard boundaries.</h1>
          <p>
            A static preview of how RecoverAI will diagnose failed payments,
            constrain recovery actions, and measure incremental simulated
            recovery across a reproducible batch.
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
          <strong>Illustrative preview:</strong> every rupee figure below is a
          simulated result from static synthetic fixture data—not real merchant
          revenue and not a production claim.
        </p>
      </div>

      <section aria-labelledby="snapshot-heading">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Batch snapshot</p>
            <h2 id="snapshot-heading">Recovery control overview</h2>
          </div>
          <span className="section-state">
            <FlaskConical aria-hidden="true" size={15} />
            Static synthetic fixtures
          </span>
        </div>
        <div className="metrics-grid">
          {overviewFixture.metrics.map((metric) => (
            <MetricCard key={metric.label} metric={metric} />
          ))}
        </div>
      </section>

      <section aria-label="Simulated recovery charts" className="charts-grid">
        <RecoveryComparison />
        <FailureDistribution />
      </section>

      <RecentActivity />
    </div>
  );
}
