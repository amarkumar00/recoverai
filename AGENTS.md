# RecoverAI Repository Instructions

Before making changes, read `docs/RECOVERAI_SPEC.md` and `docs/ROADMAP.md`. Treat `docs/RECOVERAI_SPEC.md` as the product source of truth. If implementation conflicts with it, stop and surface the conflict rather than silently changing the product.

- Preserve the locked Track 03 RecoverAI MVP scope and its excluded features.
- Work only on the currently approved milestone. Never silently begin a later milestone.
- Inspect the workspace first, preserve user changes, and keep the project runnable.
- Test and verify every milestone before declaring it complete.
- Update `docs/ROADMAP.md` only after implementation and verification genuinely change a milestone's status.
- Preserve deterministic financial safety rules. AI may recommend only allowlisted actions and must never execute arbitrary financial actions.
- Keep default mock mode credential-free, seeded, reproducible, and deterministic.
- Label every synthetic financial result as **simulated**.
- Never invent undocumented Razorpay APIs, commit credentials, or use real-money transactions.
- Never claim production readiness, real recovered revenue, Razorpay Vulcan integration, or arbitrary failed-payment retries.
- Stop after completing and reporting the approved milestone, then wait for user approval.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
