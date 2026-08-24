# RecoverAI Architecture Decision Log

This log records approved project decisions without adding unapproved implementation detail.

## ADR-001 — Next.js and TypeScript application

- **Decision:** Build the application with Next.js and TypeScript.
- **Reason:** The approved roadmap calls for a typed full-stack web application and merchant dashboard with shared domain contracts.
- **Status:** ACCEPTED
- **Date:** 2026-08-24

## ADR-002 — Credential-free deterministic mock mode by default

- **Decision:** The default application mode must run without Razorpay or LLM credentials and use deterministic mock adapters.
- **Reason:** Local development, automated tests, judging, and the primary demo must remain repeatable and independent of external services.
- **Status:** ACCEPTED
- **Date:** 2026-08-24

## ADR-003 — Optional Razorpay Test Mode only after local stability

- **Decision:** Add Razorpay Test Mode integration only after the local end-to-end workflow is stable.
- **Reason:** External connectivity must not become a prerequisite or destabilize the mock-first MVP.
- **Status:** ACCEPTED
- **Date:** 2026-08-24

## ADR-004 — SQLite-compatible local persistence

- **Decision:** Use SQLite-compatible persistence for local development.
- **Reason:** The project needs durable state and migrations while remaining easy to run locally and in a credential-free demo.
- **Status:** ACCEPTED
- **Date:** 2026-08-24

## ADR-005 — Strict runtime schemas

- **Decision:** Validate all external payloads, AI output, and domain commands using strict runtime schemas.
- **Reason:** TypeScript types alone do not protect runtime financial boundaries or untrusted inputs.
- **Status:** ACCEPTED
- **Date:** 2026-08-24

## ADR-006 — Integer currency subunits

- **Decision:** Store and calculate monetary values as integer currency subunits.
- **Reason:** Integer subunits avoid floating-point ambiguity and align with Razorpay API amount conventions.
- **Status:** ACCEPTED
- **Date:** 2026-08-24

## ADR-007 — AI recommendation separated from deterministic execution

- **Decision:** AI may rank only allowlisted recovery actions; deterministic policies validate and execute them.
- **Reason:** Probabilistic output must never directly control arbitrary financial operations.
- **Status:** ACCEPTED
- **Date:** 2026-08-24

## ADR-008 — Seeded reproducible Digital Twin

- **Decision:** Build a seeded Digital Twin with reproducible synthetic cases and hidden simulated outcomes.
- **Reason:** Repeatability is required for honest baseline comparison, tests, and judging without private merchant data.
- **Status:** ACCEPTED
- **Date:** 2026-08-24

## ADR-009 — Synthetic results are always labelled simulated

- **Decision:** Every synthetic monetary result must explicitly use the word **simulated**.
- **Reason:** The prototype must not misrepresent offline evaluation as real recovered merchant revenue.
- **Status:** ACCEPTED
- **Date:** 2026-08-24

## ADR-010 — Narrow Track 03 MVP

- **Decision:** Preserve the locked Track 03 post-failure recovery scope and all specification exclusions.
- **Reason:** A bounded, measurable, Razorpay-native vertical slice is more defensible than a broad collection of unverified features.
- **Status:** ACCEPTED
- **Date:** 2026-08-24

## ADR-011 — Server-first reusable UI foundation

- **Decision:** Build the dashboard from small reusable card, badge, table, chart, and layout primitives, keeping components server-rendered except where current-route navigation state requires a client boundary.
- **Reason:** A server-first foundation keeps the credential-free preview lightweight while giving later dashboard milestones a consistent visual system.
- **Status:** ACCEPTED
- **Date:** 2026-08-24

## ADR-012 — Delay financial schema until Milestone 3

- **Decision:** Milestone 1 provides a tested SQLite-compatible client factory through Drizzle ORM and `better-sqlite3`, but creates no financial tables or migrations.
- **Reason:** Storage wiring must be runnable now without prematurely defining the domain schema that depends on validated Milestone 2 contracts.
- **Status:** ACCEPTED
- **Date:** 2026-08-24

## ADR-013 — Static preview fixtures are isolated from domain contracts

- **Decision:** Keep Milestone 1 display data in a dedicated fixture module and do not treat its UI types as authoritative financial domain types.
- **Reason:** The first product preview must be deterministic and credential-free without pre-empting the strict domain vocabulary planned for Milestone 2.
- **Status:** ACCEPTED
- **Date:** 2026-08-24

## ADR-014 — Runtime schemas are the domain source of truth

- **Decision:** Define domain contracts with Zod and infer TypeScript types from those schemas instead of maintaining parallel interfaces.
- **Reason:** Runtime validation and compile-time types must describe the same financial boundary without drift.
- **Status:** ACCEPTED
- **Date:** 2026-08-24

## ADR-015 — Provider payloads and internal models have different trust policies

- **Decision:** Razorpay-style external schemas validate every relied-upon field while intentionally preserving additional provider fields; normalized internal, AI, policy, audit, and evaluation schemas reject unknown fields.
- **Reason:** Providers can add legitimate payload fields, but arbitrary external data must never silently become trusted internal or executable data.
- **Status:** ACCEPTED
- **Date:** 2026-08-24

## ADR-016 — Canonical time and identity representation

- **Decision:** Internal timestamps use UTC ISO 8601 with millisecond precision, and internal identifiers use bounded branded strings without requiring production Razorpay prefixes.
- **Reason:** Consistent time values support deterministic replay, while branded synthetic-compatible IDs prevent accidental identifier mixing without blocking Demo Mode.
- **Status:** ACCEPTED
- **Date:** 2026-08-24

## ADR-017 — Signed deltas are separate from nonnegative money amounts

- **Decision:** Ordinary money amounts remain nonnegative integer subunits; evaluation differences use a separate signed integer-subunit delta contract.
- **Reason:** RecoverAI must preserve safe money semantics while honestly representing a simulated evaluation that performs worse than its baseline.
- **Status:** ACCEPTED
- **Date:** 2026-08-24

## ADR-018 — Audit metadata is allowlisted

- **Decision:** Audit metadata accepts only a small set of sanitized operational fields and rejects arbitrary keys.
- **Reason:** A generic metadata bag could casually collect secrets, raw provider payloads, customer contact details, or other PII.
- **Status:** ACCEPTED
- **Date:** 2026-08-24

## ADR-019 — Committed migrations are the only schema-creation path

- **Decision:** Create database tables through reviewed SQL migrations applied by Drizzle's programmatic migrator; application startup must not push or synthesize schema.
- **Reason:** A clean database must be reproducible and schema changes must remain reviewable, deterministic, and independent of the developer database.
- **Status:** ACCEPTED
- **Date:** 2026-08-25

## ADR-020 — Financial invariants are enforced at both repository and SQLite boundaries

- **Decision:** Use narrow Zod-validated repositories plus SQLite foreign keys, checks, unique constraints, and a partial unique index for idempotency and one-blocking-link-per-order rules.
- **Reason:** Application validation alone cannot safely arbitrate competing writes or prevent invalid direct persistence.
- **Status:** ACCEPTED
- **Date:** 2026-08-25

## ADR-021 — Structured persistence is validated on every read

- **Decision:** Store complete AI, policy, webhook, audit-metadata, and simulated-evaluation documents as serialized JSON only where justified, and parse them through the canonical domain schema on retrieval. Store query-critical fields separately as constrained columns; represent AI confidence as integer millionths and booleans as constrained SQLite integers.
- **Reason:** SQLite-friendly rows support indexing and constraints, while canonical JSON preserves strict domain structure. Revalidation prevents corrupt or manually altered JSON from becoming trusted internal data.
- **Status:** ACCEPTED
- **Date:** 2026-08-25

## ADR-022 — File databases use WAL and a bounded busy timeout

- **Decision:** Enable SQLite WAL journal mode for file databases and set a five-second busy timeout on every connection while preserving `foreign_keys = ON`.
- **Reason:** RecoverAI will need safe competing idempotency claims; WAL and a bounded wait reduce avoidable lock failures without hiding prolonged contention.
- **Status:** ACCEPTED
- **Date:** 2026-08-25

## ADR-023 — Audit persistence is append-only but not yet tamper-evident

- **Decision:** Expose only append and deterministic ordered-read operations for audit entries during Milestone 3. Persist validated hash fields without calculating or verifying a chain.
- **Reason:** Hash generation and tamper verification belong to Milestone 7, so current product wording must not overclaim tamper evidence.
- **Status:** ACCEPTED
- **Date:** 2026-08-25

## ADR-024 — Explicit transitions with safety-aware same-state no-ops

- **Decision:** Keep one explicit transition map in the pure recovery state machine. The six pre-terminal states are active; `RECOVERED`, `STOPPED`, `ESCALATED`, and `ERROR_SAFE` are terminal. A safe same-state request is an idempotent no-op and never increments the version, while incompatible payment context remains a rejection.
- **Reason:** Explicit edges prevent arbitrary backward movement, and safety-aware no-ops make retries deterministic without allowing a repeated request to conceal paid, unavailable, or conflicting context.
- **Status:** ACCEPTED
- **Date:** 2026-08-25

## ADR-025 — Trusted payment satisfaction gates lifecycle activation and recovery

- **Decision:** Represent payment satisfaction as a strict four-way context: verified satisfied, verified unpaid, unavailable, or conflicting. Authorization, capture, and order-paid are satisfaction bases. Active recovery requires verified unpaid context, and `RECOVERED` requires verified satisfaction.
- **Reason:** A normalized webhook snapshot alone cannot safely establish current payment or order state, especially after late authorization or out-of-order events.
- **Status:** ACCEPTED
- **Date:** 2026-08-25

## ADR-026 — Known-error diagnosis is exact and conservatively prioritized

- **Decision:** Diagnose known failures with an explicit priority order and exact documented `error_reason` matches. Never inspect free-form descriptions or use fuzzy matching. Verified success wins first; conflicting or unavailable payment context fails closed; compatible downtime precedes exact error mapping; remaining unknowns escalate.
- **Reason:** Deterministic exact matching is reproducible and explainable, while conservative ambiguity avoids unsupported recovery actions and accidental leakage of free-form customer information.
- **Status:** ACCEPTED
- **Date:** 2026-08-25

## ADR-027 — Provider output estimates probability but never controls money

- **Decision:** Give recommendation providers a strict non-executable context without amount, currency, customer hash, payment/order/link identifiers, routes, recipients, idempotency keys, policy authority, or hidden Digital Twin outcomes. Providers return untrusted probability estimates and bounded explanations only; trusted code validates the complete candidate set and constructs the canonical recommendation.
- **Reason:** A model can help rank deterministic diagnosis candidates without gaining control over financial facts or executable operations.
- **Status:** ACCEPTED
- **Date:** 2026-08-25

## ADR-028 — Expected value uses fixed-point millionths and checked integer arithmetic

- **Decision:** Represent recovery probability as integer millionths at the provider and scoring boundary. Calculate expected recovered subunits with `bigint`, divide by 1,000,000 with floor rounding, subtract trusted integer-subunit penalties, and reject results outside the JavaScript safe-integer range. Rank by expected value descending, probability descending, total penalty ascending, then canonical action order.
- **Reason:** Fixed-point probability and checked integer money arithmetic make scoring reproducible and prevent floating-point or overflow ambiguity. A documented total tie-break makes ordering stable.
- **Status:** ACCEPTED
- **Date:** 2026-08-25

## ADR-029 — Recommendation failures produce one canonical safe fallback

- **Decision:** A provider timeout, malformed output, provider error, insufficient context, invalid candidate set, or unsafe arithmetic returns a sanitized schema-valid `ESCALATE_HUMAN` recommendation. Timeout aborts the wait, performs no retry, and never reuses partially validated output. A diagnosis containing only human escalation bypasses the provider.
- **Reason:** Recommendation availability must never be converted into financial execution authority, leaked raw errors, or repeated side effects. One typed fail-closed path is easier to test and audit.
- **Status:** ACCEPTED
- **Date:** 2026-08-25

## ADR-030 — Policy evaluation uses one fixed safety-first precedence

- **Decision:** Evaluate policy in this order: identity integrity, payment-state conflicts, verified-success stopping, dependency availability, intent money integrity, Payment Link limits, contact limits, recovery window, AI boundary, expected value, diagnosis compatibility, then approval. Emit every check in that deterministic order and identify one exact primary rule.
- **Reason:** Paid, partial-paid, conflicting, or missing trusted state must override model ranking and economics. A total order makes decisions reproducible, audit-ready, and explainable without side effects.
- **Status:** ACCEPTED
- **Date:** 2026-08-25

## ADR-031 — Recovery window is inclusive and confidence conversion is conservative

- **Decision:** Store the default 24-hour policy window as 86,400,000 milliseconds. Proactive recovery remains eligible exactly at the effective end timestamp and expires one millisecond later. Convert canonical AI confidence to integer millionths with floor rounding; 700,000 passes and anything below it fails.
- **Reason:** Explicit units and boundary semantics remove time ambiguity. Conservative fixed-point conversion prevents a value slightly below the threshold from rounding up into approval.
- **Status:** ACCEPTED
- **Date:** 2026-08-25

## ADR-032 — Firewall outcomes carry execution-safe semantics

- **Decision:** `APPROVED` preserves the proposed action, `BLOCKED` has no final action, `ESCALATED` finalizes only to `ESCALATE_HUMAN`, and `STOPPED` finalizes only to cancellation-after-success or non-retryable stop. Malformed raw input returns a separate typed invalid-input result without fabricating an action. Non-positive expected value stops proactive recovery.
- **Reason:** Outcome-specific invariants prevent downstream orchestration from mistaking a rejection or escalation for executable authority while retaining exact audit-ready explanations.
- **Status:** ACCEPTED
- **Date:** 2026-08-25

## ADR-033 — Audit hashes use one versioned canonical preimage

- **Decision:** Hash `RECOVERAI_AUDIT_V1` entries with SHA-256 over canonical UTF-8 JSON containing the global chain identity, version, insertion sequence, entry ID, timestamp, actor, operational input reference, event type, safe reason, state transition, predecessor hash, and strictly allowlisted metadata. Recursively sort object keys, preserve array order, normalize negative zero, and reject undefined, sparse, non-finite, bigint, and non-plain values. Exclude the current hash from its own preimage.
- **Reason:** A fully specified preimage makes identical input reproducible across calls and ensures every material stored field is integrity-bound without relying on object insertion order, locale, or ambient time.
- **Status:** ACCEPTED
- **Date:** 2026-08-25

## ADR-034 — Audit append owns sequence and hashes inside one immediate transaction

- **Decision:** Accept only a passive validated append command. Verify the existing chain, assign `count + 1`, calculate the predecessor and current hash internally, insert the entry, and atomically advance the chain head in one SQLite immediate transaction. Identical entry-ID replay returns the stored entry without changing the head; changed content conflicts; detected corruption blocks append. The ordinary repository exposes audit reads but no pre-hashed append method.
- **Reason:** Caller-supplied chain fields and split entry/head writes would allow malformed chains, races, or partially committed integrity state. Transactional ownership makes appends deterministic and fail closed.
- **Status:** ACCEPTED
- **Date:** 2026-08-25

## ADR-035 — Local head anchoring detects truncation but is not immutability

- **Decision:** Persist one global chain-state row containing identity, version, entry count, last sequence, and head hash. Verify every entry plus the anchor, and optionally compare an externally retained checkpoint. Describe the result as tamper-evident, never immutable.
- **Reason:** Linking entries alone cannot detect deletion of the final row. The anchored head detects local truncation, while an independently retained checkpoint also helps detect wholesale entry-and-anchor replacement. A database administrator able to rewrite both remains outside the local guarantee.
- **Status:** ACCEPTED
- **Date:** 2026-08-25

## ADR-036 — Audit storage accepts only privacy-minimized operational evidence

- **Decision:** Allow only enumerated operational metadata and bounded identifiers/reasons. Reject arbitrary keys plus email, phone, Razorpay credential, bearer token, secret-label, raw-payload, prompt, and stack-trace patterns before append; revalidate stored metadata and complete stored entry content during verification and reads.
- **Reason:** Integrity hashing must not turn secrets, PII, raw provider payloads, or model internals into durable copied data. Audit evidence should explain decisions using safe references and codes.
- **Status:** ACCEPTED
- **Date:** 2026-08-25

## ADR-037 — Recovery execution depends on a narrow capability port

- **Decision:** Expose only current-payment fetch, downtime inspection, and Payment Link create, fetch, and cancel operations through the provider-independent recovery port. Keep the default adapter credential-free, deterministic, in-memory, strictly validated, and observable through sanitized test controls and a call log. Do not expose original-payment retry, capture, refund, routing, subscription, messaging, or arbitrary request capabilities.
- **Reason:** A small capability surface makes the locked MVP testable without credentials and prevents AI or orchestration code from acquiring undocumented or unnecessary financial authority.
- **Status:** ACCEPTED
- **Date:** 2026-08-25

## ADR-038 — Stable execution identities and compare-and-set action ownership

- **Decision:** Derive action IDs, idempotency keys, Payment Link references, local link IDs, and audit entry IDs from a versioned canonical SHA-256 execution identity. Claim recovery actions idempotently and advance them only through compare-and-set `REQUESTED → STARTED → SUCCEEDED | FAILED_SAFE | CANCELLED` transitions. Return stored results or in-progress status to competing replays instead of repeating an adapter operation.
- **Reason:** Stable identities plus database-enforced ownership provide reproducible replay behavior and ensure that only one execution attempt can create or cancel a simulated Payment Link.
- **Status:** ACCEPTED
- **Date:** 2026-08-25

## ADR-039 — External outcomes, persistence, and audit are explicitly non-atomic

- **Decision:** Never hold a SQLite transaction across an awaited adapter call. Require the initial audit append before adapter use, audit material preconditions and outcomes, and return `AUDIT_INCOMPLETE` when post-call evidence cannot be completed. Preserve an observed external result where possible and never automatically retry an uncertain create or cancel outcome.
- **Reason:** SQLite and an external provider cannot share one transaction. Making this boundary explicit prevents long-held locks, duplicate financial side effects, and false claims that a completed provider operation is fully audited when local evidence is incomplete.
- **Status:** ACCEPTED
- **Date:** 2026-08-25
