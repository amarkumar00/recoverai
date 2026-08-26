import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { SimulatedEvaluationResult } from "@/domain/evaluation";

export function RecentActivity({
  result,
}: {
  result: SimulatedEvaluationResult;
}) {
  return (
    <Card>
      <CardHeader>
        <div>
          <p className="eyebrow">Bounded workflow</p>
          <h2>Safety and intervention snapshot</h2>
        </div>
        <Link className="text-link" href="/cases">
          Open scenarios <ArrowUpRight aria-hidden="true" size={15} />
        </Link>
      </CardHeader>
      <CardContent className="activity-content">
        <div className="overview-proof-grid">
          <div>
            <strong>{result.duplicateChargeAttemptsPrevented}</strong>
            <span>duplicate-charge attempts prevented</span>
          </div>
          <div>
            <strong>{result.paymentLinkCreationCount}</strong>
            <span>
              new mock links vs {result.baselinePaymentLinkCreationCount}{" "}
              baseline
            </span>
          </div>
          <div>
            <strong>{result.apiFallbackOrFailureCount}</strong>
            <span>scorer/API safe fallbacks</span>
          </div>
          <div>
            <strong>{Math.round(result.humanEscalationRate * 100)}%</strong>
            <span>human escalation ({result.humanEscalationCount}/100)</span>
          </div>
        </div>
        <div className="activity-note">
          Synthetic evaluation evidence only. The default demo uses mock
          adapters, no credentials, no customer messages, and no real money.
        </div>
      </CardContent>
    </Card>
  );
}
