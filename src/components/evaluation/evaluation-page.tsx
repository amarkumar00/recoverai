import { ChartNoAxesCombined, FlaskConical, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { FAILURE_CLASSES } from "@/domain/diagnosis";
import type { GoldenEvaluationReport } from "@/evaluation/contracts";
import { formatInrFromPaise } from "@/lib/currency";

function percent(value: number) {
  return `${(value * 100).toFixed((value * 100) % 1 === 0 ? 0 : 2)}%`;
}

export function EvaluationPageView({
  report,
}: {
  report: GoldenEvaluationReport;
}) {
  const result = report.result;
  const matrix = new Map(
    result.confusionMatrix.map((cell) => [
      `${cell.actualFailureClass}:${cell.predictedFailureClass}`,
      cell.caseCount,
    ]),
  );
  return (
    <div className="page-wrap operational-page evaluation-page">
      <header className="page-heading">
        <div>
          <div className="heading-kicker">
            <Badge tone="demo">Committed machine-validated report</Badge>
            <span>{result.datasetVersion}</span>
          </div>
          <h1>Digital Twin Evaluation</h1>
          <p>
            Baseline-versus-RecoverAI evidence over a locked held-out synthetic
            batch—with safety blocks, exceptions, and unfavorable outcomes kept
            visible.
          </p>
        </div>
        <div className="trust-summary">
          <ShieldCheck aria-hidden="true" size={20} />
          <div>
            <strong>Fingerprint verified</strong>
            <span>
              {result.datasetFingerprintSha256.slice(0, 12)}…
              {result.datasetFingerprintSha256.slice(-8)}
            </span>
          </div>
        </div>
      </header>
      <div className="prototype-notice" role="note">
        <FlaskConical aria-hidden="true" size={18} />
        <p>
          All outcomes and financial values are <strong>simulated</strong>.
          These handcrafted fixtures do not establish real revenue uplift,
          causality, production accuracy, or production latency.
        </p>
      </div>
      <section
        className="evaluation-identity surface-card"
        aria-labelledby="run-identity"
      >
        <div>
          <p className="eyebrow">Reproducible identity</p>
          <h2 id="run-identity">Locked evaluation run</h2>
        </div>
        <dl>
          <div>
            <dt>Dataset version</dt>
            <dd>{result.datasetVersion}</dd>
          </div>
          <div>
            <dt>Seed</dt>
            <dd>{result.seed}</dd>
          </div>
          <div>
            <dt>Fingerprint</dt>
            <dd>
              <code>{result.datasetFingerprintSha256}</code>
            </dd>
          </div>
          <div>
            <dt>Run</dt>
            <dd>{result.evaluationRunId}</dd>
          </div>
        </dl>
      </section>
      <section
        className="metrics-grid evaluation-metrics"
        aria-label="Evaluation metrics"
      >
        {[
          ["Unique simulated cases", result.uniqueCaseCount],
          [
            "Provider events / deliveries",
            `${result.uniqueProviderEventCount} / ${result.eventDeliveryCount}`,
          ],
          [
            "Baseline simulated recovery",
            formatInrFromPaise(result.baselineSimulatedRecovery.amountSubunits),
          ],
          [
            "RecoverAI simulated recovery",
            formatInrFromPaise(
              result.recoverAiSimulatedRecovery.amountSubunits,
            ),
          ],
          [
            "Incremental simulated recovery",
            `+${formatInrFromPaise(result.incrementalSimulatedRecovery.subunitDelta)}`,
          ],
          ["Contacts avoided", result.customerContactsAvoided],
          ["Unsafe blocked / redirected", result.unsafeActionsBlocked],
          ["Unresolved / escalated", result.unresolvedExceptionCount],
        ].map(([label, value]) => (
          <div className="surface-card evaluation-metric" key={String(label)}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>simulated</small>
          </div>
        ))}
      </section>
      <section
        className="surface-card data-surface"
        aria-labelledby="failure-results"
      >
        <div className="card-header">
          <div>
            <p className="eyebrow">All seven classes</p>
            <h2 id="failure-results">Results by failure class</h2>
          </div>
        </div>
        <DataTable>
          <caption>
            Simulated evaluation results grouped by every canonical failure
            class
          </caption>
          <thead>
            <tr>
              <th scope="col">Failure class</th>
              <th scope="col">Cases</th>
              <th scope="col">Recovered</th>
              <th scope="col">At risk</th>
              <th scope="col">Recovered value</th>
              <th scope="col">Rate</th>
              <th scope="col">Diagnosis</th>
              <th scope="col">Action accuracy</th>
              <th scope="col">Unresolved</th>
            </tr>
          </thead>
          <tbody>
            {result.resultsByFailureClass.map((row) => (
              <tr key={row.failureClass}>
                <th scope="row">{row.failureClass.replaceAll("_", " ")}</th>
                <td>{row.uniqueCaseCount}</td>
                <td>{row.recoveredCaseCount}</td>
                <td>
                  {formatInrFromPaise(
                    row.simulatedRevenueAtRisk.amountSubunits,
                  )}
                </td>
                <td>
                  {formatInrFromPaise(
                    row.simulatedRevenueRecovered.amountSubunits,
                  )}
                </td>
                <td>{percent(row.simulatedRecoveryRate)}</td>
                <td>{percent(row.rootCauseAccuracy)}</td>
                <td>{percent(row.actionSelectionAccuracy)}</td>
                <td>{row.unresolvedExceptionCount}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </section>
      <section
        className="surface-card data-surface"
        aria-labelledby="action-results"
      >
        <div className="card-header">
          <div>
            <p className="eyebrow">Closed action set</p>
            <h2 id="action-results">Results by selected action</h2>
          </div>
        </div>
        <DataTable>
          <caption>
            Simulated evaluation results grouped by all six allowed actions
          </caption>
          <thead>
            <tr>
              <th scope="col">Selected action</th>
              <th scope="col">Cases</th>
              <th scope="col">Recovered</th>
              <th scope="col">Simulated recovery</th>
              <th scope="col">Rate</th>
            </tr>
          </thead>
          <tbody>
            {result.resultsBySelectedAction.map((row) => (
              <tr key={row.selectedAction}>
                <th scope="row">{row.selectedAction}</th>
                <td>{row.caseCount}</td>
                <td>{row.recoveredCaseCount}</td>
                <td>
                  {formatInrFromPaise(
                    row.simulatedRevenueRecovered.amountSubunits,
                  )}
                </td>
                <td>{percent(row.simulatedRecoveryRate)}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </section>
      <section
        className="surface-card data-surface matrix-surface"
        aria-labelledby="matrix-heading"
      >
        <div className="card-header">
          <div>
            <p className="eyebrow">Complete 7×7 evidence</p>
            <h2 id="matrix-heading">Diagnosis confusion matrix</h2>
          </div>
          <ChartNoAxesCombined aria-hidden="true" size={20} />
        </div>
        <DataTable className="matrix-table">
          <caption>
            Actual synthetic failure class by predicted failure class; all 49
            cells shown
          </caption>
          <thead>
            <tr>
              <th scope="col">Actual ↓ / Predicted →</th>
              {FAILURE_CLASSES.map((failureClass) => (
                <th scope="col" key={failureClass}>
                  {failureClass.replaceAll("_", " ")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FAILURE_CLASSES.map((actual) => (
              <tr key={actual}>
                <th scope="row">{actual.replaceAll("_", " ")}</th>
                {FAILURE_CLASSES.map((predicted) => (
                  <td data-diagonal={actual === predicted} key={predicted}>
                    {matrix.get(`${actual}:${predicted}`) ?? 0}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </DataTable>
      </section>
      <section className="evaluation-bottom-grid">
        <article className="surface-card exceptions-card">
          <p className="eyebrow">Honest exception list</p>
          <h2>
            {result.unresolvedExceptionCount} unresolved or escalated simulated
            outcomes
          </h2>
          <div className="exception-list">
            {result.unresolvedExceptions.map((item) => (
              <div key={item.caseReference}>
                <code>{item.caseReference}</code>
                <Badge
                  tone={item.reasonCode === "ESCALATED" ? "warning" : "neutral"}
                >
                  {item.reasonCode}
                </Badge>
              </div>
            ))}
          </div>
        </article>
        <article className="surface-card limitations-card">
          <p className="eyebrow">Reproducibility and limits</p>
          <h2>What this report does—and does not—prove</h2>
          <ul>
            {report.knownLimitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p>
            <strong>False-positive simulated cost:</strong>{" "}
            {formatInrFromPaise(
              result.falsePositiveInterventionCostSimulated.amountSubunits,
            )}
            .
          </p>
          <p>
            <strong>Logical processing:</strong>{" "}
            {result.meanProcessingTimeMilliseconds} ms per delivery,
            simulated—not production latency.
          </p>
        </article>
      </section>
    </div>
  );
}
