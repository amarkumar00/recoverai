import { ArrowDownRight, ArrowUpRight, Ban, CircleGauge } from "lucide-react";

import { Card } from "@/components/ui/card";
import type { OverviewMetric } from "@/lib/fixtures/overview";

const iconMap = {
  neutral: CircleGauge,
  positive: ArrowUpRight,
  warning: ArrowDownRight,
  blocked: Ban,
} as const;

export function MetricCard({ metric }: { metric: OverviewMetric }) {
  const Icon = iconMap[metric.tone];

  return (
    <Card className="metric-card" data-tone={metric.tone}>
      <div className="metric-topline">
        <p>{metric.label}</p>
        <span className="metric-icon">
          <Icon aria-hidden="true" size={17} strokeWidth={2} />
        </span>
      </div>
      <strong className="metric-value">{metric.value}</strong>
      <span className="metric-detail">{metric.detail}</span>
    </Card>
  );
}
