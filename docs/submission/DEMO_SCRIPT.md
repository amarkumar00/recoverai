# RecoverAI Five-Minute Demo Script

Use the deterministic credential-free Demo Mode for the submission demo. The live Razorpay Test Mode flow was `NOT_RUN_CREDENTIALS_UNAVAILABLE`; zero live Payment Links were created during verification. Every financial result spoken below is **simulated**.

## Pre-demo preparation

Complete these steps before recording or presenting:

1. Use Node.js 22+, run `npm ci`, `npm run db:migrate`, and `npm run check`.
2. Start the app with `APP_MODE=demo npm run dev` or use the verified production build.
3. Open `/cases`, select **Reset demo**, and confirm **Confirm deterministic reset**. Expect: “Known demo fixtures returned to their exact initial state. Tamper-evident audit history was preserved.”
4. Open `/`, `/evaluation`, `/cases`, `/events`, `/policy`, and `/audit` once to warm the local server.
5. Keep browser zoom at 100%, use a desktop viewport, hide bookmarks/personal extensions if recording, and close developer tools.
6. Confirm the sidebar says **Demo Mode · Synthetic Data**, the Overview says **No real payments · No credentials · No PII**, and no Test Mode short URL or customer data is visible.
7. Keep this script and the [Judge Q&A](JUDGE_QA.md) available on a second screen.

API reset fallback while the app is running:

```bash
curl --fail-with-body --silent --show-error \
  --request POST http://localhost:3000/api/demo/scenarios/reset \
  --header 'Content-Type: application/json' \
  --data '{"confirmation":"RESET_DETERMINISTIC_DEMO"}'
```

## 0:00–0:35 — Merchant problem

- **Page to open:** Overview (`/`).
- **Control to activate:** None; hold on the headline and top simulated metrics.
- **Expected visible result:** “Payment failure recovery, with hard boundaries,” the Demo Mode badge, prototype notice, 100 unique synthetic cases, ₹118,837.96 initially at risk simulated, and +₹7,419.49 incremental recovery simulated.
- **Say:** “A payment failure is not one problem. It may be temporary downtime, insufficient funds, a customer-correctable error, integration uncertainty, a hard decline, or even a payment that succeeded late. Treating all of them with one generic link creates unnecessary contact and duplicate-collection risk. RecoverAI is the bounded control loop after a failure.”
- **Safety/evidence point:** State immediately that all money and outcomes are simulated synthetic evidence, not real merchant revenue or production uplift.
- **Fallback:** If the page is slow, show the README disclaimer and exact results table; do not improvise a real-revenue claim.

## 0:35–1:10 — Architecture and AI/policy split

- **Page to open:** README **Architecture** section in the repository; keep the app Overview in the next tab.
- **Control to activate:** Scroll once to the Mermaid flow.
- **Expected visible result:** Webhook → raw-body HMAC → event-ID deduplication → current-state reconciliation → deterministic diagnosis → bounded AI ranking → deterministic policy firewall → idempotent executor → mock/optional Test Mode adapter → audit/dashboard.
- **Say:** “Webhook snapshots are historical evidence, not current financial authority, so RecoverAI fetches current state before action. Known errors are diagnosed with rules. AI only ranks a closed candidate set; it never receives amount, currency, recipient, API route, credentials, or policy authority. Trusted code calculates expected value, and deterministic policy decides. AI proposes; financial policy disposes.”
- **Safety/evidence point:** The default scorer is a deterministic handcrafted mock/test double, not a trained production model or external LLM.
- **Fallback:** If Mermaid does not render, use the plain-text flow in `docs/ARCHITECTURE.md` or narrate the same sequence over Overview.

## 1:10–2:10 — Locked 100-case Digital Twin results

- **Page to open:** Digital Twin Evaluation (`/evaluation`).
- **Control to activate:** Scroll from the reproducible identity into the metric cards, then briefly to the seven-class table or honest exception list.
- **Expected visible result:** Fingerprint verified; 100 cases; 112 provider events / 125 deliveries; ₹47,843.83 baseline simulated; ₹55,263.32 RecoverAI simulated; +₹7,419.49 incremental simulated; 69 contacts avoided; 19 unsafe blocked/redirected; 43 unresolved/escalated.
- **Say:** “This is a locked held-out batch of 100 synthetic payments with 112 unique events, 125 deliveries, and 13 duplicates. The baseline is fair: after exactly 15 deterministic minutes it sends one generic link to every eligible verified-unpaid case. RecoverAI recovered ₹55,263.32 simulated versus ₹47,843.83 simulated for the baseline—₹7,419.49 incremental simulated. We keep 43 unresolved or escalated outcomes visible.”
- **Safety/evidence point:** “The action is fixed before the evaluator-only module reveals that action’s hidden simulated outcome. The report is locked by a dataset fingerprint and golden JSON hash.”
- **Fallback:** Use the committed `docs/evaluation/GOLDEN_REPORT.md`. Read subunits and rupees correctly; never call INR 741,949 subunits ₹741,949.

## 2:10–3:00 — Duplicate and out-of-order events

- **Page to open:** Cases (`/cases`). Scroll to **Deterministic safety scenarios**.
- **Control to activate:** On **Duplicate webhook delivery**, select **Run fixed scenario**. Then run **Out-of-order payment events**.
- **Expected visible result:** Duplicate shows `DUPLICATE EVENT IGNORED`, one accepted delivery, one ignored duplicate, zero links/contacts/retries. Out-of-order shows `AUTHORITATIVE STATE PRESERVED`, final action `CANCEL_RECOVERY_ALREADY_PAID`, authoritative state `CAPTURED`, and one cancellation.
- **Say:** “The provider event ID is a durable deduplication key, so a repeated signed delivery creates no second effect. Here capture is delivered before authorization; delivery history remains visible, but fresh current state stays captured and cannot regress. Recovery remains stopped.”
- **Safety/evidence point:** Durable concurrent deduplication, historical snapshot versus current authority, monotonic success, and no automatic retry.
- **Fallback:** If a scenario interaction fails, open **Live Event Stream** (`/events`) and explain the fixed event rows. State that the failed interaction stopped safely; do not reset during the timed segment.

## 3:00–3:45 — Unsafe 10× AI amount rejection

- **Page to open:** Cases (`/cases`).
- **Control to activate:** Run **Invalid AI-proposed 10× amount**. Then select **Inspect case** on the **10× amount policy probe** card, or open Policy Firewall (`/policy`).
- **Expected visible result:** Unsafe case state `ESCALATED`; policy outcome `ESCALATED`; primary rule `INTENT_MONEY_INTEGRITY`; verified simulated amount and rejected ten-times amount; no executor, link, or contact created.
- **Say:** “Now the adversarial proof: the proposal is exactly ten times the trusted simulated amount. The schema and firewall do not let AI redefine money. `INTENT_MONEY_INTEGRITY` stops the plan before execution, creates no Payment Link, and sends no contact.”
- **Safety/evidence point:** AI has no financial authority; server-owned amount/currency and deterministic policy override the proposal.
- **Fallback:** If navigation fails, stay on the completed scenario card and expand **Inspect policy and audit evidence**. The result summary and zero-effect counters contain the same proof.

## 3:45–4:25 — Credential-free simulated recovery loop

- **Page to open:** Cases (`/cases`), then **Inspect case** on **Payment failure recovery**.
- **Control to activate:** Select **Start bounded recovery**. Inspect diagnosis, passive AI ranking, expected-value calculation, ordered policy checks, and the mock link. Then select **Simulate mock link paid**.
- **Expected visible result:** The case reaches `LINK_CREATED` once, shows a mock Payment Link with no public URL, then reaches terminal `RECOVERED`; the control changes to a stopped/completed state and the audit status remains valid.
- **Say:** “This primary loop uses no Razorpay or LLM credential. A trusted synthetic event moves through deterministic diagnosis, passive ranking, policy approval, and one idempotent mock link. When the fixed synthetic paid event arrives, the case becomes recovered and further recovery stops.”
- **Safety/evidence point:** The internal demo boundary is visibly `NOT_CHECKED` and separate from the public signed webhook route; every link and outcome here is simulated.
- **Fallback:** If completion fails, keep the case open and show the last persisted stage plus the valid audit timeline. Explain that resumable state prevents a blind repeated operation; do not click repeatedly.

## 4:25–5:00 — Impact, limitations, and close

- **Page to open:** Return to Overview (`/`).
- **Control to activate:** None; frame the headline and metric grid.
- **Expected visible result:** +₹7,419.49 incremental simulated recovery, 42% simulated recovery rate, 69 contacts avoided, 19 unsafe blocked/redirected, and 43 honest unresolved/escalated outcomes.
- **Say:** “RecoverAI’s contribution is not unrestricted automation; it is differentiated recovery with measurable safety boundaries. On this locked synthetic batch it adds ₹7,419.49 simulated recovery over a real generic baseline, avoids 69 contacts, blocks or redirects 19 unsafe plans, and honestly leaves 43 outcomes unresolved or escalated. The limitation is equally important: these handcrafted fixtures and the mock scorer do not prove production uplift. Live Test Mode was not run because credentials were unavailable. The next real step would be merchant-approved calibration and controlled experiments.”
- **Safety/evidence point:** Close with simulation, no real-money, and no production-readiness claims.
- **Fallback:** Use the README exact-results table and disclaimer if the app tab is unavailable.

## Optional Test Mode variation

Use this variation only after all of the following are true:

- a private complete `rzp_test_` key pair and known Test Mode payment are configured;
- `npm run smoke:test-mode:optional` returns `PASS` for one read-only payment fetch;
- the app starts with the **Razorpay Test Mode · No real money** badge;
- a manual pre-demo check finds no secret, short URL, customer data, console error, or unexpected provider call;
- the presenter accepts that the read-only smoke does not verify Payment Link create/fetch/cancel.

The current repository has no such evidence: live verification remains `NOT_RUN_CREDENTIALS_UNAVAILABLE`, with zero live Payment Links created. Therefore the default script above must remain the submission script.

If a credential holder later completes and records the prerequisites, replace only 10–15 seconds of the architecture segment with:

- **Page/control:** show the Test Mode badge and the sanitized read-only smoke result; do not expose the terminal environment or credentials.
- **Expected result:** `Razorpay Test Mode · No real money` and `READ_ONLY_PAYMENT_FETCH`, financial writes `0`.
- **Say:** “The same narrow port can use Razorpay Test Mode for a documented current-payment read. This is sandbox-only and does not prove the write flow.”
- **Fallback:** Revert immediately to Demo Mode. Never attempt an unrehearsed Test Mode write during judging.

Do not create a live Payment Link solely to make the demo look more integrated. Do not show a provider short URL, real customer data, or credentials.
