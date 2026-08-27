# Security Model and Limitations

RecoverAI is a local prototype for deterministic payment-recovery safety research. It is not production-ready and performs no real-money behavior. Every Demo Mode financial result is **simulated**.

## Safety model at a glance

| Risk                          | Implemented control                                                                                   | Remaining limitation                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Forged webhook                | HMAC-SHA256 over exact untouched body; timing-safe comparison; reject before parsing                  | No deployment WAF, rate limiting, or secret-rotation service                     |
| Duplicate delivery            | Durable unique `x-razorpay-event-id` claim; content-conflict detection; concurrent tests              | SQLite is local, not a multi-node event coordinator                              |
| Out-of-order snapshot         | Webhook remains historical evidence; current payment is fetched and success is monotonic              | Provider unavailability stops automation; no background repair worker            |
| Money manipulation            | Integer subunits; identity, amount, and currency equality; strict schemas                             | Correct upstream trusted data and merchant configuration are still prerequisites |
| Arbitrary AI action           | Closed six-action allowlist; passive schema-validated ranking only                                    | Default scorer is a handcrafted mock, not a trained/calibrated production model  |
| Unsafe recovery               | Deterministic rule precedence, contact/link/window/confidence limits, positive expected value         | Policies are prototype defaults, not merchant-approved production controls       |
| Repeated provider operation   | Stable identities, compare-and-set actions, one blocking link per order, no automatic uncertain retry | Provider, database, and audit cannot commit atomically                           |
| Late original-payment success | Re-fetch current state, stop outreach, cancel only eligible zero-paid created link                    | Unavailable link state requires human repair/review                              |
| Audit tampering               | Versioned canonical SHA-256 chain and local head anchor                                               | Tamper-evident, not immutable; full database+anchor rewrite is outside guarantee |
| Evaluation leakage            | Evaluator-only module, import restrictions, strict APIs, tests                                        | Structural isolation is not cryptographic secrecy                                |
| Data exposure                 | Privacy-minimized read models and metadata allowlists                                                 | No production data-classification or retention program                           |
| Mode confusion                | Demo default; complete Test key pair required; explicit write opt-in; Live keys rejected              | Operators still must protect local environment and Test Mode credentials         |

## Webhook boundary

The public route verifies the `X-Razorpay-Signature` HMAC against exact raw request bytes before JSON parsing, database access, runtime initialization, audit append, case creation, or processing. Missing, malformed, oversized, or invalid signatures fail closed with fixed responses. The body is capped at 256 KiB.

After signature verification, the route validates JSON through a permissive provider envelope and copies only relied-upon fields into strict internal schemas. The raw body, signature, secrets, customer contacts, stack traces, and database details are not stored in audit or returned.

The `x-razorpay-event-id` header is an atomic SQLite claim. Identical duplicate deliveries produce no repeated case, action, Payment Link, contact, simulated recovery, or material audit effect. Reusing an event ID with conflicting content is rejected.

Official source: [Validate and Test Webhooks](https://razorpay.com/docs/webhooks/validate-test/).

## Current-state and money authority

A signed webhook proves message authenticity; it does not prove the snapshot is current. Before recovery, the application uses the narrow provider port to fetch payment state and checks:

- payment and order identity;
- integer amount and three-letter currency;
- legal current state;
- monotonic authorization/capture authority;
- case state and optimistic version;
- existing Payment Link relationship and lifecycle.

Unavailable, malformed, mismatched, or conflicting state never becomes recovery authority. Paid or partially paid conditions stop or escalate rather than continuing collection.

## AI boundary

Known errors are diagnosed deterministically from exact structured evidence. The recommendation provider receives only non-executable candidate context and returns untrusted bounded estimates. It cannot supply:

- amount or currency;
- payment, order, case, or link identifiers;
- recipient or customer contact;
- API origin, route, or method;
- credential or idempotency key;
- policy rule or approval authority;
- evaluator-only hidden outcomes.

Trusted code validates the complete ranking, calculates expected value, and supplies the deterministic firewall. Invalid/malformed output, timeout, provider failure, unsafe arithmetic, and insufficient context yield one sanitized `ESCALATE_HUMAN` fallback with no provider retry or execution.

The default scorer is a deterministic handcrafted mock/test double. No external production LLM was used or verified.

## Deterministic policy and execution

The firewall permits exactly six actions and evaluates safety checks in fixed order. Core defaults are one active Payment Link per order, at most two customer contacts, a 24-hour inclusive recovery window, and minimum 0.70 recommendation confidence. Exact amount/currency agreement and positive expected value are required for proactive recovery.

Execution uses stable identities and database claims. Current payment and case state are rechecked immediately before a create. Link cancellation first fetches link state and proceeds only when it is still created with zero amount paid. No action port exists for arbitrary provider requests, original-payment retry, capture, refund, subscription, Route, customer messaging, or Vulcan.

## Provider uncertainty and non-atomic effects

The external provider, local SQLite database, and audit log do not share a distributed transaction. The application deliberately avoids holding a SQLite transaction across network I/O.

- A write timeout is outcome-uncertain and consumes the local attempt.
- Provider success followed by local persistence failure is recorded as incomplete where possible and is not repeated.
- A final audit append failure leaves observed local evidence where possible and reports `AUDIT_INCOMPLETE`.
- A first-seen webhook interrupted after the durable claim is not automatically reprocessed by a duplicate.

These states require explicit operator investigation and repair. This is safer than issuing an automatic second financial operation, but it is a reliability limitation.

## Tamper-evident audit boundary

Audit entries form a canonical SHA-256 predecessor chain and advance a local count/head anchor in one SQLite immediate transaction. Verification detects content edits, insertion, removal, reordering, broken sequence, predecessor mismatch, and local-tail truncation.

The chain is not immutable. An administrator who can rewrite all entries and the local anchor can build a different locally valid history. An independently retained checkpoint would strengthen detection, but external anchoring and write-once storage are not implemented.

Audit metadata accepts only bounded operational references. Raw webhook bodies, prompts, credentials, bearer tokens, stack traces, email addresses, phone numbers, and arbitrary metadata are rejected or excluded.

## Digital Twin and metric integrity

The scorer-visible held-out batch is separated from evaluator-only handcrafted ground truth and simulated outcomes. Action selection is fixed before the restricted evaluator reveals that action's outcome. Dataset and golden-report hashes detect drift.

- Dataset fingerprint: `2065d1d50588ac7b8e8cf0782e7ae647c59bc02fedc71b856ca7c6d49f96ecdb`
- Golden JSON SHA-256: `0405a6621ba88f362877907ba7dea1624643696b92907ef5f4b13cf9bf22f30c`

This is structural test isolation, not cryptographic secrecy. The handcrafted fixtures do not establish causality, real revenue, production accuracy, or production latency.

## Data minimization

Synthetic data uses fixed non-production identifiers and contains no real names, email addresses, phone numbers, addresses, card details, tokens, credentials, or merchant records. Dashboard DTOs exclude customer hashes, raw event bodies, audit hashes on case timelines, public Payment Link URLs, secrets, provider internals, prompts, and evaluator-only ground truth.

The optional Test Mode adapter does not include customer fields in link creation and disables notification/reminders. It never persists or exposes the provider `short_url` through general read models.

## Mode separation

- **Demo Mode:** credential-free default; deterministic mock provider behavior; all outcomes and money simulated; internal synthetic events are visibly `NOT_CHECKED` and do not masquerade as public webhooks.
- **Razorpay Test Mode:** optional server-only sandbox adapter; complete `rzp_test_` key pair required; writes need separate explicit opt-in; no real money.
- **Live Mode:** prohibited; `rzp_live_` keys are rejected and no Live Mode path is implemented.

Live Test Mode verification was `NOT_RUN_CREDENTIALS_UNAVAILABLE`, and zero live Payment Links were created during verification.

## Explicit limitations

- Synthetic outcomes do not prove production uplift, causality, accuracy, or latency.
- The default AI scorer is a deterministic mock, not a trained production model.
- The live Test Mode flow was not run.
- No deployment rate limiting, webhook-secret rotation, or production secrets manager exists.
- No multi-node webhook coordination, distributed lock, queue, or worker exists.
- No distributed transaction spans provider operation, persistence, and audit.
- No automatic repair/replay exists for uncertain external outcomes or interrupted first-seen processing.
- SQLite and its local audit anchor are for the local prototype, not multi-node production operation.
- No production authentication, authorization, tenant isolation, privacy program, or operator console exists.
- No real customer messaging or real-money behavior exists.
- No arbitrary failed-payment retry, automatic capture, refund, subscription, Route, QR/UPI-specific link, Vulcan, or checkout-abandonment integration exists.
- Test Mode writes have deterministic contract coverage but no credential-backed live verification evidence.

## Production work outside this MVP

A production evaluation would require merchant-approved historical data, privacy/security review, calibrated models, controlled A/B testing, production authentication/authorization, rate limiting, secret rotation, durable multi-node work ownership, idempotent repair tooling, external audit anchoring, monitoring/alerting, runbooks, provider-limit governance, and explicit customer-contact consent. None of these are claimed by this repository.
