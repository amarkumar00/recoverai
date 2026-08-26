# RecoverAI

RecoverAI is a credential-free prototype for **Track 03 — AI Revenue Recovery** in the Razorpay AI Buildathon 2026. It explores how failed-payment events can become explainable, bounded recovery actions while measuring incremental **simulated** recovery across synthetic cases.

> The current build connects those foundations into one persisted, credential-free vertical slice and a separate Razorpay-style public webhook boundary. The public boundary verifies HMAC-SHA256 against the exact raw request bytes, durably suppresses duplicate provider event IDs, and sends only the verified first delivery to current-state reconciliation. The default provider is still a deterministic mock; it does not call Razorpay, send a customer message, or move real money. It is not production-ready. Every rupee result is simulated fixture data—not real merchant revenue.

## Requirements

- Node.js 22 or newer
- npm 10 or newer

No Razorpay or LLM credentials are needed for the default Demo Mode.

## Local setup

```bash
npm install
cp .env.example .env.local
npm run db:migrate
npm run dev
```

Open [http://localhost:3000/cases](http://localhost:3000/cases).

The environment file is optional because safe defaults are built in:

- `APP_MODE=demo`
- `DATABASE_PATH=./data/recoverai.db`

`RAZORPAY_WEBHOOK_SECRET` is optional. Without it, the dashboard and internal
synthetic demo remain fully usable, while the public webhook endpoint returns a
safe `WEBHOOK_NOT_CONFIGURED` response without initializing ingestion.

## Razorpay-style webhook boundary

`POST /api/webhooks/razorpay` is the only public provider-event boundary. It
follows Razorpay's documented validation model:

- `X-Razorpay-Signature` is checked as an HMAC-SHA256 hex digest using the
  exact, untouched request bytes as the message and the server-only webhook
  secret as the key.
- Signature comparison is timing-safe after strict hex validation. Missing,
  malformed, or invalid signatures are rejected before JSON parsing, database
  persistence, downstream processing, or audit writes.
- `x-razorpay-event-id` is the durable idempotency boundary. The first valid
  delivery is persisted and audited once; an identical sequential or concurrent
  delivery returns success without another downstream effect. Reusing the ID
  with different raw content fails closed as a conflict.
- Only fields accepted by the external event schema are copied into strict
  internal domain contracts. Raw bodies, customer contact details, signatures,
  secrets, stack traces, and database details are never returned or copied into
  the audit log.
- Request bodies are capped at 256 KiB. Responses contain only a stable status
  and safe result code and are marked `no-store`.

The header names and raw-body algorithm come from Razorpay's official
[Validate and Test Webhooks](https://razorpay.com/docs/webhooks/validate-test/)
documentation. To enable the boundary locally, provide a non-public server
environment value:

```bash
RAZORPAY_WEBHOOK_SECRET=replace_with_test_webhook_secret
```

Do not commit that value. A verified first-seen original-payment event now
preserves its webhook snapshot as historical evidence and performs a fresh
lookup through the narrow provider capability port. The lookup result is
stored separately as provider-reconciled authority. A stale delivery can add
history but cannot reactivate recovery, increment contact count, or create a
Payment Link. The default public adapter intentionally has no provider
fixtures, so its lookup returns a deterministic unavailable result and starts
no recovery. Real Test Mode lookup remains deferred.

Prototype limitations remain explicit: the atomic event claim and the
tamper-evident audit append are two local operations, not one cross-component
transaction. A process failure between them requires operator repair rather
than automatic replay of downstream effects. The route also does not yet add
deployment rate limiting, webhook-secret rotation, multi-node database
coordination, automatic repair/replay after a first-seen downstream failure,
or live Razorpay Test Mode API calls.

## Local database and migrations

The application uses SQLite through `better-sqlite3` and Drizzle ORM. Database schema is never created implicitly during application startup. Apply the committed migrations explicitly:

```bash
npm run db:migrate
```

This uses `DATABASE_PATH` from the environment, defaulting to `./data/recoverai.db`. To prove a brand-new database can be built without deleting an existing one, select a fresh path:

```bash
DATABASE_PATH=./data/recoverai-clean.db npm run db:migrate
```

Verify that the committed migration remains consistent with the Drizzle table definitions and can be reapplied safely:

```bash
npm run db:check
```

Migration sources are committed under `drizzle/`; Drizzle table definitions live in `src/lib/db/schema.ts`, and `drizzle.config.ts` records the schema/output locations. Migration application uses Drizzle's programmatic migrator. Migration authoring is intentionally review-first: update the Drizzle schema and committed SQL together, update the journal, then run `npm run db:check`. This avoids an unaudited runtime schema-sync path.

Local database, WAL, and shared-memory files under `data/` are ignored by Git. Tests create isolated temporary file databases entirely from committed migrations and never use the developer database.

SQLite connections enforce foreign keys, use a five-second busy timeout, and enable WAL for file databases. These settings make competing idempotency claims safer while preserving credential-free local operation.

### Persistence boundaries

The storage layer contains nine record families plus one audit-chain head anchor: webhook events, payment snapshots, recovery cases, AI recommendations, policy decisions, recovery actions, Payment Links, audit entries, simulated evaluation runs, and `audit_chain_state`. Repository interfaces live under `src/repositories/` and have no React, Next.js route, or UI dependency.

Database rows intentionally use SQLite-friendly representations:

- Money and counts are constrained integer columns in currency subunits.
- Booleans are stored as constrained SQLite integers.
- AI confidence is indexed as integer millionths while the validated domain model remains a `0..1` number.
- Strict domain documents are serialized as JSON only where preserving the complete validated structure is useful.
- Every serialized document is parsed and revalidated through the Milestone 2 Zod schema when read; corrupt data fails closed.
- Payment snapshots carry an explicit `WEBHOOK_EVIDENCE` or
  `PROVIDER_RECONCILED` origin. A database uniqueness constraint permits one
  snapshot of each origin per source event, while provider-reconciled lookups
  alone supply current recovery authority.

## Tamper-evident audit chain

`src/audit/` owns a real SHA-256 hash chain identified by `RECOVERAI_GLOBAL_AUDIT` at version `RECOVERAI_AUDIT_V1`. Callers submit only a strict passive append command; they cannot supply a sequence, predecessor hash, or current hash. The service validates a privacy-safe metadata allowlist, assigns the next insertion sequence, hashes canonical UTF-8 JSON, inserts the entry, and advances the local head anchor in one SQLite immediate transaction.

The chain starts at sequence `1` with a null predecessor. Every later entry contains the prior digest. Verification revalidates stored schemas and metadata, recomputes every digest in sequence order, checks continuity and duplicate IDs, and compares the final entry with the stored count and head hash. An optional retained checkpoint can detect a database rewrite that no longer matches an earlier trusted head. Identical entry-ID replays are idempotent even after newer appends; content changes conflict, and a corrupt chain fails closed.

The public passive repository exposes ordered reads only. Audit writes go through `createSqliteAuditChain`, so ordinary application callers cannot append pre-hashed records. Raw SQL access remains internal to this storage implementation.

This is **tamper-evident**, not immutable storage. Editing, insertion, deletion, or reordering is detected while the local anchor remains trustworthy; deleting the final row is detected by the anchored count and head. An attacker able to rewrite every entry and the local anchor could construct a different locally valid chain. Retaining a checkpoint outside that database strengthens detection. Audit input intentionally excludes raw webhook payloads, prompts, stack traces, credentials, email addresses, phone numbers, and arbitrary metadata.

## Deterministic recovery lifecycle

The pure state machine in `src/recovery/state-machine.ts` owns transition legality; repositories remain storage-only. The active states are `DETECTED`, `VERIFYING`, `DIAGNOSED`, `AWAITING_POLICY`, `WAITING`, and `LINK_CREATED`. The MVP terminal states are `RECOVERED`, `STOPPED`, `ESCALATED`, and `ERROR_SAFE`.

The primary workflow is:

```text
DETECTED → VERIFYING → DIAGNOSED → AWAITING_POLICY
                                      ├─→ WAITING
                                      └─→ LINK_CREATED
```

Every active state has explicit safe exits to the applicable terminal states. `WAITING → VERIFYING` is the only intentional re-verification loop. No terminal state can reactivate recovery.

Same-state requests are explicit idempotent no-ops when their trusted payment context is safe. They do not increment the case version. A paid, unavailable, or conflicting context cannot use a no-op to conceal an unsafe active-recovery request.

Transitions require a trusted payment-satisfaction result. Verified authorization, capture, or order-paid evidence permits only a recovered/stopped path. Entering an active state requires a verified unpaid result, and marking a case recovered requires verified satisfaction. The persistence service performs one version-aware update and returns typed not-found, stale-version, lost-race, and domain-rejection outcomes without mutating rejected cases.

## Deterministic known-error diagnosis

The known-error mapper in `src/diagnosis/` uses this fixed precedence:

1. Verified authorization, capture, or order-paid state
2. Unavailable or conflicting trusted payment state
3. Compatible verified active downtime
4. Exact documented structured `error_reason` rules
5. Unavailable downtime context
6. Conservative ambiguity

Mappings use exact identifiers from Razorpay's [error structure](https://razorpay.com/docs/errors/) and [payment error list](https://razorpay.com/docs/errors/payments/list/). Free-form descriptions and fuzzy substring matching are never used. Unknown, conflicting, and unavailable input escalates instead of being guessed as recoverable.

Diagnosis returns only the seven canonical failure classes and deterministic candidate actions from the six-action allowlist. Candidate order exists only for reproducibility; it is not AI ranking or execution authority. Existing recovery-link context removes a second `SEND_PAYMENT_LINK` candidate. Diagnostic evidence uses fixed sanitized messages and never copies free-form descriptions or customer contact information.

## Bounded deterministic recommendation scorer

The provider-independent recommendation boundary lives in `src/ai/`. It receives validated payment context and deterministic diagnosis candidates, but the provider-visible input deliberately excludes authoritative amount, currency, customer hash, payment/order/link identifiers, API routes, idempotency keys, recipients, policy authority, and hidden Digital Twin outcomes. Provider output is treated as `unknown` until a strict schema accepts it.

The default `DeterministicMockAiProvider` is a credential-free seeded demo/test double with transparent handcrafted estimates. It is **not a trained production model** and its output is not evidence of real payment uplift. Its conservative base behaviour is:

- Temporary downtime usually gives `WAIT_FOR_RECOVERY` the highest estimate.
- Insufficient funds usually favours `REQUEST_METHOD_CHANGE` over a new link.
- Customer-correctable context generally favours a bounded link or method change.
- Network uncertainty keeps recovery estimates conservative.
- Late success and non-retryable diagnoses contain only their deterministic cancel/stop candidate; those non-recovery actions receive zero recovery probability.
- Ambiguous or unavailable context bypasses scoring and escalates safely.

Relevant base recovery-probability estimates, before bounded seed variation, are:

| Diagnosed class                 | Candidate base estimates                                 |
| ------------------------------- | -------------------------------------------------------- |
| Downtime/transient              | wait 78%, human escalation 8%                            |
| Insufficient funds              | method change 56%, bounded link 42%, human escalation 8% |
| Customer-correctable            | bounded link 64%, method change 57%, human escalation 8% |
| Network/integration uncertainty | wait 40%, human escalation 18%                           |
| Late success                    | cancel existing recovery 0% recovery probability         |
| Non-retryable                   | stop recovery 0% recovery probability                    |
| Ambiguous/unavailable           | provider bypass; human escalation fallback               |

Any seeded probability variation is reproducible and bounded to ±10,000 millionths. The same normalized input and seed produce the same logical provider output; the mock uses no current time, randomness source, network call, or environment credential.

Expected value is calculated only by trusted application code:

```text
floor(verified unpaid subunits × probability millionths / 1,000,000)
− contact cost
− friction penalty
− duplicate-payment-risk penalty
− operational cost
```

All monetary inputs and outputs are integer currency subunits. Multiplication and penalty aggregation use `bigint`; division rounds down to the nearest subunit, and results outside JavaScript's safe-integer range fail closed. Rankings use expected value descending, probability descending, total penalty ascending, then the canonical six-action order.

Timeout, malformed output, provider failure, insufficient context, invalid candidate sets, and unsafe arithmetic return a schema-valid `ESCALATE_HUMAN` recommendation with sanitized evidence. The boundary performs no retry, action execution, case transition, repository write, customer contact, or Razorpay call. The deterministic policy firewall remains the final passive decision authority: **AI proposes; deterministic financial policy disposes.**

## Deterministic policy firewall

The pure firewall in `src/policy/` validates a strict internal action intent against trusted case, payment-satisfaction, diagnosis, AI-scoring, Payment Link, contact, recovery-window, and policy-configuration context. Unknown or malformed raw actions return a typed `INVALID_INPUT` result without fabricating an allowlisted action. Valid inputs produce one strict decision:

- `APPROVED`: every rule passed and the final action exactly matches the proposed action.
- `BLOCKED`: the plan is inconsistent or malformed; no final action is authorized.
- `ESCALATED`: automation is stopped and the only final action is `ESCALATE_HUMAN`.
- `STOPPED`: proactive recovery ends with `CANCEL_RECOVERY_ALREADY_PAID` or `STOP_NON_RETRYABLE`.

Canonical defaults are:

```text
MAX_PAYMENT_LINKS_PER_ORDER = 1
MAX_CUSTOMER_CONTACTS = 2
MAX_RECOVERY_WINDOW_MILLISECONDS = 86,400,000 (24 hours)
MIN_AI_CONFIDENCE_MILLIONTHS = 700,000 (0.70)
```

The exact 24-hour boundary is inclusive: an evaluation at `start + 86,400,000 ms` remains eligible, while one millisecond later is expired. Confidence is conservatively converted to millionths with floor rounding; exactly `0.70` passes and any value below it fails. These trusted defaults never come from provider output.

Rule precedence is fixed: identity integrity → conflicting/partial payment state → verified success stopping → dependency availability → intent money integrity → Payment Link limits → contact limit → recovery window → AI boundary → expected value → diagnosis compatibility → approval. Earlier safety evidence overrides later AI ranking and economics. New-link amount/currency must exactly match verified unpaid money; one blocking link or the total-link limit prevents another link; partially paid or duplicate-payment states escalate; authorized/captured/order-paid state stops outreach and cancels only an eligible unpaid link. Non-positive expected value stops proactive recovery.

Every decision contains ordered `PASSED`, `FAILED`, or `NOT_APPLICABLE` checks and one exact primary rule. Evaluation uses injected timestamps and performs no persistence, case transition, audit write, network request, Razorpay call, Payment Link operation, customer contact, retry, random operation, or ambient clock read. Future orchestration will persist and execute permitted decisions.

## Idempotent mock recovery execution

The provider-independent capability port in `src/ports/razorpay.ts` exposes only the narrow operations needed by the locked MVP: fetch current payment state, inspect downtime, and create, fetch, or cancel a Payment Link. It exposes no original-payment retry, capture, refund, routing, subscription, messaging, or arbitrary request capability. The default `DeterministicMockRazorpayAdapter` uses only injected fixture state—no credentials, network, random source, or ambient clock—and returns defensive, strictly validated results.

`RecoveryActionExecutor` accepts a strict command containing the trusted case, deterministic policy decision, matching action intent, injected execution timestamp, and bounded timeout. AI output never reaches this boundary directly and cannot construct provider operations. Before creating a simulated Payment Link, the executor fetches the current payment and verifies payment ID, order ID, integer amount, currency, and unpaid status. Authorization or capture stops creation. Existing safe links are reused, while conflicting or partially paid links fail safe or require review.

The executor also re-reads the persisted case state and optimistic version
after the payment lookup and immediately before Payment Link creation. An
earlier policy decision cannot create a link after concurrent reconciliation
has moved the case to a terminal state.

Execution identities are stable SHA-256-derived references in the versioned `recoverai_exec_v1` namespace. Recovery actions use a compare-and-set lifecycle:

```text
REQUESTED → STARTED → SUCCEEDED | FAILED_SAFE | CANCELLED
```

Only the successful claim may begin an adapter operation. Replays return the persisted result, concurrent claims cannot create a second link, and uncertain timeouts are recorded without automatic retry. Mock cancellation first fetches the latest link state and never repeats cancellation for paid, partially paid, expired, or already-cancelled links.

Every material execution stage is appended to the tamper-evident audit chain with sanitized operational identifiers and fixed explanations. The initial audit append must succeed before any adapter call. SQLite transactions are never held across an awaited adapter operation; consequently the external mock operation, local persistence, and audit append are not one atomic transaction. If audit completion fails after an operation, the executor returns `AUDIT_INCOMPLETE`, preserves the observed local result where available, and does not automatically repeat the financial operation.

All Payment Links and financial outcomes produced by this adapter are **simulated**. The implementation makes no real Razorpay request, sends no customer message, and does not claim production readiness or recovered merchant revenue.

## Current-state reconciliation and late-success stopping

`src/reconciliation/` is UI-independent and depends only on repositories, the
narrow provider capability port, and the audit appender. For original-payment
events it fetches current payment state, then checks payment ID, order ID,
integer subunit amount, currency, and the applicable case/order relationship.
Unavailable, malformed, unknown, mismatched, or impossible regressing state
fails closed without activating recovery.

Provider-reconciled success is monotonic: once authorization or capture is
trusted, a later fetched unpaid state cannot downgrade it. Captured authority
cannot be downgraded to authorized. Webhook arrival order is retained only as
historical evidence. Reconciliation replays and concurrent attempts converge
through snapshot uniqueness, optimistic case versions, idempotent action
claims, and the one-blocking-link database constraint.

When the original payment is currently authorized/captured—or a uniquely
related `order.paid` event is corroborated by current payment success—the case
moves through the existing legal `STOPPED` path. An existing simulated recovery
link is fetched before cancellation. Only a fetched `CREATED` link is cancelled;
paid, partially paid, expired, or already-cancelled links are never cancelled.
Unavailable link state leaves the case stopped and records a safe-review
outcome. Replays and competing stop attempts do not repeat cancellation. The
reconciler never captures an authorized payment and never retries the original
payment.

## Credential-free vertical-slice demo

The Cases workspace runs two fixed synthetic scenarios from committed application code. It accepts no user-supplied payment amount, recipient, route, or arbitrary action.

Primary recovery flow:

1. Select **Start bounded recovery** for the primary case.
2. RecoverAI claims a **Trusted Synthetic Demo Event** with signature status `NOT_CHECKED`.
3. The persisted workflow reaches `LINK_CREATED` after exact diagnosis, deterministic seeded ranking, policy approval, and one idempotent mock Payment Link execution.
4. Inspect the case to see the simulated expected-value calculation, ordered policy checks, mock-link record, contact count, and verified tamper-evident timeline.
5. Select **Simulate mock link paid**. A fixed synthetic paid event moves the link to `PAID`, the case to terminal `RECOVERED`, and disables further recovery.

Safety proof:

1. Select **Run fixed 10× safety probe**.
2. The scenario proposes exactly ten times its verified simulated amount.
3. The deterministic firewall escalates at `INTENT_MONEY_INTEGRITY` before any executor, Payment Link, or contact action exists.

The POST controls under `/api/demo/recovery/` require a strict empty JSON object and are rejected when `APP_MODE` is not `demo`. They are internal demo controls, not merchant APIs or webhook endpoints. Repeated start, completion, and unsafe-probe requests resume from validated persisted state and do not duplicate the logical action, link, paid event, recommendation, policy decision, contact count, or final transition.

The credential-free demo still bypasses the external webhook trust boundary by design: its events are created inside the application as trusted synthetic fixtures and remain visibly labelled `NOT_CHECKED`. They never masquerade as events accepted through the signature-verified public route.

## Verification

Run each check independently:

```bash
npm run lint
npm run typecheck
npm test
npm run db:check
npm run build
```

Or run the complete local verification sequence:

```bash
npm run check
```

## Current product surface

- Responsive RecoverAI application shell
- Static Overview with synthetic metrics and recent activity
- Baseline vs RecoverAI **simulated** recovery comparison
- Synthetic failure-class distribution
- Clear Demo Mode, synthetic-data, and non-production indicators
- Credential-free deterministic mock Razorpay capability adapter
- Idempotent, policy-gated simulated Payment Link execution with audited safe failures
- Interactive Cases workspace with one complete persisted recovery flow
- Recovered terminal stopping and an exact 10× money-integrity safety proof
- Dashboard-safe read models with no customer hash, public link URL, secrets, raw payload, or audit hashes
- Separate raw-body-verified Razorpay-style webhook route with durable sequential and concurrent event deduplication
- Privacy-minimized first-seen webhook audit and current-state reconciliation effects with safe deterministic HTTP responses
- Separate webhook-evidence and provider-reconciled histories, monotonic success authority, and late-success stopping
- Restrained placeholders for later milestone routes
- Reusable card, badge, table, layout, color, and chart foundations

Static display fixtures live in `src/lib/fixtures/`. They are intentionally separate from future domain contracts and financial workflow logic.

## Domain-contract foundation

Framework-independent Zod contracts live in `src/domain/`. Runtime schemas are the source of truth and TypeScript types are inferred from them.

The domain layer currently defines:

- Exactly six recovery actions and ten case states
- Branded synthetic-compatible identifiers and canonical UTC timestamps
- Integer currency-subunit money contracts
- Strict normalized payment, event, diagnosis, AI, policy, audit, and simulated evaluation contracts
- A deliberately separate Razorpay-style external payload boundary
- Passive signature-verification and duplicate-processing result shapes

The domain layer now also defines trusted payment-satisfaction context for deterministic lifecycle and diagnosis safety. The passive scorer, policy firewall, audit hash chain, mock recovery executor, persisted orchestration, first vertical-slice UI, secure public webhook ingestion, and provider-independent current-state reconciliation are implemented. Held-out evaluation and the complete dashboard remain deferred to their approved milestones.

## Canonical project documents

- Product source of truth: `docs/RECOVERAI_SPEC.md`
- Ordered milestones and status: `docs/ROADMAP.md`
- Accepted decisions: `docs/DECISIONS.md`
- Repository working rules: `AGENTS.md`

Development must follow the currently approved milestone and preserve the locked MVP scope and safety boundaries.
