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
