# RecoverAI Golden Held-Out Evaluation

All results in this report are **SIMULATED**. They are deterministic synthetic Digital Twin outcomes, not real recovered revenue, production uplift, or production latency.

## Locked run identity

- Dataset: `recoverai-payment-failure-digital-twin-v1`
- Seed: `recoverai-held-out:2026-v1`
- Fingerprint: `2065d1d50588ac7b8e8cf0782e7ae647c59bc02fedc71b856ca7c6d49f96ecdb`
- Evaluation policy: `recoverai-evaluation-policy-v1`
- Baseline policy: `generic-payment-link-after-15-minutes-v1`
- Run ID: `eval_1126ebb9aa7b0e1b0f618b285019c444`
- Deterministic completion time: `2026-08-28T00:00:00.000Z`

The machine-valid artifact is [`golden-report.json`](./golden-report.json). It validates against `goldenEvaluationReportSchema`, whose nested result validates against `simulatedEvaluationResultSchema`.

## Canonical strategies

The baseline waits exactly 15 deterministic minutes, then selects the same generic `SEND_PAYMENT_LINK` action for every eligible verified-unpaid failure. It reuses an active link rather than creating a duplicate. Verified already-paid cases receive no link and no contact; `STOP_NON_RETRYABLE` represents that no-intervention outcome and does not claim a cancellation. Unavailable or conflicting state escalates safely.

RecoverAI recomputes deterministic diagnosis from scorer-visible input, uses the existing bounded mock scorer, then applies the existing policy firewall. The restricted evaluator reveals only each already-fixed selected action's hidden simulated outcome.

## Exact simulated results

| Metric                                               |              Deterministic result |
| ---------------------------------------------------- | --------------------------------: |
| Unique payment cases                                 |                               100 |
| Unique provider events                               |                               112 |
| Event deliveries                                     |                               125 |
| Duplicate deliveries ignored                         |                                13 |
| Simulated revenue initially at risk                  |           INR 11,883,796 subunits |
| Baseline simulated revenue recovered                 | INR 4,784,383 subunits (39 cases) |
| RecoverAI simulated revenue recovered                | INR 5,526,332 subunits (42 cases) |
| Incremental simulated revenue recovered              |         **INR +741,949 subunits** |
| RecoverAI simulated recovery rate                    |                      42/100 = 42% |
| Root-cause accuracy                                  |                    100/100 = 100% |
| Action-selection accuracy                            |                      95/100 = 95% |
| Unsafe actions blocked or safety-redirected          |                                19 |
| Duplicate-charge attempts prevented                  |                                10 |
| Baseline customer contacts                           |                                90 |
| RecoverAI customer contacts                          |                                21 |
| Unnecessary customer contacts avoided                |              max(0, 90 − 21) = 69 |
| Human escalations                                    |                      19/100 = 19% |
| Simulated false-positive intervention cost           |                INR 3,436 subunits |
| Baseline new Payment Links                           |                                86 |
| RecoverAI new Payment Links                          |                                10 |
| Scorer/API safe fallbacks or failures                |                                 5 |
| Simulated deterministic logical mean processing time |            35.696 ms per delivery |
| Honest unresolved or escalated simulated outcomes    |                                43 |

The primary metric uses checked integer-subunit arithmetic:

```text
INR 5,526,332 − INR 4,784,383 = INR +741,949 simulated subunits
```

Negative incremental values are schema-valid and are never clamped.

## Grouped results

| Revealed failure class             | Cases | Recovered | Simulated recovery subunits | Recovery rate | Diagnosis accuracy | Action accuracy | Unresolved |
| ---------------------------------- | ----: | --------: | --------------------------: | ------------: | -----------------: | --------------: | ---------: |
| DOWNTIME_OR_TRANSIENT              |    25 |        23 |                   3,124,029 |           92% |               100% |            100% |          2 |
| INSUFFICIENT_FUNDS                 |    20 |         8 |                   1,319,449 |           40% |               100% |            100% |         12 |
| CUSTOMER_CORRECTABLE               |    15 |         8 |                     934,206 |        53.33% |               100% |            100% |          7 |
| NETWORK_OR_INTEGRATION_UNCERTAINTY |    15 |         3 |                     148,648 |           20% |               100% |            100% |         12 |
| LATE_SUCCESS                       |    10 |         0 |                           0 |            0% |               100% |             50% |          5 |
| NON_RETRYABLE                      |    10 |         0 |                           0 |            0% |               100% |            100% |          0 |
| AMBIGUOUS                          |     5 |         0 |                           0 |            0% |               100% |            100% |          5 |

| RecoverAI final action       | Cases | Recovered | Simulated recovery subunits | Recovery rate |
| ---------------------------- | ----: | --------: | --------------------------: | ------------: |
| WAIT_FOR_RECOVERY            |    40 |        26 |                   3,272,677 |           65% |
| SEND_PAYMENT_LINK            |    10 |         8 |                     934,206 |           80% |
| REQUEST_METHOD_CHANGE        |    11 |         8 |                   1,319,449 |        72.73% |
| CANCEL_RECOVERY_ALREADY_PAID |     5 |         0 |                           0 |            0% |
| STOP_NON_RETRYABLE           |    15 |         0 |                           0 |            0% |
| ESCALATE_HUMAN               |    19 |         0 |                           0 |            0% |

The complete 7×7 confusion matrix, sanitized unresolved case references, and all strict aggregate fields are retained in the machine-valid JSON artifact.

## Metric inclusion rules

- Rates use 100 unique payments, never 125 deliveries, except mean logical processing time, whose denominator is all 125 deliveries.
- Recovery and simulated revenue use only the selected hidden simulated outcome and count each payment at most once per strategy.
- Root-cause accuracy compares recomputed diagnosis with evaluator-revealed class. Action accuracy checks whether the final selected action belongs to the revealed allowed-action set.
- Contacts avoided is the nonnegative baseline-relative difference. False-positive cost comes only from the final RecoverAI selected outcome.
- Unsafe blocks are actual policy blocks or redirects where final action differs from the scorer proposal. Duplicate-charge prevention is an actual `ORIGINAL_PAYMENT_SATISFIED` policy trace.
- Payment Link creation counts only approved `CREATE_NEW` intents. Reuse is not creation. Fallback count comes from actual scorer safe fallbacks or invalid policy results.
- Unresolved exceptions are selected outcomes explicitly marked `SIMULATED_UNRESOLVED` or `SIMULATED_ESCALATED`; they remain visible.
- Duplicate and out-of-order deliveries contribute operational counts only. Authoritative current-state fixtures govern action selection, so delivery order cannot regress payment truth or repeat revenue/contact/link effects.

## Reproduce and validate

```bash
npx vitest run src/evaluation
npm run test
npm run typecheck
```

The golden test regenerates the locked evaluation in memory, validates the committed JSON, and requires exact equality.

## Known limitations

- The oracle and outcomes are handcrafted synthetic fixtures, not production observations.
- The mock scorer is deterministic and transparent, not trained. Results do not establish causality or production uplift.
- Logical processing time is a reproducible simulated work model, not wall-clock performance or production latency.
- No credentials, network, live Razorpay Test Mode call, real customer message, or real financial action is used.
- Evaluator isolation is enforced structurally through module boundaries, lint rules, and tests; it is not cryptographic secrecy.
