# RecoverAI

RecoverAI is a credential-free prototype for **Track 03 — AI Revenue Recovery** in the Razorpay AI Buildathon 2026. It explores how failed-payment events can become explainable, bounded recovery actions while measuring incremental **simulated** recovery across synthetic cases.

> The current build contains a static product preview, durable local persistence, a deterministic recovery-case lifecycle, exact known-error diagnosis, a passive deterministic recommendation scorer, a side-effect-free policy firewall, and a tamper-evident audit hash chain. It does not process webhooks, call Razorpay, persist scoring or policy results automatically, mutate case state, contact customers, or create/cancel actual Payment Links. It is not production-ready. Every rupee result is simulated fixture data—not real merchant revenue.

## Requirements

- Node.js 22 or newer
- npm 10 or newer

No Razorpay or LLM credentials are needed for the default Demo Mode.

## Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The environment file is optional because safe defaults are built in:

- `APP_MODE=demo`
- `DATABASE_PATH=./data/recoverai.db`

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

The domain layer now also defines trusted payment-satisfaction context for deterministic lifecycle and diagnosis safety. The passive scorer, policy firewall, and audit hash chain are implemented, while webhook processing, payment fetching/reconciliation, policy persistence, recovery execution, and evaluation calculations remain deferred to their approved milestones.

## Canonical project documents

- Product source of truth: `docs/RECOVERAI_SPEC.md`
- Ordered milestones and status: `docs/ROADMAP.md`
- Accepted decisions: `docs/DECISIONS.md`
- Repository working rules: `AGENTS.md`

Development must follow the currently approved milestone and preserve the locked MVP scope and safety boundaries.
