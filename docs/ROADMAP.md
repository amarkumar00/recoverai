# RecoverAI Implementation Roadmap

## Progress

- **Current milestone:** None — awaiting approval to begin Milestone 7
- **Last completed milestone:** Milestone 6 — Deterministic Policy Firewall and Stopping Rules
- **Next proposed milestone:** Milestone 7 — Tamper-Evident Audit Hash Chain
- **Known blockers:** None
- **Important decisions:** Track 03 RecoverAI scope is locked; mock mode is credential-free and deterministic; Razorpay Test Mode is optional until local stability; every synthetic financial result must be labelled simulated.

Allowed status values: `NOT_STARTED`, `IN_PROGRESS`, `COMPLETED`, `BLOCKED`.

Roadmap status must change only after implementation and verification genuinely change.

---

## Milestone 0 — Persistent Project Context and Working Rules

- **Status:** `COMPLETED`
- **Outcome:** Durable repository instructions, canonical product specification, approved roadmap, and architecture decision log for future sessions.
- **Dependencies:** None.
- **Acceptance criteria:**
  - `AGENTS.md`, `docs/RECOVERAI_SPEC.md`, `docs/ROADMAP.md`, and `docs/DECISIONS.md` exist.
  - `AGENTS.md` points to the correct canonical documents.
  - The roadmap contains all 18 approved implementation milestones.
  - The specification preserves all six allowed actions, excluded features, safety boundaries, and simulated-result wording.
  - No application has been scaffolded or implemented.
- **Verification method:** File-existence, content, milestone-count, allowed-action, exclusion, and contradiction checks. Mark completed only after all checks pass.

---

## Milestone 1 — Development Foundation and First Product Preview

- **Status:** `COMPLETED`
- **Outcome:** A clean, runnable Next.js and TypeScript application with a small static RecoverAI dashboard preview using representative fixture data.
- **Dependencies:** Milestone 0.
- **Acceptance criteria:**
  - Application starts locally and its production build succeeds.
  - Test runner and type-checking work.
  - Dashboard is recognizably RecoverAI, not an untouched starter.
  - All example financial results are labelled simulated.
  - No external credentials or business logic are required.
- **Verification method:** Install, type-check, build, baseline test, successful local response, and first meaningful browser preview.

## Milestone 2 — Core Domain Types and Validated Schemas

- **Status:** `COMPLETED`
- **Outcome:** One authoritative domain vocabulary shared by backend, tests, and UI.
- **Dependencies:** Milestone 1.
- **Acceptance criteria:**
  - Only the six allowed actions validate.
  - Unknown actions and invalid states fail validation.
  - Money uses integer currency subunits.
  - Payment events, AI recommendations, policy decisions, audit entries, and evaluation results have strict runtime schemas.
  - External payload types remain separate from internal domain types.
- **Verification method:** Schema unit tests and TypeScript type-checking.

## Milestone 3 — Database Design, Migrations and Repositories

- **Status:** `COMPLETED`
- **Outcome:** SQLite-compatible durable storage with migrations, repositories, and financial safety constraints.
- **Dependencies:** Milestones 1–2.
- **Acceptance criteria:**
  - A clean database is created entirely from migrations.
  - Schema covers webhook events, payment snapshots, recovery cases, AI recommendations, policy decisions, recovery actions, Payment Links, audit entries, and evaluation runs.
  - Duplicate event IDs are rejected.
  - An order cannot have multiple active recovery links.
  - Monetary fields remain integers and repository code is UI-independent.
- **Verification method:** Clean migration plus repository integration tests.

## Milestone 4 — Recovery-Case State Machine and Known-Error Diagnosis

- **Status:** `COMPLETED`
- **Outcome:** Deterministic lifecycle handling and known Razorpay-style error classification.
- **Dependencies:** Milestones 2–3.
- **Acceptance criteria:**
  - Illegal state transitions are blocked.
  - Captured or paid cases cannot return to active recovery.
  - Known structured failures are diagnosed without AI.
  - Unknown failures remain unknown rather than guessed.
  - Every diagnosis includes a reason and evidence.
- **Verification method:** State-transition table tests and parameterized diagnosis tests.

## Milestone 5 — Strict AI Interface and Deterministic Mock Scorer

- **Status:** `COMPLETED`
- **Outcome:** A provider-independent AI boundary with a credential-free, repeatable mock scorer.
- **Dependencies:** Milestones 2 and 4.
- **Acceptance criteria:**
  - Same seed and context produce the same recommendation.
  - AI ranks only allowlisted actions.
  - AI cannot provide executable API routes, recipients, currencies, or arbitrary amounts.
  - Invalid, malformed, or timed-out output fails closed.
  - No LLM credential is needed.
- **Verification method:** Determinism, schema-validation, malformed-output, and timeout tests.

## Milestone 6 — Deterministic Policy Firewall and Stopping Rules

- **Status:** `COMPLETED`
- **Outcome:** No AI proposal becomes an action without passing deterministic financial safety rules.
- **Dependencies:** Milestones 2, 4, and 5.
- **Acceptance criteria:**
  - All specification invariants have automated tests.
  - Unknown action, amount/currency mismatch, low confidence, exceeded limits, and already-paid cases are blocked or escalated correctly.
  - Default limits match the specification.
  - Each policy decision identifies the exact rule and reason.
- **Verification method:** Decision-table and adversarial unit tests.

## Milestone 7 — Tamper-Evident Audit Hash Chain

- **Status:** `NOT_STARTED`
- **Outcome:** Material events and decisions are traceable and tampering can be detected.
- **Dependencies:** Milestones 2–3.
- **Acceptance criteria:**
  - Valid chains verify.
  - Editing, removing, or reordering an entry breaks verification.
  - Canonical identical input produces identical hashes.
  - Secrets and unnecessary PII are excluded.
  - The product says tamper-evident only when hash chaining is active.
- **Verification method:** Hash-chain unit and tampering tests.

## Milestone 8 — Mock Razorpay Adapter and Idempotent Recovery Execution

- **Status:** `NOT_STARTED`
- **Outcome:** Domain logic can fetch payments, inspect downtime, create/cancel mock Payment Links, and simulate success without external credentials.
- **Dependencies:** Milestones 3, 6, and 7.
- **Acceptance criteria:**
  - Repeated execution returns the existing recovery link.
  - No arbitrary original-payment retry exists.
  - Paid or partially paid links are not repeatedly cancelled.
  - Timeout and failure behavior is deterministic and safe.
  - Adapter calls and results are auditable.
- **Verification method:** Adapter-contract, idempotency, failure-injection, and concurrency tests.

## Milestone 9 — First End-to-End Vertical Slice

- **Status:** `NOT_STARTED`
- **Outcome:** One synthetic failed payment completes the entire mock recovery workflow and appears in the dashboard.
- **Dependencies:** Milestones 1–8.
- **Acceptance criteria:**
  - A synthetic event becomes a case, diagnosis, mock AI ranking, policy decision, mock Payment Link, paid event, recovered state, stopped recovery, and valid audit chain.
  - Unsafe recommendation is visibly blocked.
  - Default flow works without credentials.
  - UI and stored state agree.
- **Verification method:** End-to-end integration test and browser walkthrough.

## Milestone 10 — Razorpay-Style Webhook Security and Event Deduplication

- **Status:** `NOT_STARTED`
- **Outcome:** Secure ingestion of Razorpay-style webhook requests.
- **Dependencies:** Milestones 2–3 and 9.
- **Acceptance criteria:**
  - Valid raw-body HMAC-SHA256 signatures are accepted.
  - Invalid signatures are rejected before event processing.
  - Parsed or re-serialized bodies cannot substitute for raw-body verification.
  - Repeated or concurrent duplicate event IDs perform no repeated action.
  - Safe HTTP responses are returned.
- **Verification method:** Signed fixtures and concurrent deduplication integration tests.

## Milestone 11 — Out-of-Order Handling and Payment-State Reconciliation

- **Status:** `NOT_STARTED`
- **Outcome:** Stale webhook snapshots cannot cause stale or duplicate recovery actions.
- **Dependencies:** Milestones 8–10.
- **Acceptance criteria:**
  - Unexpected authorized/captured ordering resolves correctly.
  - A failed event followed by captured stops recovery.
  - Current payment state is rechecked immediately before action.
  - Race conditions between diagnosis and execution are caught.
  - Eligible unpaid recovery links are cancelled after late success.
- **Verification method:** Reordered-event, current-state, and race-condition integration tests.

## Milestone 12 — Seeded Synthetic Dataset and Held-Out Digital Twin

- **Status:** `NOT_STARTED`
- **Outcome:** Reproducible development data and a locked 100-case evaluation batch with hidden simulated outcomes.
- **Dependencies:** Milestones 2, 4–6, and 11.
- **Acceptance criteria:**
  - Held-out set contains exactly 100 unique payments in the specification's category distribution.
  - It produces approximately 125 deliveries with duplicate and out-of-order overlays.
  - Duplicate deliveries do not increase unique-case count.
  - Same seed reproduces logically identical data.
  - Evaluation outcomes are unavailable to the scorer.
  - No real PII is present.
- **Verification method:** Generator snapshots, distribution assertions, reproducibility tests, and leakage checks.

## Milestone 13 — Baseline, RecoverAI Evaluation and Metrics

- **Status:** `NOT_STARTED`
- **Outcome:** Honest comparison of the documented generic recovery baseline against RecoverAI.
- **Dependencies:** Milestones 9 and 12.
- **Acceptance criteria:**
  - Baseline is a generic link after 15 minutes unless already paid.
  - Results always say simulated.
  - Incremental simulated revenue uses the canonical formula.
  - False-positive cost, contacts avoided, safety blocks, and unresolved exceptions are reported.
  - Seeded runs are repeatable.
  - No ₹0 straw-man baseline is used.
- **Verification method:** Golden evaluation report and formula/metric tests.

## Milestone 14 — Complete Merchant Dashboard and Interactive Demo Scenarios

- **Status:** `NOT_STARTED`
- **Outcome:** All required product surfaces and judge-facing scenarios are usable.
- **Dependencies:** Milestones 9–13.
- **Acceptance criteria:**
  - Overview, Live Event Stream, Case Detail, Policy Firewall, Audit Trail, and Digital Twin Evaluation are present.
  - Duplicate, out-of-order, late-success, invalid-AI-amount, AI-timeout, and downtime-failure scenarios work.
  - Every synthetic number is labelled.
  - Decisions expose evidence and policy rules.
  - Responsive and keyboard interactions work.
  - Demo reset reproduces the same seeded state.
- **Verification method:** Component checks, browser walkthrough, responsive checks, and accessibility review.

## Milestone 15 — Optional Razorpay Test Mode Adapter

- **Status:** `NOT_STARTED`
- **Outcome:** The stable local product can optionally use documented Razorpay Test Mode endpoints while mock mode remains the default.
- **Dependencies:** Milestones 8, 10–11, and 14.
- **Acceptance criteria:**
  - Application still works without credentials.
  - Explicit configuration enables Test Mode.
  - Adapter supports documented payment fetch, downtime fetch, Payment Link create/cancel, and relevant webhook events only.
  - Only a few live test links are created and current limits are respected.
  - Secrets stay server-side and failures degrade safely.
  - No Vulcan integration or arbitrary retry is claimed.
- **Verification method:** Shared adapter contract tests and one controlled Test Mode flow when credentials are available.

## Milestone 16 — Comprehensive Test and Reliability Hardening

- **Status:** `NOT_STARTED`
- **Outcome:** Complete unit, integration, adversarial, and end-to-end protection for financial safety rules.
- **Dependencies:** Milestones 1–15; external credentials remain optional.
- **Acceptance criteria:**
  - All specification adversarial cases are covered.
  - Full suite passes from a clean checkout.
  - Tests are deterministic and never require real money.
  - Type-check and production build pass.
  - Credential-dependent tests skip cleanly when unavailable.
  - Automated CI checks are configured.
- **Verification method:** Clean install, migrations, full tests, type-check, build, and optional Test Mode smoke test.

## Milestone 17 — Documentation and Submission Package

- **Status:** `NOT_STARTED`
- **Outcome:** A reviewer can understand, run, and evaluate the project without assistance.
- **Dependencies:** Milestones 1–16.
- **Acceptance criteria:**
  - README, architecture diagram, setup, environment, Test Mode, Digital Twin, baseline, metrics, security, limitations, and demo instructions match the implementation.
  - Application-form title, objectives, challenges, and five-minute demo script are ready.
  - Fresh users can run credential-free demo mode.
  - External claims link to official documentation.
  - No prohibited claim or credential is present.
- **Verification method:** Follow documentation from a clean environment and cross-check claims against actual behavior.

## Milestone 18 — Final Browser Verification and Release

- **Status:** `NOT_STARTED`
- **Outcome:** Submission-ready, browser-verified, and shareable application.
- **Dependencies:** Milestones 1–17.
- **Acceptance criteria:**
  - Primary five-minute flow works end to end.
  - Desktop and mobile layouts are usable.
  - No blocking console or runtime errors remain.
  - Safety scenarios, audit verification, and evaluation metrics work and agree.
  - Mock mode works without credentials; optional Test Mode fails safely.
  - Public deployment loads correctly.
  - GitHub and pitch links are ready for submission.
- **Verification method:** Browser-based complete-flow test, responsive and accessibility checks, clean release build, deployment, and deployed-site smoke test.
