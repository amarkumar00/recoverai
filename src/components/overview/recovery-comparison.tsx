import type { CSSProperties } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { SimulatedEvaluationResult } from "@/domain/evaluation";
import { formatInrFromPaise } from "@/lib/currency";

export function RecoveryComparison({
  result,
}: {
  result: SimulatedEvaluationResult;
}) {
  const comparison = [
    {
      label: "Generic baseline",
      value: formatInrFromPaise(
        result.baselineSimulatedRecovery.amountSubunits,
      ),
      percent:
        (result.baselineRecoveredCaseCount / result.uniqueCaseCount) * 100,
      tone: "baseline",
    },
    {
      label: "RecoverAI",
      value: formatInrFromPaise(
        result.recoverAiSimulatedRecovery.amountSubunits,
      ),
      percent: result.simulatedRecoveryRate * 100,
      tone: "recoverai",
    },
  ] as const;
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
          {comparison.map((item) => (
            <div className="comparison-row" key={item.label}>
              <div className="comparison-label">
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
              <div
                aria-label={`${item.label}: ${item.percent}% simulated recovery`}
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
          <strong>
            +
            {formatInrFromPaise(
              result.incrementalSimulatedRecovery.subunitDelta,
            )}
          </strong>
          <p>RecoverAI minus the documented generic baseline.</p>
        </div>
      </CardContent>
    </Card>
  );
}
