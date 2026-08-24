import type { CSSProperties } from "react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { overviewFixture } from "@/lib/fixtures/overview";

export function FailureDistribution() {
  return (
    <Card>
      <CardHeader>
        <div>
          <p className="eyebrow">Digital Twin preview</p>
          <h2>Failure-class distribution</h2>
        </div>
        <span className="chart-context">Synthetic</span>
      </CardHeader>
      <CardContent>
        <div className="distribution-list">
          {overviewFixture.failureClasses.map((item) => (
            <div className="distribution-row" key={item.label}>
              <div className="distribution-label">
                <span>{item.label}</span>
                <strong>{item.count}</strong>
              </div>
              <div className="distribution-track">
                <span
                  className="distribution-fill"
                  data-tone={item.tone}
                  style={
                    {
                      "--distribution-size": `${item.count * 4}%`,
                    } as CSSProperties
                  }
                />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
