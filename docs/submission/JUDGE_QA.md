# RecoverAI Judge Q&A

Each answer is designed to be spoken in roughly 15–30 seconds. Every financial result is **simulated** synthetic evidence.

## Why is AI required?

Rules handle exact known errors and hard safety. AI is useful when several safe interventions remain and we need a context-aware value ranking. RecoverAI constrains that use: the provider estimates bounded recovery probabilities for a fixed candidate set; trusted code calculates expected value and deterministic policy decides whether anything may execute.

## Why not handle everything deterministically?

We do handle identities, known error mapping, money, state, limits, and execution deterministically. A pure rule table can still become brittle when ambiguous context changes the relative value of waiting, a method change, a link, or escalation. RecoverAI isolates that uncertainty in passive ranking while preserving deterministic authority everywhere else.

## What prevents AI from moving arbitrary money?

The AI input and output schemas contain no amount, currency, recipient, API route, credential, idempotency key, or policy authority. It can return only a complete ranking of diagnosis-generated allowlisted actions. Trusted server code supplies money and expected value; the deterministic firewall can approve, block, stop, or escalate.

## What prevents duplicate collection?

The provider event ID is claimed durably, action and link references are stable, only one blocking link is allowed per order, and the executor re-fetches payment and re-reads case state before create. Late authorization or capture stops recovery and cancels only an eligible unpaid link. These controls reduce repeated local effects; they are not a universal production guarantee.

## How are out-of-order events handled?

Webhook snapshots stay as historical evidence. RecoverAI fetches current payment state and records it separately as provider-reconciled authority. Authorization/capture authority is monotonic, so a stale failure or later-delivered authorization cannot downgrade captured state or reactivate recovery.

## Why create a Payment Link rather than retry the failed payment?

Razorpay documents the Payments API for fetching payments and capturing authorized payments, not arbitrary recollection of a failed payment. RecoverAI therefore creates a new bounded Standard Payment Link only after current-state and money checks. It does not expose original-payment retry or automatic capture.

## How is RecoverAI different from routing or Vulcan?

Routing and payment intelligence act before or during an attempt. RecoverAI addresses the merchant-side control loop after a failure or uncertain state: reconcile, diagnose, choose a bounded intervention, stop late-success recovery, and measure the workflow. It does not claim a Vulcan integration or replacement.

## How was simulated revenue calculated?

Each strategy fixes one final action for each unique synthetic payment. Only then does the evaluator reveal that action’s hidden simulated outcome. We sum recovered integer subunits once per payment. Incremental simulated recovery is RecoverAI INR 5,526,332 subunits minus baseline INR 4,784,383, equal to INR +741,949 subunits or ₹7,419.49 simulated.

## Why is the baseline fair?

It is not ₹0 or “do nothing.” At exactly 15 deterministic minutes, it sends the same generic Payment Link to every eligible verified-unpaid case, reuses an active link, avoids contact for verified-paid cases, and escalates unavailable/conflicting state. Both strategies face the same hidden simulated outcomes.

## Why is root-cause accuracy 100%?

It is 100% only on handcrafted synthetic fixtures built around the exact deterministic error and downtime rules. That proves fixture consistency, not real-world production accuracy. The dashboard and report label this limitation explicitly.

## Why are 43 outcomes unresolved or escalated?

RecoverAI keeps ambiguous, unavailable, failed-safe, and selected non-recovery outcomes visible instead of inventing success. Nineteen final actions are human escalation; the wider count of 43 also includes selected outcomes marked simulated unresolved. That is an honest exception list, not hidden failure.

## What does 95% action accuracy mean?

For 95 of 100 synthetic payments, the fixed final RecoverAI action belonged to the evaluator’s handcrafted allowed-action set. Five late-success fixtures selected a safe stopping representation that differed from the oracle’s preferred set. It is synthetic agreement, not a production model-quality claim.

## Why is the dataset synthetic?

Real merchant payment data is private and unavailable for this prototype. A seeded synthetic batch gives reproducible edge cases, duplicate and out-of-order overlays, controlled ground truth, and a fair offline comparison without real PII, customer contact, credentials, or money movement.

## What does tamper-evident mean?

Each audit entry hashes canonical content plus the prior hash, and SQLite stores a local count/head anchor. Editing, inserting, deleting, or reordering entries breaks verification while that anchor is trustworthy. It is not immutable: an administrator who can rewrite every entry and the anchor can construct a new locally valid chain.

## What happens after provider timeouts?

Reads fail closed to unavailable state or escalation. A write timeout is outcome-uncertain, consumes the local attempt, and is not automatically retried. Provider operation, SQLite, and audit are not one distributed transaction, so incomplete evidence requires operator investigation rather than a blind second financial operation.

## Was real Razorpay Test Mode tested?

No. The adapter and HTTP boundary have deterministic contract tests, but live verification was `NOT_RUN_CREDENTIALS_UNAVAILABLE`. Zero live Payment Links were created during verification. The normal demo and CI use no credentials and make zero external financial calls.

## What would be required for production?

Merchant-approved historical data and controlled experiments; calibrated models; production authentication/authorization; privacy and security review; rate limits and secret rotation; durable multi-node work ownership; operator repair tooling; external audit anchoring; monitoring, alerts, and runbooks; and explicit customer-contact consent.

## What is the biggest current limitation?

The measured uplift is a deterministic result from handcrafted synthetic outcomes and a mock scorer. It demonstrates system design, safety, and reproducibility, but cannot establish causality or predict real merchant recovery. A production claim requires controlled merchant experiments.

## What exactly did the held-out run show?

Across 100 synthetic payments, RecoverAI recovered ₹55,263.32 simulated versus ₹47,843.83 simulated for the generic baseline: ₹7,419.49 incremental simulated. Recovery rate was 42%; action accuracy 95%; 69 contacts were avoided; 19 unsafe plans were blocked or redirected; human escalation was 19%; false-positive cost was ₹34.36 simulated; and 43 outcomes remained unresolved or escalated.

## How do hidden outcomes stay hidden?

Scorer-visible cases exclude ground truth and per-action outcomes. AI, diagnosis, policy, and recovery modules are prevented from importing the evaluator-only generator. The evaluator API accepts only a case ID and an already-fixed action, then reveals that action’s outcome. Tests and locked hashes detect leakage or drift; this is structural, not cryptographic, isolation.

## Does the demo use signed Razorpay webhooks?

The public `/api/webhooks/razorpay` route implements exact raw-body HMAC verification and durable event-ID deduplication. The primary credential-free demo uses a separate trusted synthetic internal boundary, visibly marked `NOT_CHECKED`, so it never pretends that a public webhook was verified without a configured secret.

## Why is SQLite acceptable here?

SQLite keeps the prototype credential-free, durable, reproducible, and easy to migrate. Foreign keys, uniqueness, WAL, a busy timeout, and compare-and-set updates cover local concurrency tests. It is explicitly not presented as multi-node production infrastructure.
