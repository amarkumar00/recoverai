import type { CSSProperties } from "react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { overviewFixture } from "@/lib/fixtures/overview";

export function RecoveryComparison() {
  return (
    <Card className="comparison-card">
      <CardHeader>
        <div>
          <p className="eyebrow">Simulated recovery performance</p>
          <h2>Baseline vs RecoverAI</h2>
        </div>
        <span className="chart-context">100 synthetic cases</span>
      </CardHeader>
      <CardContent>
        <div className="comparison-bars">
          {overviewFixture.comparison.map((item) => (
            <div className="comparison-row" key={item.label}>
              <div className="comparison-label">
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
              <div
                aria-label={`${item.label}: ${item.percent}%`}
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={item.percent}
                className="bar-track"
                role="progressbar"
              >
                <span
                  className="bar-fill"
                  data-tone={item.tone}
                  style={{ "--bar-size": `${item.percent}%` } as CSSProperties}
                />
              </div>
              <span className="comparison-percent">
                {item.percent}% simulated recovery rate
              </span>
            </div>
          ))}
        </div>
        <div className="increment-callout">
          <span>Incremental simulated recovery</span>
          <strong>+₹1,19,250</strong>
          <p>RecoverAI minus the documented generic baseline.</p>
        </div>
      </CardContent>
    </Card>
  );
}
