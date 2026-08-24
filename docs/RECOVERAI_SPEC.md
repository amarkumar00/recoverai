# RecoverAI Canonical Product Specification

> **This document is the canonical product specification for RecoverAI. If implementation decisions conflict with this specification, stop and surface the conflict instead of silently changing the product.**

Information verified as of: 24 August 2026, India Standard Time.

## 1. Purpose of this document

This document gives complete context about:

1. Razorpay AI Buildathon 2026
2. Official tracks and evaluation bars
3. The selected project: RecoverAI
4. Razorpay API capabilities and limitations
5. Product architecture
6. AI responsibilities
7. Policy and safety boundaries
8. Synthetic dataset and evaluation
9. Dashboard and five-minute demo
10. Testing, security and deliverables

When assisting with this project:

- Treat official Razorpay facts separately from proposed architecture.
- Do not invent undocumented Razorpay APIs.
- Preserve the locked MVP scope unless explicitly asked to change it.
- Prefer a narrow working implementation over additional features.
- Never claim simulated revenue as real production revenue.
- Do not introduce x402, AP2, blockchain, subscriptions, Magic Checkout or autonomous refunds into the MVP.

---

# Part A — Razorpay AI Buildathon

## 2. Official program overview

The Razorpay AI Buildathon is a student-only hiring program for discovering AI Builder Interns.

Official program information:

- Students only
- AI Builder Internship
- Six-month or twelve-month duration, participant's choice
- ₹75,000 monthly stipend
- In-person in Bangalore
- Internship availability required starting September 2026
- No resume screening
- No aptitude test
- No group discussion
- Shortlisted builders proceed directly to a panel
- Candidates must build and show a working project
- Public GitHub repository required
- Five-minute pitch video required
- Architecture explanation required

Official page: [Razorpay AI Buildathon](https://razorpay.com/buildathon/)

## 3. Eligibility shown in the current application form

The official application form currently lists these graduation years:

- 2027
- 2028
- 2029

It asks whether the applicant is available for an in-person internship starting in September and asks the applicant to choose six or twelve months.

The form requests:

- Email
- Full name
- College name
- Graduation year
- In-person availability starting September
- Preferred internship duration
- Selected track
- Project name/title
- Project objectives
- GitHub repository URL
- Five-minute pitch video link
- Build challenges and technical obstacles
- Final-submission confirmation

The form warns that no further edits can be made after final submission.

Official application form: [Razorpay AI Builder Internship 2026](https://docs.google.com/forms/d/e/1FAIpQLScJ9XSqVCB2oaPwEMH0Zk3I1OpILFW1WpWdWweQ2950jdRzlg/viewform)

The official page and form, as viewed on 24 August 2026, do not visibly state an application deadline. Some secondary reports mention 5 September 2026, but this should be verified through the official application channel before relying on it.

## 4. Official tracks

### Track 01 — AI Growth & Agentic Commerce

Objective:

> Grow the merchant's revenue and make merchants sellable to AI buyers.

Example directions:

- Conversational in-app checkout
- Agent-readable catalog
- Upsell and cross-sell agent
- Campaign orchestrator

Evaluation bar:

- Every money action must be explainable
- Actions must be bounded and gated
- Show an audit trail
- Show at least one failure handled gracefully

### Track 02 — AI Risk Manager

Objective:

> Stop merchants from losing money to fraud, returns and chargebacks.

Example directions:

- Chargeback evidence responder
- Return-risk scorer
- Fraud-spike detector
- Abuse-ring sentinel

Evaluation bar:

- Working detector, verifier or responder
- Precision and recall on a held-out test set
- Honest false-positive cost
- Strictly defense-only
- Anything offense-capable is disqualified

### Track 03 — AI Revenue Recovery

Objective:

> Find revenue that is slipping away and win it back.

The agent should:

- Detect revenue at risk
- Diagnose the cause
- Determine the correct intervention
- Execute a bounded recovery workflow

Example directions:

- Payment degradation to root cause to recovery action
- Checkout drop-off recovery
- Failed-subscription recovery
- B2B receivables chasing
- Mandate retry sequencing
- Hinglish voice recovery
- Promise-to-pay tracking

Evaluation bar:

- Do not merely identify the problem
- Show measured money recovered across a batch
- Include compliant escalation
- Include deterministic stopping rules
- Include an audit trail

### Track 04 — AI Finance Controller

Objective:

> Run the books and cash position.

Requirements:

- Close one finance-operations loop
- Process at least 50 synthetic records
- Report match rate
- Report unresolved exceptions

Evaluation bar:

- Throughput
- Measured accuracy
- Honest exception list
- One cherry-picked result is insufficient

### Track 05 — Open Track

Objective:

> Build something meaningful that does not fit the predefined tracks.

Evaluation bar:

- Real problem
- Working product
- Meaningful AI use
- Evidence of value
- Strong execution, reliability and depth

---

# Part B — Selected Project

## 5. Locked project decision

Selected track:

> Track 03 — AI Revenue Recovery

Project name:

> RecoverAI — Payment Failure Digital Twin & Bounded Recovery Agent

Status:

> This is the locked primary project. ReconcileAI is only a backup idea.

## 6. One-line pitch

> RecoverAI is a merchant-side post-failure recovery control plane that converts failed-payment events into explainable, policy-bounded recovery actions and measures the incremental simulated rupees recovered—without blind retries or duplicate charges.

## 7. Formal problem statement

Online merchants lose recoverable revenue because failed payments are frequently treated uniformly even though they have different causes, such as issuer downtime, temporary network degradation, insufficient funds, customer-correctable payment details, hard declines and late authorization.

Blindly sending the same retry request to every customer can:

- Lower conversion
- Create unnecessary customer contact
- Generate duplicate payment risk
- Retry non-recoverable failures
- Continue outreach after the original payment has succeeded
- Provide no evidence of which intervention recovered revenue

RecoverAI receives payment events, reconciles the current payment state, diagnoses the failure, ranks permitted recovery actions and passes the selected action through a deterministic policy firewall. Only safe actions can be executed.

## 8. Target user

Primary user:

- Online merchant payment-operations team
- Revenue-operations team
- Finance or support operator monitoring failed payments

Primary merchant pain:

> “Which failed payments are actually recoverable, what should we do for each one, and how much incremental revenue did the recovery workflow produce?”

## 9. Why this idea is strong

RecoverAI closely matches the official Track 03 example:

> Payment degradation → root cause → recovery action

It also directly satisfies the official evaluation bar:

- Detects revenue risk
- Selects an intervention
- Executes a bounded workflow
- Reports money recovered across a batch
- Has stopping rules
- Has compliant human escalation
- Produces a complete audit trail
- Demonstrates graceful failure handling

## 10. Relationship with Razorpay Vulcan

Razorpay announced Vulcan, its AI Payments Foundation Model, on 18 August 2026. Vulcan focuses on payment intelligence such as pre-attempt routing, network-level fraud protection, offer targeting and checkout personalization. It uses NVIDIA accelerated computing and AWS/SageMaker infrastructure.

Official announcement: [Razorpay Vulcan](https://razorpay.com/blog/?p=27542)

RecoverAI must not claim to integrate with Vulcan or replace it.

Correct differentiation:

> Vulcan improves the probability of payment success before and during an attempt. RecoverAI addresses the merchant-side operational gap after a payment has failed, become uncertain or later changed state.

RecoverAI is therefore a post-failure recovery control plane, not a payment router.

---

# Part C — MVP Scope

## 11. Included in MVP

The MVP includes:

- One-time payment failures
- Razorpay Test Mode
- Payment webhooks
- Webhook signature verification
- Webhook-event deduplication
- Out-of-order event handling
- Payment-state reconciliation
- Razorpay Payment Downtime context
- Known-error deterministic mapping
- AI-assisted recovery-action ranking
- Deterministic policy firewall
- Razorpay Payment Link creation
- Payment Link cancellation where allowed
- Late-authorization or captured-payment handling
- Human escalation
- Append-only or tamper-evident audit log
- Digital-twin batch replay
- Baseline-versus-RecoverAI evaluation
- One live Razorpay Test Mode recovery flow

## 12. Explicitly excluded from MVP

Do not add these unless the user explicitly expands the scope:

- Checkout abandonment
- Magic Checkout dependency
- Subscription recovery
- Custom subscription retry scheduling
- UPI AutoPay retry control
- x402
- AP2
- ACP implementation
- Blockchain
- Stablecoins
- Fraud detection
- Chargeback handling
- Refund execution
- Autonomous payment capture
- Global gateway routing
- Lending or collections
- WhatsApp or voice calling
- Real customer messages
- Real-money transactions
- Integration with Razorpay Vulcan

---

# Part D — Razorpay API Reality

## 13. Test Mode

Razorpay Test Mode is a sandbox. It uses separate test API keys and does not move real money.

Use test credentials only. Never commit API keys or webhook secrets.

Razorpay API keys normally begin with `rzp_test_` in Test Mode.

Documentation: [Razorpay Payments Quickstart](https://razorpay.com/docs/payments/quickstart/)

## 14. Payment webhook events

Relevant events include:

- `payment.failed`
- `payment.authorized`
- `payment.captured`
- `order.paid`
- Payment-downtime events
- Payment Link events

Useful failed-payment fields can include:

- `payment.id`
- `order_id`
- `amount`
- `currency`
- `status`
- `method`
- `bank`
- `wallet`
- `vpa`
- `error_code`
- `error_description`
- `error_source`
- `error_step`
- `error_reason`
- `created_at`

Important documented behavior:

- Webhooks are asynchronous.
- Duplicate webhook deliveries are expected.
- Event order is not guaranteed.
- A `payment.failed` event can occasionally be followed by `payment.captured` for the same transaction.
- Late authorization is one possible reason.
- A webhook payload is a snapshot at the time of the event.
- A `payment.authorized` payload can contain the authorized snapshot even if the current payment has already become captured.
- Not every possible failure path necessarily produces the same webhook coverage.

Documentation: [Payment webhook events](https://razorpay.com/docs/webhooks/payments/)

## 15. Webhook security and idempotency

Webhook verification requirements:

1. Read the raw request body.
2. Read `X-Razorpay-Signature`.
3. Compute HMAC-SHA256 using the webhook secret.
4. Compare signatures safely.
5. Reject invalid requests before parsing or processing.

Do not verify a parsed or re-serialized JSON body.

Duplicate handling:

- Read `x-razorpay-event-id`.
- Store it with a unique database constraint.
- If the ID has already been processed, return success without repeating the action.

Documentation: [Validate and Test Webhooks](https://razorpay.com/docs/webhooks/validate-test/)

## 16. Payment-state reconciliation

Never assume the last received webhook represents the current payment state.

Use:

> `GET /v1/payments/:id`

to fetch the current payment state before executing a recovery action.

The Payments API can:

- Fetch payment details
- Capture an authorized payment

It cannot directly collect a new payment or arbitrarily retry a failed payment.

Documentation: [Payments API](https://razorpay.com/docs/api/payments/), [Fetch Payment](https://razorpay.com/docs/api/payments/fetch-with-id/)

RecoverAI must not automatically capture payments in the MVP. Authorized or captured states should stop recovery and, if necessary, move the case to merchant review.

## 17. Payment Downtime API

Razorpay exposes payment downtime information for payment methods including:

- Cards
- Netbanking
- UPI

Downtime can be fetched through APIs or received through relevant webhooks.

Documentation: [Payment Downtime APIs](https://razorpay.com/docs/api/payments/downtime/)

If the Downtime API is unavailable, RecoverAI must:

- Avoid guessing that downtime exists
- Mark downtime context as unavailable
- Select a conservative fallback or human escalation
- Record the failure in the audit log

## 18. Payment Links

RecoverAI can create a new Payment Link as a recovery instrument.

Relevant capability:

> `POST /v1/payment_links`

Useful fields:

- `amount`
- `currency`
- Unique `reference_id`
- `description`
- Customer details
- `expire_by`
- Notification preferences
- Notes
- Callback URL

Important constraints:

- The amount is expressed in the smallest currency unit.
- `reference_id` must be unique.
- The created Payment Link ID must be stored against the recovery case.
- Test Mode currently allows up to 30 Payment Links per business unless Razorpay Support increases the limit.
- Customer email/phone may not automatically prefill the hosted checkout.
- A Payment Link lets the customer select supported payment methods; RecoverAI should not claim it can force an undocumented payment-method retry.

Documentation: [Create Standard Payment Link](https://razorpay.com/docs/api/payments/payment-links/create-standard/)

Therefore:

- The 100-case batch must mostly run in dry-run/simulation mode.
- Do not create 100 real Test Mode Payment Links.
- Use one or a few live Payment Links in the final demo.

## 19. Payment Link cancellation

RecoverAI can cancel an eligible unpaid Payment Link through:

> `POST /v1/payment_links/:id/cancel`

A paid or partially paid link cannot be cancelled. Already cancelled or expired links also cannot be cancelled again.

Documentation: [Cancel Payment Link](https://razorpay.com/docs/api/payments/payment-links/cancel-standard/)

Relevant Payment Link webhooks include:

- `payment_link.paid`
- `payment_link.partially_paid`
- `payment_link.cancelled`
- `payment_link.expired`

Documentation: [Payment Link webhooks](https://razorpay.com/docs/webhooks/payment-links/)

---

# Part E — Product Workflow

## 20. End-to-end workflow

```text
Razorpay webhook
        ↓
Raw-body signature verification
        ↓
Event-ID deduplication
        ↓
Append event to audit store
        ↓
Fetch and reconcile current payment state
        ↓
Deterministic known-error mapper
        ↓
Downtime/context enrichment
        ↓
AI recovery-action scorer
        ↓
Deterministic policy firewall
        ↓
Execute permitted action or escalate
        ↓
Watch payment and Payment Link events
        ↓
Stop/cancel when payment succeeds
        ↓
Update metrics and audit trail
```

## 21. Allowed recovery actions

The AI may only propose one of these enumerated actions:

```text
WAIT_FOR_RECOVERY
SEND_PAYMENT_LINK
REQUEST_METHOD_CHANGE
CANCEL_RECOVERY_ALREADY_PAID
STOP_NON_RETRYABLE
ESCALATE_HUMAN
```

Any unknown action must be rejected.

Definitions:

### WAIT_FOR_RECOVERY

Use when there is credible temporary downtime or unresolved network state.

### SEND_PAYMENT_LINK

Create one bounded Payment Link for the original unpaid amount.

### REQUEST_METHOD_CHANGE

Show a customer-safe message recommending that the customer use another available method through a Payment Link. Do not claim a specific method can be forced unless documented and implemented.

### CANCEL_RECOVERY_ALREADY_PAID

Stop recovery and cancel an eligible unpaid recovery link when the original payment becomes authorized/captured or the order becomes paid.

### STOP_NON_RETRYABLE

Close recovery when the failure is permanent, prohibited or not economically sensible to pursue.

### ESCALATE_HUMAN

Use when confidence is low, states conflict, amounts do not match or an API dependency fails in an unsafe way.

## 22. Case states

Suggested internal case states:

```text
DETECTED
VERIFYING
DIAGNOSED
AWAITING_POLICY
WAITING
LINK_CREATED
RECOVERED
STOPPED
ESCALATED
ERROR_SAFE
```

Each transition must be validated by a state machine.

---

# Part F — AI and Deterministic Logic

## 23. Correct division of responsibility

### Deterministic components

Use deterministic code for:

- Signature verification
- Event deduplication
- Payment-state transitions
- Known error-code mapping
- Amount and currency validation
- Retry/contact limits
- Payment Link uniqueness
- Already-paid checks
- Action allowlist
- API authorization
- Stopping rules
- Audit hashing
- Final action execution

### AI components

AI can be used for:

- Normalizing ambiguous or previously unseen failure descriptions
- Estimating recovery probability for each permitted action
- Ranking actions by expected economic value
- Generating a short merchant explanation
- Generating a customer-safe recovery message
- Producing structured reasoning and confidence
- Detecting when context is insufficient and recommending escalation

The LLM must return schema-validated structured output, not free-form executable instructions.

## 24. Action-value formula

For each permitted action, calculate:

```text
Expected Value(action)
=
P(recovery | payment context, action) × unpaid amount
− contact cost
− customer-friction penalty
− duplicate-payment risk penalty
− operational cost
```

The AI ranks actions, but the deterministic firewall decides whether the top-ranked action is allowed.

## 25. Policy firewall invariants

Suggested defaults:

```text
MAX_PAYMENT_LINKS_PER_ORDER = 1
MAX_CUSTOMER_CONTACTS = 2
MAX_RECOVERY_WINDOW_HOURS = 24
MIN_AI_CONFIDENCE = 0.70
```

Hard rules:

1. Never act on an invalid webhook signature.
2. Never process the same `x-razorpay-event-id` twice.
3. Never create a link if the latest payment/order state is paid or captured.
4. Never create more than one active recovery link per order.
5. Payment Link amount and currency must match the verified unpaid amount.
6. Never accept an AI-generated amount, currency, API route or recipient.
7. Never execute an action outside the allowlist.
8. Low-confidence cases go to human review.
9. API timeout must not trigger repeated money actions.
10. Stop further outreach after successful payment.
11. Partially paid links require human review in MVP.
12. Log every approve, reject, fallback and escalation decision.

---

# Part G — Digital Twin and Dataset

## 26. Meaning of “Payment Failure Digital Twin”

The Digital Twin is an offline replay and outcome-simulation environment. It lets the team:

- Replay synthetic historical payment cases
- Inject duplicate and reordered webhooks
- Test different recovery policies
- Compare RecoverAI against a baseline
- Measure simulated recovered revenue
- Demonstrate failure handling without real money or real customers

It is not a claim that the system perfectly models Razorpay's production payment network.

## 27. Dataset design

Create:

- A synthetic historical/development dataset for configuring or training the action scorer
- A separately seeded held-out evaluation set of 100 unique payment cases
- Approximately 125 event deliveries for those 100 cases, including duplicates and reordered deliveries

Suggested held-out case distribution:

- 25 known downtime or transient failures
- 20 insufficient-funds cases
- 15 customer-correctable failures
- 15 network/integration uncertainty cases
- 10 late-authorized or later-captured cases
- 10 hard/non-retryable failures
- 5 ambiguous cases requiring human review

Duplicate and out-of-order deliveries are injected over these cases; they are not counted as additional unique payments.

## 28. Suggested dataset fields

Each payment case may contain:

```text
case_id
event_id
payment_id
order_id
customer_id_hash
amount
currency
method
bank_or_provider
status
error_code
error_description
error_source
error_step
error_reason
attempt_number
previous_success_count
previous_failure_count
previous_contact_count
payment_created_at
event_created_at
downtime_active
downtime_severity
current_fetched_state
active_recovery_link
ground_truth_failure_class
ground_truth_allowed_actions
simulated_outcome_by_action
```

Do not include real customer PII.

## 29. Outcome simulator

Because the evaluation data is synthetic, each case should define a hidden recovery outcome for each possible action.

Example:

```text
Case: temporary issuer downtime

WAIT_FOR_RECOVERY → succeeds after downtime
SEND_PAYMENT_LINK → customer ignores it
REQUEST_METHOD_CHANGE → succeeds with moderate probability
STOP_NON_RETRYABLE → no recovery
ESCALATE_HUMAN → unresolved
```

Keep simulator rules transparent in documentation but keep the held-out case outcomes separate from the action-selection component during evaluation.

## 30. Baseline

Do not use ₹0 as the baseline.

Recommended baseline:

> Every eligible failed payment receives the same generic Payment Link after 15 minutes, unless it is already paid.

Compare this baseline against RecoverAI.

## 31. Primary metric

```text
Incremental Simulated Revenue Recovered
=
Simulated revenue recovered by RecoverAI
− Simulated revenue recovered by baseline
```

Always include the word “simulated” when presenting synthetic results.

## 32. Secondary metrics

Report:

- Simulated recovery rate
- Incremental simulated revenue
- Root-cause classification accuracy
- Action-selection accuracy
- Unsafe actions blocked
- Duplicate events ignored
- Duplicate-charge attempts prevented
- Unnecessary customer contacts avoided
- Human escalation rate
- False-positive intervention cost
- Payment Link creation count
- API failure/fallback count
- Mean processing time per event
- Honest unresolved exception count

---

# Part H — Dashboard

## 33. Required screens

### Overview

Show:

- Total payment cases
- Revenue initially at risk
- Baseline simulated recovery
- RecoverAI simulated recovery
- Incremental simulated recovery
- Duplicate events ignored
- Unsafe actions blocked
- Human escalations

### Live Event Stream

Show:

- Incoming event type
- Signature status
- Duplicate status
- Current payment state
- Diagnosis
- Proposed action
- Firewall outcome
- Final action

### Case Detail

Show:

- Payment timeline
- Failure fields
- Downtime context
- Current fetched state
- AI recommendation
- Confidence
- Expected-value breakdown
- Policy checks
- Payment Link state
- Final outcome

### Policy Firewall

Show:

- Active limits
- Recent approved actions
- Recent blocked actions
- Exact rule responsible for each block

### Audit Trail

Show:

- Timestamp
- Actor/component
- Input or event reference
- Decision
- Reason
- Previous state
- New state
- Previous log hash
- Current log hash

Call it a tamper-evident audit log only if the hash chain is actually implemented. Otherwise call it an append-only audit log.

### Digital Twin Evaluation

Show:

- Baseline versus RecoverAI
- Results by failure class
- Recovery by selected action
- Confusion matrix
- False-positive cost
- Exception list

---

# Part I — Five-Minute Pitch and Demo

## 34. Demo sequence

### 0:00–0:35 — Problem

Explain:

> Payment success optimization exists, but merchants still face fragmented post-failure operations. Different failure causes require different interventions, and blind recovery can create customer friction or duplicate payments.

### 0:35–1:10 — Architecture

Show:

```text
Webhook → Verify → Reconcile → Diagnose → AI Rank → Policy Gate → Act → Audit
```

Say:

> AI proposes; deterministic financial policy disposes.

### 1:10–2:10 — Batch evaluation

Run or reveal the held-out 100-case replay.

Show:

- Baseline simulated recovery
- RecoverAI simulated recovery
- Incremental simulated rupees recovered
- Contacts avoided
- Honest exceptions

### 2:10–3:00 — Duplicate and out-of-order events

Inject:

- Same `x-razorpay-event-id` twice
- Captured/authorized event arriving in an unexpected order

Show:

- Duplicate ignored
- Current payment state fetched
- Recovery action not repeated

### 3:00–3:45 — Unsafe AI action

Force the AI test double to propose:

```text
SEND_PAYMENT_LINK
amount = original amount × 10
```

Show:

- Schema or amount mismatch
- Policy firewall rejection
- Safe human escalation
- Audit entry

### 3:45–4:25 — Live Razorpay Test Mode flow

Demonstrate:

1. One failed/synthetic case becomes eligible.
2. RecoverAI creates a Test Mode Payment Link.
3. The link is opened and paid in Test Mode.
4. `payment_link.paid` or payment success webhook arrives.
5. Case becomes recovered.
6. Further recovery stops.

Keep a recorded fallback in case internet or webhook delivery fails during the presentation.

### 4:25–5:00 — Close

Show:

- Incremental simulated revenue
- Policy blocks
- False-positive cost
- Human escalations
- Audit trail

Closing line:

> RecoverAI does not make AI powerful enough to move money freely. It makes AI useful enough to recover revenue safely.

---

# Part J — Recommended Technical Implementation

## 35. Suggested stack

A practical hackathon stack:

### Application

- Next.js with TypeScript
- Server-side API routes or a small separate Node service
- Tailwind CSS
- A simple component library
- Recharts or equivalent for metrics

### Data

- PostgreSQL for hosted deployment
- SQLite acceptable for the first local prototype
- Prisma or Drizzle ORM
- Unique constraint on webhook event ID

### Validation

- Zod or equivalent schema validation
- Constant-time signature comparison
- Raw-body webhook handler

### Razorpay

- Razorpay Node SDK or direct REST APIs
- Test Mode API keys
- Payment webhooks
- Payment fetch API
- Payment Downtime API
- Payment Links API

### AI

- Model-provider agnostic
- Structured JSON output
- Temperature kept low for classification/explanation
- Optional small learned action-ranking model
- A deterministic mock AI mode for repeatable tests and demo fallback

### Testing

- Vitest or Jest
- Integration tests for database and policy logic
- Seeded digital-twin generator
- Webhook replay fixtures

Do not add a complex multi-agent framework unless it solves a demonstrated need.

## 36. Suggested core modules

```text
/webhooks
  signature-verifier
  event-deduplicator
  payment-webhook-handler

/payments
  razorpay-client
  state-reconciler
  downtime-client

/diagnosis
  known-error-mapper
  ai-context-normalizer
  recovery-action-scorer

/policy
  action-schema
  policy-firewall
  stopping-rules

/recovery
  payment-link-executor
  recovery-canceller
  human-escalator

/audit
  append-only-event-store
  hash-chain-verifier

/digital-twin
  case-generator
  webhook-replayer
  outcome-simulator
  baseline-runner
  metrics-calculator
```

---

# Part K — Security and Reliability

## 37. Minimum security requirements

- Test Mode only
- Secrets stored in environment variables
- No secrets in GitHub
- Verify webhook HMAC before JSON processing
- Store raw event only after appropriate protection/redaction
- Do not expose full customer phone/email in UI
- Hash synthetic customer identifiers
- Use a unique event-ID database constraint
- Validate all AI output against a strict schema
- Re-fetch payment state before executing recovery
- Add timeout and retry controls to external API calls
- Make action execution idempotent
- Log failures without logging secrets
- No real customer notifications during development
- No autonomous production-money actions

## 38. Graceful failure behavior

### Invalid webhook signature

Reject and record a security event without processing the payment.

### Duplicate webhook

Return success but perform no new action.

### Out-of-order webhook

Re-fetch the current payment state and apply the legal state transition.

### Downtime API failure

Do not infer downtime. Use conservative fallback or escalation.

### AI timeout

Use deterministic fallback mapping or escalate.

### Invalid AI output

Reject through schema validation and policy firewall.

### Payment Link creation timeout

Check whether a link was already created using the local idempotency key/reference before retrying.

### Late authorization/capture

Stop recovery and cancel an eligible unpaid link.

### Already-paid link cancellation error

Treat paid state as success; do not repeatedly cancel.

### Conflicting amount/currency

Block action and escalate.

---

# Part L — Verification Plan

## 39. Required tests

### Unit tests

- Valid webhook signature
- Invalid webhook signature
- Duplicate event detection
- Known error mapping
- Policy allow/deny rules
- Amount mismatch
- Currency mismatch
- Maximum-contact limit
- Payment already captured
- Unknown AI action
- Audit hash-chain verification

### Integration tests

- Webhook to case creation
- Case to diagnosis
- Diagnosis to policy decision
- Approved action to Payment Link dry run
- Payment Link webhook to recovered state
- Late authorization to recovery cancellation
- API timeout to safe fallback

### Adversarial tests

- AI proposes ten-times payment amount
- AI invents an API endpoint
- AI returns malformed JSON
- Duplicate webhook arrives concurrently
- Captured event arrives before authorized event
- Payment state changes between diagnosis and execution
- Downtime context contradicts failure fields
- Active recovery link already exists
- Audit record is modified

### End-to-end verification

Demonstrate:

```text
Synthetic payment failure
→ verified webhook
→ diagnosis
→ AI action ranking
→ policy approval
→ Test Mode Payment Link
→ Test payment
→ success webhook
→ recovered case
→ stopped recovery
→ updated metrics
```

---

# Part M — GitHub and Submission Deliverables

## 40. Public repository checklist

The public repository should contain:

- Clear README
- Problem statement
- Architecture diagram
- Setup instructions
- Environment-variable template without secrets
- Razorpay Test Mode setup instructions
- Webhook setup instructions
- Seeded dataset generator
- Held-out evaluation command
- Baseline definition
- Metrics report
- Demo credentials or demo mode
- Automated tests
- Known limitations
- Security decisions
- Screenshots or GIF
- Five-minute pitch link
- License
- Meaningful commit history

## 41. README claims that are safe

Safe wording:

- “Simulated incremental revenue”
- “Test Mode integration”
- “Prototype”
- “Held-out synthetic evaluation”
- “Tamper-evident log” only if hash chaining is implemented
- “AI-assisted action ranking”
- “Policy-bounded execution”

Avoid:

- “Recovered real merchant revenue”
- “Production-ready”
- “Eliminates payment failures”
- “Integrated with Razorpay Vulcan”
- “Retries any failed UPI/card payment”
- “Guarantees no duplicate charges”
- “Immutable audit log” without technical enforcement
- “Works for checkout abandonment” without implementing the relevant event source

---

# Part N — Application-Ready Content

## 42. Project title

> RecoverAI — Payment Failure Digital Twin & Bounded Recovery Agent

## 43. Short project objective

> RecoverAI helps merchants recover revenue from failed payments by diagnosing the failure, selecting the highest-value safe intervention and executing it through a deterministic policy firewall. It handles duplicate and out-of-order payment events, stops recovery after late authorization or successful payment, and reports incremental simulated revenue recovered across a held-out batch with a complete audit trail.

## 44. Longer project description

> Payment failures do not have a single cause, yet many recovery systems apply the same retry or reminder to every customer. RecoverAI is a merchant-side post-failure recovery control plane built on Razorpay Test Mode. It verifies and deduplicates webhooks, reconciles the latest payment state, enriches the event with payment-downtime context and uses AI to rank a fixed set of recovery actions. A deterministic policy firewall validates amount, currency, payment state, contact limits and action permissions before execution. RecoverAI can create a bounded Payment Link, wait for temporary recovery, stop non-retryable cases or escalate ambiguous cases. A seeded Digital Twin evaluates RecoverAI against a generic-recovery baseline and reports incremental simulated revenue, false-positive cost, duplicate actions prevented and honest exceptions.

## 45. Expected technical challenges

Potential challenges to discuss honestly:

- Verifying webhook signatures using the untouched raw request body
- Deduplicating concurrent webhook deliveries
- Reconciling out-of-order event snapshots with current API state
- Preventing race conditions between recovery-link creation and late authorization
- Keeping AI output constrained to a strict action schema
- Designing an honest synthetic outcome simulator
- Separating simulated results from production claims
- Demonstrating real APIs without exceeding Test Mode Payment Link limits
- Providing deterministic demo fallback when external services fail

## 46. Likely judge questions

Be ready to answer:

### “Why is AI required?”

Known errors are handled deterministically. AI is used for ambiguous context normalization, action-value estimation and ranking, and explainable customer/merchant communication. The AI cannot directly execute arbitrary financial actions.

### “How is this different from Razorpay's routing or Vulcan?”

Vulcan improves payment success before/during an attempt. RecoverAI manages the merchant's bounded workflow after a failed or uncertain payment state.

### “How do you know money was recovered?”

The hackathon evaluation uses a transparent seeded Digital Twin with hidden action outcomes. Results are labelled simulated. A real Test Mode Payment Link demonstrates integration, not real revenue.

### “What prevents duplicate payment?”

Event-ID deduplication, current-state reconciliation, one-active-link-per-order, a final state check before execution and stopping/cancelling recovery after success.

### “Why not retry the original payment?”

Razorpay's Payments API does not provide a general API to recollect or arbitrarily retry a failed payment. RecoverAI uses a new bounded Payment Link or stops/escalates.

### “What happens when AI is wrong?”

The AI may only propose an allowlisted action. Schema validation and deterministic policies check the current state, amount, currency, confidence and limits. Unsafe output is blocked and audited.

### “Why synthetic data?”

Real merchant payment data is private and unavailable. Synthetic evaluation allows reproducible edge cases, controlled ground truth and honest offline comparison without moving real money.

### “What is the biggest limitation?”

Synthetic outcome data cannot establish production uplift. Real deployment would require merchant-approved experiments, privacy review, calibration on historical outcomes and controlled A/B testing.

---

# Part O — Final Decision Summary

Build:

> RecoverAI for Track 03 — AI Revenue Recovery.

Core product:

> A post-failure payment recovery control plane with AI action ranking and deterministic execution boundaries.

Primary evaluation:

> Incremental simulated revenue recovered against a realistic generic-recovery baseline across 100 held-out payment cases.

Core proof points:

- Razorpay Test Mode integration
- Signed webhook handling
- Duplicate protection
- Out-of-order state reconciliation
- Payment downtime context
- Meaningful but restricted AI
- Deterministic policy firewall
- Payment Link execution
- Late-success recovery cancellation
- Honest metrics
- Human escalation
- Complete audit trail
- Graceful failure demonstration

Do not broaden the MVP until this complete flow works end-to-end.
