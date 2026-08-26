import { AlertTriangle, FileKey2, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import type { AuditReadModel } from "@/dashboard/contracts";

function shortHash(hash: string | null) {
  return hash === null ? "GENESIS" : `${hash.slice(0, 12)}…${hash.slice(-8)}`;
}

export function AuditTrailPage({ model }: { model: AuditReadModel }) {
  if (model.status === "INVALID")
    return (
      <div className="page-wrap operational-page">
        <header className="page-heading">
          <div>
            <div className="heading-kicker">
              <Badge tone="blocked">Verification failed</Badge>
            </div>
            <h1>Tamper-Evident Audit Trail</h1>
            <p>
              The chain is not presented as valid because verification failed
              closed.
            </p>
          </div>
        </header>
        <div className="unsafe-proof">
          <AlertTriangle aria-hidden="true" size={22} />
          <div>
            <p className="eyebrow">Invalid chain</p>
            <h2>{model.issue.replaceAll("_", " ")}</h2>
            <p>
              No audit entries are rendered as trusted evidence until the chain
              is repaired through an authorized operational process.
            </p>
          </div>
        </div>
      </div>
    );
  return (
    <div className="page-wrap operational-page">
      <header className="page-heading">
        <div>
          <div className="heading-kicker">
            <Badge tone="positive">Verified before display</Badge>
            <span>{model.chainVersion}</span>
          </div>
          <h1>Tamper-Evident Audit Trail</h1>
          <p>
            Hash-linked, privacy-safe evidence for material events and bounded
            decisions. Tamper-evident does not mean immutable.
          </p>
        </div>
        <div className="trust-summary">
          <ShieldCheck aria-hidden="true" size={20} />
          <div>
            <strong>Chain valid</strong>
            <span>
              {model.entryCount} entries · latest #{model.latestSequence}
            </span>
          </div>
        </div>
      </header>
      <div className="prototype-notice" role="note">
        <FileKey2 aria-hidden="true" size={18} />
        <p>
          The chain detects edits, deletion, reordering, and broken linkage
          against its local checkpoint. A compromised local database and
          checkpoint together are outside this prototype’s guarantee.
        </p>
      </div>
      <section className="audit-summary-grid" aria-label="Audit checkpoint">
        <div className="surface-card">
          <span>Status</span>
          <strong>VALID</strong>
        </div>
        <div className="surface-card">
          <span>Chain version</span>
          <strong>{model.chainVersion}</strong>
        </div>
        <div className="surface-card">
          <span>Entry count</span>
          <strong>{model.entryCount}</strong>
        </div>
        <div className="surface-card">
          <span>Head hash</span>
          <code title={model.headHash ?? "Empty chain"}>
            {shortHash(model.headHash)}
          </code>
        </div>
      </section>
      <section
        className="surface-card data-surface"
        aria-labelledby="audit-entries-heading"
      >
        <div className="card-header">
          <div>
            <p className="eyebrow">Verified sequence</p>
            <h2 id="audit-entries-heading">Material audit entries</h2>
          </div>
          <Badge tone="neutral">Read only</Badge>
        </div>
        {model.entries.length === 0 ? (
          <div className="empty-state">
            <FileKey2 aria-hidden="true" size={24} />
            <h3>Valid empty chain</h3>
            <p>Run a fixed case to append privacy-safe evidence.</p>
          </div>
        ) : (
          <DataTable>
            <caption>Verified tamper-evident audit entries</caption>
            <thead>
              <tr>
                <th scope="col">Seq / time</th>
                <th scope="col">Actor / reference</th>
                <th scope="col">Type / reason</th>
                <th scope="col">State</th>
                <th scope="col">Previous hash</th>
                <th scope="col">Current hash</th>
              </tr>
            </thead>
            <tbody>
              {model.entries.map((entry) => (
                <tr key={entry.sequence}>
                  <td>
                    <strong>#{entry.sequence}</strong>
                    <br />
                    <time>
                      {entry.timestamp
                        .replace("T", " ")
                        .replace(".000Z", " UTC")}
                    </time>
                  </td>
                  <td>
                    {entry.actor}
                    <br />
                    <code>{entry.inputReference}</code>
                  </td>
                  <td>
                    <strong>{entry.eventType.replaceAll("_", " ")}</strong>
                    <br />
                    <span>{entry.reason}</span>
                  </td>
                  <td>
                    {entry.previousState ?? "—"} → {entry.newState ?? "—"}
                  </td>
                  <td>
                    <details className="hash-detail">
                      <summary>{shortHash(entry.previousHash)}</summary>
                      <code>{entry.previousHash ?? "GENESIS"}</code>
                    </details>
                  </td>
                  <td>
                    <details className="hash-detail">
                      <summary>{shortHash(entry.currentHash)}</summary>
                      <code>{entry.currentHash}</code>
                    </details>
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
