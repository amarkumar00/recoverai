import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { overviewFixture } from "@/lib/fixtures/overview";

export function RecentActivity() {
  return (
    <Card>
      <CardHeader>
        <div>
          <p className="eyebrow">Bounded workflow preview</p>
          <h2>Recent recovery activity</h2>
        </div>
        <Link className="text-link" href="/cases">
          Cases preview <ArrowUpRight aria-hidden="true" size={15} />
        </Link>
      </CardHeader>
      <CardContent className="activity-content">
        <DataTable>
          <thead>
            <tr>
              <th scope="col">Case</th>
              <th scope="col">Event</th>
              <th scope="col">Evidence</th>
              <th scope="col">Outcome</th>
              <th scope="col">Time</th>
            </tr>
          </thead>
          <tbody>
            {overviewFixture.activities.map((activity) => (
              <tr key={activity.caseId}>
                <td className="case-id">{activity.caseId}</td>
                <td>{activity.event}</td>
                <td className="evidence-cell">{activity.evidence}</td>
                <td>
                  <Badge tone={activity.tone}>{activity.outcome}</Badge>
                </td>
                <td className="time-cell">{activity.time}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
        <div className="activity-note">
          Static synthetic fixture data. No webhook, AI, policy, or payment
          action executes in Milestone 1.
        </div>
      </CardContent>
    </Card>
  );
}
