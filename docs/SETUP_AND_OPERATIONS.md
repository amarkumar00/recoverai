# Setup and Operations

This guide covers the verified credential-free path first. Every Demo Mode financial value and result is **simulated**. Razorpay credentials are optional, Live Mode is rejected, and no external LLM credential is used.

## Prerequisites

- Node.js 22 or newer
- npm 10 or newer
- Git for clean-checkout verification

## Clean credential-free installation

From the repository root:

```bash
npm ci
cp .env.example .env.local
npm run db:migrate
npm run dev
```

Open <http://localhost:3000>. The copied environment file contains only safe Demo Mode defaults:

```dotenv
APP_MODE=demo
DATABASE_PATH=./data/recoverai.db
```

The application needs no Razorpay key, webhook secret, LLM key, prior database, or network call. `.env.local`, SQLite files, dependency directories, and build output are ignored by Git.

## Fresh database migration

Database schema is created only from committed migrations; application startup does not push or synthesize schema.

```bash
DATABASE_PATH=./data/recoverai-fresh.db npm run db:migrate
npm run db:check
```

The first command creates a new isolated local database. The second verifies fresh and upgraded migration consistency against the current schema.

## Development and production-like local run

Development server:

```bash
npm run dev
```

Production build and server:

```bash
npm run build
npm run start
```

The default URL is <http://localhost:3000>. The six pages are `/`, `/events`, `/cases`, `/policy`, `/audit`, and `/evaluation`.

## Reset the deterministic demo

Use the **Reset demo** control on `/cases`, confirm the dialog, and wait for the success message. The reset deletes only allowlisted demo operational fixtures and scenario projections. It preserves audit history, migrations, unknown records, evaluation runs, the committed golden report, and the locked dataset fingerprint.

The same reset can be called while the local app is running:

```bash
curl --fail-with-body --silent --show-error \
  --request POST http://localhost:3000/api/demo/scenarios/reset \
  --header 'Content-Type: application/json' \
  --data '{"confirmation":"RESET_DETERMINISTIC_DEMO"}'
```

The route accepts no identifier or table name and works only when `APP_MODE=demo`.

## Reproduce the held-out simulated evaluation

```bash
npm run evaluation:check
```

This runs the focused evaluation suite. It regenerates the locked report in memory, validates strict schemas and formulas, and requires exact equality with `docs/evaluation/golden-report.json`.

Expected locks:

- 100 synthetic payments, 112 unique events, 125 deliveries, 13 duplicates
- dataset fingerprint `2065d1d50588ac7b8e8cf0782e7ae647c59bc02fedc71b856ca7c6d49f96ecdb`
- golden JSON SHA-256 `0405a6621ba88f362877907ba7dea1624643696b92907ef5f4b13cf9bf22f30c`

No hidden outcome is available to the scorer before the final action is fixed. No credential, network request, live provider operation, customer message, or real financial action is used.

## Complete verification

Run the full credential-free sequence:

```bash
npm run check
```

It executes:

1. documentation links, required assets, evidence locks, and public-claim checks;
2. formatting;
3. lint;
4. strict TypeScript checking;
5. fresh/upgraded migration consistency;
6. held-out dataset and golden-report integrity;
7. the complete deterministic test suite;
8. production build;
9. high-severity production dependency audit;
10. repository/generated-client hygiene; and
11. a six-page credential-free production HTTP smoke.

Individual commands remain available:

```bash
npm run docs:check
npm run format:check
npm run lint
npm run typecheck
npm run db:check
npm run integrity:check
npm test
npm run build
npm run audit:dependencies
npm run hygiene:check
npm run smoke:production
```

At the Milestone 16 evidence lock, 652 tests across 51 files passed. The verification matrix is in [`VERIFICATION_MATRIX.md`](VERIFICATION_MATRIX.md).

## Public webhook configuration

Demo Mode remains usable without a webhook secret. In that state, `POST /api/webhooks/razorpay` returns the fixed safe code `WEBHOOK_NOT_CONFIGURED` and does not initialize ingestion.

To test the signature boundary locally, place only a private server-side secret in `.env.local`:

```dotenv
RAZORPAY_WEBHOOK_SECRET=replace_with_local_test_webhook_secret
```

Razorpay documents `X-Razorpay-Signature` as HMAC-SHA256 using the webhook secret as key and the exact raw request body as message. It documents `x-razorpay-event-id` as the event identity for duplicate handling. See [Validate and Test Webhooks](https://razorpay.com/docs/webhooks/validate-test/).

The route never accepts normalized or re-serialized JSON as a substitute for the signed body. Do not put the webhook secret in a `NEXT_PUBLIC_` variable or commit it.

## Optional Razorpay Test Mode

### Evidence status

- Adapter implementation: present and covered by deterministic contract tests.
- Live verification: `NOT_RUN_CREDENTIALS_UNAVAILABLE`.
- Live Payment Links created during verification: 0.
- Normal CI and Demo Mode external financial calls: 0.

Test Mode is optional sandbox behavior and does not move real money. It must not be presented as a passed live flow until a credential holder performs and records a controlled check.

### Private configuration

Add private values only to ignored `.env.local`:

```dotenv
APP_MODE=razorpay_test
DATABASE_PATH=./data/recoverai.db
RAZORPAY_TEST_KEY_ID=rzp_test_replace_with_local_key_id
RAZORPAY_TEST_KEY_SECRET=replace_with_local_test_key_secret
RAZORPAY_WEBHOOK_SECRET=replace_with_local_test_webhook_secret
RAZORPAY_TEST_PAYMENT_ID=pay_replace_with_known_test_payment
RECOVERAI_ALLOW_TEST_MODE_WRITES=false
```

Rules enforced by the environment boundary:

- A complete key ID/secret pair is required for `APP_MODE=razorpay_test`.
- `rzp_live_` key IDs are rejected.
- Razorpay secrets in `NEXT_PUBLIC_` variables are rejected.
- Reads are allowed with valid Test Mode configuration; writes require a separate explicit boolean.
- The UI exposes only `Demo Mode` or `Razorpay Test Mode`, never secrets.

### Read-only connectivity smoke

With the three private read values configured, run:

```bash
npm run smoke:test-mode:optional
```

The script rejects Live Mode, fetches one fixed payment by ID, creates no Payment Link, performs no cancellation, and prints a machine-readable result. Without credentials it exits successfully with `MISSING_OPTIONAL_TEST_MODE_CREDENTIALS`.

This read-only smoke does **not** prove the end-to-end Test Mode Payment Link flow. Do not switch a demo to live Test Mode based on unverified credentials or immediately before judging.

### Optional controlled writes

The adapter contains create/fetch/cancel capability for a bounded Standard Payment Link, but no live write was run during repository verification. If the owner deliberately performs a later sandbox-only check:

1. Create or identify a small known Test Mode payment in the Razorpay Dashboard.
2. Run migrations and complete the read-only smoke first.
3. Set `RECOVERAI_ALLOW_TEST_MODE_WRITES=true` only for the controlled check.
4. Accept that the local database permits at most three unique Test Mode link-creation attempts; timeouts consume an attempt.
5. Never retry an uncertain write automatically.
6. Cancel only a fetched link still in `created` state with zero paid amount.
7. Return the write flag to `false` and remove private values after the check.

The implementation sends trusted amount/currency and a stable reference, disables partial payments, notification, and reminders, omits customer contact fields, and does not persist or expose the returned short URL.

Official endpoints implemented by the adapter:

- [Fetch payment by ID](https://razorpay.com/docs/api/payments/fetch-with-id/)
- [Fetch payment downtime details](https://razorpay.com/docs/api/payments/downtime/fetch-all/)
- [Create a Standard Payment Link](https://razorpay.com/docs/api/payments/payment-links/create-standard/)
- [Fetch a Standard Payment Link](https://razorpay.com/docs/api/payments/payment-links/fetch-id-standard/)
- [Cancel a Standard Payment Link](https://razorpay.com/docs/api/payments/payment-links/cancel-standard/)

RecoverAI does not represent the Payments API as arbitrary failed-payment recollection. Razorpay states that the Payments API can fetch payment details or move an authorized payment to captured; it is not used here to collect a failed payment. RecoverAI implements no automatic capture.

## Clean-checkout verification

To reproduce the documented credential-free path without altering the working repository, use a temporary clone of the local Git repository:

```bash
CHECKOUT_DIR="$(mktemp -d)"
git clone --no-local . "$CHECKOUT_DIR/recoverai"
cd "$CHECKOUT_DIR/recoverai"
npm ci
npm run check
```

The verification needs no `.env` file, credentials, existing database, build output, or dependency directory. Remove only the temporary directory after inspection.

## Safe operating boundaries

- Do not use real merchant/customer data.
- Do not enable Live Mode; it is unsupported and rejected.
- Do not treat simulated rupee values as recovered merchant revenue.
- Do not replay a provider write whose outcome is unknown.
- Do not manually modify the audit chain or local anchor.
- Do not expose Test Mode short URLs, secrets, raw payloads, customer contact details, or hidden evaluator fixtures.
- Do not claim an external LLM, Vulcan integration, automatic capture, arbitrary original-payment retry, refunds, subscriptions, customer messaging, or production readiness.
