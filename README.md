# RecoverAI

RecoverAI is a credential-free prototype for **Track 03 — AI Revenue Recovery** in the Razorpay AI Buildathon 2026. It explores how failed-payment events can become explainable, bounded recovery actions while measuring incremental **simulated** recovery across synthetic cases.

> The current build contains a static product preview, passive domain contracts, and a durable local persistence layer. It does not process webhooks, call Razorpay, run an AI scorer, execute policy rules, or create actual Payment Links. It is not production-ready. Every rupee result is simulated fixture data—not real merchant revenue.

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

The storage layer contains nine passive record families: webhook events, payment snapshots, recovery cases, AI recommendations, policy decisions, recovery actions, Payment Links, audit entries, and simulated evaluation runs. Repository interfaces live under `src/repositories/` and have no React, Next.js route, or UI dependency.

Database rows intentionally use SQLite-friendly representations:

- Money and counts are constrained integer columns in currency subunits.
- Booleans are stored as constrained SQLite integers.
- AI confidence is indexed as integer millionths while the validated domain model remains a `0..1` number.
- Strict domain documents are serialized as JSON only where preserving the complete validated structure is useful.
- Every serialized document is parsed and revalidated through the Milestone 2 Zod schema when read; corrupt data fails closed.

This milestone stores audit hashes supplied by the validated contract but does not calculate or verify a hash chain. The UI must continue to call this an append-only audit log until Milestone 7 implements and verifies tamper evidence.

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

The domain contracts remain passive. Persistence now stores and revalidates them, but state transitions, webhook processing, AI scoring, policy execution, audit hashing, and evaluation calculations remain deferred to their approved milestones.

## Canonical project documents

- Product source of truth: `docs/RECOVERAI_SPEC.md`
- Ordered milestones and status: `docs/ROADMAP.md`
- Accepted decisions: `docs/DECISIONS.md`
- Repository working rules: `AGENTS.md`

Development must follow the currently approved milestone and preserve the locked MVP scope and safety boundaries.
