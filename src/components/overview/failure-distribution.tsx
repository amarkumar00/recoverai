import type { CSSProperties } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { SimulatedEvaluationResult } from "@/domain/evaluation";

const tones = [
  "blue",
  "amber",
  "violet",
  "green",
  "red",
  "orange",
  "blue",
] as const;
export function FailureDistribution({
  result,
}: {
  result: SimulatedEvaluationResult;
}) {
  return (
    <Card>
      <CardHeader>
        <div>
          <p className="eyebrow">Digital Twin</p>
          <h2>Failure-class distribution</h2>
        </div>
        <span className="chart-context">Synthetic</span>
      </CardHeader>
      <CardContent>
        <div className="distribution-list">
          {result.resultsByFailureClass.map((item, index) => (
            <div className="distribution-row" key={item.failureClass}>
              <div className="distribution-label">
                <span>{item.failureClass.replaceAll("_", " ")}</span>
                <strong>{item.uniqueCaseCount}</strong>
              </div>
              <div className="distribution-track">
                <span
                  className="distribution-fill"
                  data-tone={tones[index]}
                  style={
                    {
                      "--distribution-size": `${item.uniqueCaseCount * 4}%`,
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
