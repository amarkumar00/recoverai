import { Construction, FlaskConical, LockKeyhole } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

export function ComingSoon({
  eyebrow,
  title,
  description,
  milestone,
}: {
  eyebrow: string;
  title: string;
  description: string;
  milestone: string;
}) {
  return (
    <div className="page-wrap placeholder-page">
      <header className="placeholder-header">
        <Badge tone="demo">Demo Mode · Synthetic Data</Badge>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </header>

      <Card className="placeholder-card">
        <div className="placeholder-icon">
          <Construction aria-hidden="true" size={28} />
        </div>
        <div>
          <span className="placeholder-label">Planned for {milestone}</span>
          <h2>This surface is intentionally unavailable.</h2>
          <p>
            Milestone 1 includes only the development foundation and static
            Overview. No later recovery workflow has been implemented.
          </p>
        </div>
        <div className="placeholder-guardrails">
          <span>
            <FlaskConical aria-hidden="true" size={16} /> Synthetic data only
          </span>
          <span>
            <LockKeyhole aria-hidden="true" size={16} /> No credentials required
          </span>
        </div>
      </Card>
    </div>
  );
}
