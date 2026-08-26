"use client";

import { Activity, RefreshCw, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import type { EventStreamReadModel } from "@/dashboard/contracts";

function tone(status: EventStreamReadModel["rows"][number]["deliveryStatus"]) {
  if (status === "DUPLICATE_IGNORED" || status === "STALE_IGNORED")
    return "neutral" as const;
  if (status === "OUT_OF_ORDER") return "warning" as const;
  return "positive" as const;
}

export function EventStream({
  initialModel,
}: {
  initialModel: EventStreamReadModel;
}) {
  const [filter, setFilter] = useState("ALL");
  const router = useRouter();
  const rows = useMemo(
    () =>
      initialModel.rows.filter(
        (row) => filter === "ALL" || row.deliveryStatus === filter,
      ),
    [filter, initialModel.rows],
  );
  return (
    <div className="page-wrap operational-page">
      <header className="page-heading">
        <div>
          <div className="heading-kicker">
            <Badge tone="demo">Deterministic refreshed view</Badge>
            <span>{initialModel.generatedFrom.replaceAll("_", " ")}</span>
          </div>
          <h1>Live Event Stream</h1>
          <p>
            Privacy-safe webhook and demo delivery evidence, with snapshot truth
            kept separate from authoritative fetched payment state.
          </p>
        </div>
        <div className="trust-summary">
          <ShieldCheck aria-hidden="true" size={20} />
          <div>
            <strong>Raw payloads stay hidden</strong>
            <span>References only · no secrets · no customer data</span>
          </div>
        </div>
      </header>
      <div className="prototype-notice" role="note">
        <Activity aria-hidden="true" size={18} />
        <p>
          Trusted synthetic demo events show <strong>NOT_CHECKED</strong>.
          Public Razorpay-style events show <strong>VERIFIED</strong> only after
          raw-body HMAC verification.
        </p>
      </div>
      <section
        className="surface-card data-surface"
        aria-labelledby="event-table-heading"
      >
        <div className="surface-toolbar">
          <div>
            <p className="eyebrow">Persisted deliveries</p>
            <h2 id="event-table-heading">Delivery and decision trace</h2>
          </div>
          <div className="filter-actions">
            <label htmlFor="delivery-filter">Delivery status</label>
            <select
              id="delivery-filter"
              onChange={(event) => setFilter(event.target.value)}
              value={filter}
            >
              <option value="ALL">All statuses</option>
              <option value="ORIGINAL">Original</option>
              <option value="DUPLICATE_IGNORED">Duplicate ignored</option>
              <option value="OUT_OF_ORDER">Out of order</option>
              <option value="STALE_IGNORED">Stale ignored</option>
            </select>
            <button
              aria-label="Refresh event stream"
              className="icon-button"
              onClick={() => router.refresh()}
              type="button"
            >
              <RefreshCw aria-hidden="true" size={16} />
            </button>
          </div>
        </div>
        {rows.length === 0 ? (
          <div className="empty-state">
            <Activity aria-hidden="true" size={24} />
            <h3>No matching deliveries</h3>
            <p>Run a fixed scenario from Cases or choose another filter.</p>
          </div>
        ) : (
          <DataTable>
            <caption>Privacy-safe persisted payment event deliveries</caption>
            <thead>
              <tr>
                <th scope="col">Delivery</th>
                <th scope="col">Event / reference</th>
                <th scope="col">Signature</th>
                <th scope="col">Delivery status</th>
                <th scope="col">Snapshot → current</th>
                <th scope="col">Diagnosis</th>
                <th scope="col">Proposed → final</th>
                <th scope="col">Policy / case</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.safeReference}:${row.delivery}`}>
                  <td>
                    #{row.delivery}
                    <br />
                    <time>{row.deliveredAt.slice(11, 19)} UTC</time>
                  </td>
                  <td>
                    <strong>{row.eventType}</strong>
                    <code>{row.safeReference}</code>
                  </td>
                  <td>
                    <Badge
                      tone={
                        row.signatureStatus === "VERIFIED" ? "positive" : "demo"
                      }
                    >
                      {row.signatureStatus}
                    </Badge>
                  </td>
                  <td>
                    <Badge tone={tone(row.deliveryStatus)}>
                      {row.deliveryStatus.replaceAll("_", " ")}
                    </Badge>
                  </td>
                  <td>
                    <span>{row.webhookSnapshotState ?? "—"}</span>
                    <span aria-hidden="true"> → </span>
                    <strong>{row.authoritativeCurrentState ?? "—"}</strong>
                  </td>
                  <td>{row.diagnosis?.replaceAll("_", " ") ?? "—"}</td>
                  <td>
                    {row.proposedAction?.replaceAll("_", " ") ?? "—"}
                    <br />
                    <strong>
                      {row.finalAction?.replaceAll("_", " ") ?? "—"}
                    </strong>
                  </td>
                  <td>
                    {row.policyOutcome ?? "—"}
                    <br />
                    <code>{row.caseReference ?? "no case"}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </section>
    </div>
  );
}
