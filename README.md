# RecoverAI

RecoverAI is a credential-free prototype for **Track 03 — AI Revenue Recovery** in the Razorpay AI Buildathon 2026. It explores how failed-payment events can become explainable, bounded recovery actions while measuring incremental **simulated** recovery across synthetic cases.

> The current build contains a static product preview and passive domain contracts only. It does not process webhooks, call Razorpay, run an AI scorer, execute policy rules, create Payment Links, or represent production readiness. Every rupee result is simulated fixture data—not real merchant revenue.

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

The SQLite-compatible client foundation exists, but no financial tables or migrations are created in this milestone.

## Verification

Run each check independently:

```bash
npm run lint
npm run typecheck
npm test
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

These are validation contracts only. State transitions, webhook processing, AI scoring, policy execution, audit hashing, persistence, and evaluation calculations remain deferred to their approved milestones.

## Canonical project documents

- Product source of truth: `docs/RECOVERAI_SPEC.md`
- Ordered milestones and status: `docs/ROADMAP.md`
- Accepted decisions: `docs/DECISIONS.md`
- Repository working rules: `AGENTS.md`

Development must follow the currently approved milestone and preserve the locked MVP scope and safety boundaries.
