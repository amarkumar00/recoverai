# Buildathon Application Copy

All copy below is ready to adapt for the Razorpay AI Buildathon application. Any monetary result is explicitly **simulated** synthetic evidence.

## Project title

**RecoverAI — Payment Failure Digital Twin & Bounded Recovery Agent**

## Track

**Track 03 — AI Revenue Recovery**

## Team and public links

- **Team:** RecoverAI
- **Team size:** Solo
- **Builder:** Amar Kumar
- **Role:** Solo Builder — Full-stack Engineer & Product Designer
- **Public repository:** [github.com/amarkumar00/recoverai](https://github.com/amarkumar00/recoverai)
- **Public demo:** [recoverai-production-6446.up.railway.app](https://recoverai-production-6446.up.railway.app/)
- **Credential-free CI:** [GitHub Actions](https://github.com/amarkumar00/recoverai/actions/workflows/ci.yml)
- **Pitch/video URL:** Pending owner-supplied recording URL
- **Buildathon application URL or ID:** Pending owner-supplied application record

## Verified deployment status

The public demo runs in credential-free Demo Mode on Railway with Node.js 22, exactly one application instance, and SQLite at `/data/recoverai.db` on the persistent `/data` volume. No Razorpay credentials are configured. Public verification made zero external financial calls and created zero real or Test Mode Payment Links. The demonstrated Payment Link is deterministic and simulated, has no public URL, and sends no customer message.

Availability currently depends on the Railway Free Trial; no billing details, paid upgrade, or paid Railway feature was used. Live Razorpay Test Mode remains `NOT_RUN_CREDENTIALS_UNAVAILABLE`.

## One-line pitch

RecoverAI diagnoses failed payments, uses AI to rank only safe recovery options, and lets a deterministic policy firewall execute or stop the workflow—measured against a fair baseline in a locked 100-case synthetic Digital Twin.

## Short objective

RecoverAI helps merchants recover revenue from failed or uncertain payments without giving AI arbitrary financial authority. It verifies and deduplicates Razorpay-style events, reconciles current payment state, diagnoses known errors, ranks a closed set of actions, and applies deterministic money, state, contact, timing, and confidence rules before an idempotent mock or optional Test Mode Payment Link operation. A held-out synthetic evaluation reports incremental **simulated** recovery and honest exceptions.

## Longer description

Payment failures do not share one cause, yet generic recovery systems often apply the same link or reminder to every case. RecoverAI is a merchant-side post-failure recovery control plane for Track 03. A Razorpay-style webhook crosses exact raw-body HMAC verification and durable event-ID deduplication, but its snapshot remains historical evidence. RecoverAI fetches current payment state before any material action, then uses deterministic known-error diagnosis and a bounded AI ranking boundary.

The AI can rank only six predefined actions. It cannot choose amount, currency, recipient, API route, credentials, or policy. Trusted code calculates expected value, and a deterministic firewall checks payment state, money integrity, one-link and contact limits, the recovery window, confidence, and expected value. The executor is idempotent, stops after late payment success, and treats provider uncertainty conservatively. Material evidence is recorded in a tamper-evident local hash chain and exposed through privacy-minimized dashboard views.

The default product is credential-free Demo Mode. A seeded held-out Digital Twin compares RecoverAI against a real generic baseline: one Payment Link after exactly 15 deterministic minutes for each eligible verified-unpaid failure. Across 100 handcrafted synthetic payments, RecoverAI produced ₹55,263.32 simulated recovery versus ₹47,843.83 simulated baseline recovery, an incremental ₹7,419.49 simulated result. These fixtures do not prove production uplift or causality.

## Problem statement

A failed-payment event is not a complete recovery decision. The same visible failure can reflect downtime, insufficient funds, incorrect customer input, an integration problem, a hard decline, or a payment that actually succeeded later. Generic follow-up can create unnecessary contact, duplicate-collection risk, and poor economics. Merchants need a post-failure control loop that combines current-state evidence, differentiated intervention, hard execution boundaries, and measurable outcomes.

## Target user

The primary user is a merchant finance-operations, payments-operations, or revenue-operations team responsible for failed-payment recovery. Secondary users are risk, support, and engineering teams that need explainable decisions, safe escalation, and auditable evidence.

## What RecoverAI does

1. Verifies Razorpay-style webhook signatures over exact raw bytes.
2. Deduplicates sequential and concurrent deliveries by provider event ID.
3. Separates webhook evidence from freshly reconciled payment authority.
4. Diagnoses known structured errors deterministically.
5. Uses a bounded AI interface to rank diagnosis-generated candidate actions.
6. Computes expected value in trusted integer-subunit code.
7. Applies deterministic money, state, link, contact, time, confidence, and compatibility rules.
8. Executes idempotent mock operations or optional documented Razorpay Test Mode operations.
9. Stops recovery after late authorization/capture and cancels only an eligible unpaid link.
10. Records material decisions in a tamper-evident audit chain and shows privacy-minimized evidence.
11. Evaluates a generic baseline and RecoverAI on the same locked synthetic batch.

## What makes it different

RecoverAI is not a chatbot wrapped around payments. It treats AI as an untrusted ranking component inside a deterministic financial control system. Webhook delivery does not become current-state authority; a provider fetch does. A model recommendation does not become an action; policy does. A provider timeout does not trigger an automatic write retry; it becomes an explicit uncertain state. Evaluation reveals hidden simulated outcomes only after selection and reports unresolved cases and false-positive costs, not only favorable recovery.

## Why AI is meaningful

Rules handle exact known errors and non-negotiable safety. AI is useful only when multiple safe recovery candidates remain and their relative value depends on context. RecoverAI's provider boundary estimates bounded recovery probabilities and explanations for that fixed candidate set. Trusted application code converts those estimates into expected value and policy remains final authority.

The default scorer is a deterministic handcrafted mock/test double for repeatable judging; it is not a trained production model. Provider output is untrusted and strict-schema validated. Malformed output, timeout, provider failure, insufficient context, or unsafe arithmetic fails closed to `ESCALATE_HUMAN` without execution.

## Razorpay integration points

Implemented and documented capabilities are deliberately narrow:

- Exact raw-body HMAC-SHA256 webhook verification and `x-razorpay-event-id` deduplication: [official webhook validation](https://razorpay.com/docs/webhooks/validate-test/).
- Payment, order, downtime, and Payment Link event normalization: [payment events](https://razorpay.com/docs/webhooks/payments/) and [Payment Link events](https://razorpay.com/docs/webhooks/payment-links/).
- Current payment fetch: [`GET /v1/payments/:id`](https://razorpay.com/docs/api/payments/fetch-with-id/).
- Payment downtime fetch: [`GET /v1/payments/downtimes`](https://razorpay.com/docs/api/payments/downtime/fetch-all/).
- Standard Payment Link [create](https://razorpay.com/docs/api/payments/payment-links/create-standard/), [fetch](https://razorpay.com/docs/api/payments/payment-links/fetch-id-standard/), and [eligible cancellation](https://razorpay.com/docs/api/payments/payment-links/cancel-standard/).

Demo Mode needs no Razorpay credentials. The optional Test Mode adapter exists, Live Mode is rejected, and Test Mode does not move real money. Live verification was `NOT_RUN_CREDENTIALS_UNAVAILABLE`; zero live Payment Links were created during verification. RecoverAI implements no arbitrary failed-payment retry, automatic capture, refund, customer message, or Vulcan integration.

## Technical architecture summary

Next.js and TypeScript provide the server-rendered dashboard and fixed demo controls. Zod runtime schemas define the internal vocabulary and untrusted boundaries. SQLite with Drizzle migrations stores events, snapshots, cases, recommendations, decisions, actions, links, evaluation runs, scenarios, and a local audit anchor. Pure modules own diagnosis, expected-value ranking, state transitions, policy, and evaluation. Provider-independent ports isolate deterministic mock behavior from optional Razorpay Test Mode HTTP operations.

The public webhook flow is:

```text
raw body → HMAC → strict event schema → atomic event-ID claim
→ current-state reconciliation → diagnosis → bounded AI ranking
→ deterministic policy → idempotent executor → adapter → audit/read model
```

The separate evaluation flow fixes the final action before an evaluator-only module reveals its hidden simulated outcome, then compares RecoverAI with the generic 15-minute link baseline.

## Safety design

- Closed six-action allowlist; unknown actions fail validation.
- AI lacks amount, currency, recipient, API route, credential, and policy authority.
- Exact integer-subunit amount/currency and identity checks.
- Current payment state and case version rechecked before create.
- One blocking Payment Link per order and two-contact maximum.
- Inclusive 24-hour recovery window and 0.70 minimum confidence.
- Positive expected value required for proactive recovery.
- Stable action/idempotency identities and compare-and-set ownership.
- Late-success stopping with state-aware link cancellation.
- No automatic retry after uncertain provider writes.
- Tamper-evident—not immutable—local audit chain.
- Privacy-minimized dashboard and audit metadata.
- Demo/Test/Live mode separation with Live Mode rejected.

## Held-out simulated evaluation

The evaluator uses 100 held-out synthetic payments in seven failure classes, creating 112 unique provider events, 125 deliveries, and 13 duplicates. Scorer-visible inputs exclude handcrafted ground truth and per-action simulated outcomes. Duplicate and out-of-order overlays test operational safety but never multiply simulated money, contacts, or Payment Links.

Baseline behavior is fixed before outcome reveal: after exactly 15 deterministic minutes, send the same generic Payment Link to every eligible verified-unpaid case; reuse an active link; make no contact for verified-paid cases; escalate unavailable/conflicting state. RecoverAI uses the same selected-outcome evaluator after diagnosis, ranking, and policy fix its final action.

Dataset fingerprint: `2065d1d50588ac7b8e8cf0782e7ae647c59bc02fedc71b856ca7c6d49f96ecdb`

Golden report SHA-256: `0405a6621ba88f362877907ba7dea1624643696b92907ef5f4b13cf9bf22f30c`

## Exact headline results

All results below are **simulated** synthetic outcomes:

- Initially at risk: INR 11,883,796 subunits / ₹118,837.96 simulated.
- Baseline recovered: INR 4,784,383 subunits / ₹47,843.83 simulated.
- RecoverAI recovered: INR 5,526,332 subunits / ₹55,263.32 simulated.
- Incremental RecoverAI result: INR +741,949 subunits / ₹7,419.49 simulated.
- RecoverAI simulated recovery rate: 42%.
- Root-cause accuracy: 100% on handcrafted synthetic fixtures.
- Action-selection accuracy: 95%.
- Customer contacts avoided: 69.
- Unsafe actions blocked or redirected: 19.
- Human escalation rate: 19%.
- Honest unresolved/escalated simulated outcomes: 43.
- False-positive intervention cost: INR 3,436 subunits / ₹34.36 simulated.

At the Milestone 16 verification lock, 652 tests across 51 files passed. Normal verification and CI use no credentials and make zero external financial calls.

## Challenges solved

- Correct HMAC verification over untouched request bytes before parsing.
- Atomic concurrent webhook deduplication and conflict detection.
- Separation of event history from provider-reconciled state authority.
- Monotonic success across out-of-order authorization/capture events.
- Strict passive AI schema and deterministic expected-value calculation.
- Financial rule precedence and exact explainable decision evidence.
- Idempotency across interruption, concurrency, and replay.
- Explicit handling of non-atomic provider, persistence, and audit outcomes.
- Evaluator-only hidden simulated outcome isolation and reproducible golden locks.
- Honest comparison including contacts, blocks, false-positive cost, and unresolved cases.

## Innovation and novelty

RecoverAI combines a payment-failure Digital Twin with a bounded recovery control plane. Its novelty is the joined proof: operational event safety, useful but non-authoritative AI ranking, deterministic financial policies, idempotent execution, late-success stopping, tamper-evident evidence, and a fair held-out baseline. The demo deliberately includes adverse outcomes and a 10× amount attack to show what the system refuses to do.

## Known limitations

- Handcrafted synthetic outcomes do not establish production uplift or causality.
- Root-cause accuracy is measured only on deterministic handcrafted fixtures.
- The default AI scorer is a mock/test double, not a trained production model.
- Live Razorpay Test Mode verification was not run because credentials were unavailable.
- SQLite and the local audit anchor are not multi-node production infrastructure.
- No rate limiting, secret rotation, production authentication/authorization, distributed transaction, or automatic uncertain-operation repair exists.
- No real customer messaging or real-money behavior exists.

## Future work outside the MVP

With explicit merchant approval: calibrate ranking on privacy-reviewed historical outcomes, run controlled A/B experiments, add production identity/access controls, rate limits, secrets management, durable multi-node work ownership, operator repair tools, external audit anchoring, monitoring and alerts, consent-aware messaging, and provider-limit governance. These are future requirements, not implemented claims.

## Technology stack

- Next.js 16 and React 19
- TypeScript 6 with strict checking
- Zod runtime schemas
- SQLite via `better-sqlite3`
- Drizzle ORM and committed SQL migrations
- Vitest deterministic unit/integration/adversarial tests
- ESLint and Prettier
- GitHub Actions credential-free CI
- Node.js native cryptography, HTTP, and HMAC primitives
