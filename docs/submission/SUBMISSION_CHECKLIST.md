# RecoverAI Submission Checklist

This checklist distinguishes verified repository evidence from release fields that only the project owner can supply. Do not replace `USER_SUPPLIED` with invented URLs, names, or legal terms.

## Repository readiness

- [x] Track 03 MVP scope matches `docs/RECOVERAI_SPEC.md`.
- [x] Judge-first README includes problem, solution, AI boundary, safety, architecture, exact simulated results, setup, verification, Test Mode status, limitations, references, and license status.
- [x] Focused architecture, setup, security, application, demo, and judge-Q&A documents exist.
- [x] Default Demo Mode is credential-free, deterministic, seeded, and reproducible.
- [x] Six dashboard pages and six fixed safety scenarios are documented.
- [x] All synthetic money and outcomes are labelled **simulated**.
- [x] Dataset fingerprint is `2065d1d50588ac7b8e8cf0782e7ae647c59bc02fedc71b856ca7c6d49f96ecdb`.
- [x] Golden JSON SHA-256 is `0405a6621ba88f362877907ba7dea1624643696b92907ef5f4b13cf9bf22f30c`.
- [x] Milestone 16 evidence states 652 passing tests across 51 files.
- [x] Live Test Mode status is `NOT_RUN_CREDENTIALS_UNAVAILABLE` and zero live Payment Links were created during verification.
- [x] No real-revenue, production-readiness, arbitrary retry, automatic capture, immutable-audit, real-LLM, Vulcan, or Live Mode success claim is made.
- [x] No machine-specific absolute path appears in public documentation.
- [x] No secret, credential, private database, dependency directory, build output, or Test Mode short URL is tracked.

## Required links — user-supplied release fields

- [ ] **Repository URL — `USER_SUPPLIED`:** add the final public repository URL.
- [ ] **Demo URL — `USER_SUPPLIED`:** add the deployed application URL only after Milestone 18 deployment and browser verification.
- [ ] **Pitch/video URL — `USER_SUPPLIED`:** add the final five-minute recording URL.
- [ ] **Buildathon application URL/ID — `USER_SUPPLIED`:** add the submission portal record if provided.
- [ ] Verify that each supplied URL is public to an incognito reviewer and is not a placeholder.

## Team information — user-supplied release fields

- [ ] **Team name — `USER_SUPPLIED`.**
- [ ] **Member names — `USER_SUPPLIED`.**
- [ ] **Member roles — `USER_SUPPLIED`.**
- [ ] **Contact email/phone required by the submission form — `USER_SUPPLIED`; do not commit private contact data unless intentionally public.**
- [ ] **Institution/company, city, or profile links if required — `USER_SUPPLIED`.**
- [ ] Confirm every contributor consents to the published information.

## License decision — user required

- [ ] **Choose a license or decide to keep the repository unlicensed — `USER_SUPPLIED LEGAL DECISION`.**
- [ ] If a license is chosen, add the exact approved license file and update the README.
- [ ] Do not describe the repository as MIT, Apache-licensed, or open source until that decision is explicit.

Current status: **no license has been selected**.

## Test Mode credentials and evidence

- [x] Test Mode credentials are optional and absent from normal CI/Demo Mode.
- [x] Live Mode keys and `NEXT_PUBLIC_` Razorpay secrets are rejected.
- [x] Optional smoke performs one read-only payment fetch and no Payment Link write.
- [x] Current live verification is recorded honestly as `NOT_RUN_CREDENTIALS_UNAVAILABLE`.
- [ ] **Optional:** credential owner supplies private Test Mode keys locally; never paste them into documentation, Git, recording, or submission forms.
- [ ] **Optional:** read-only Test Mode smoke returns `PASS` before any Test Mode demo variation.
- [ ] **Optional:** if a write flow is later tested, record exact sandbox evidence and link count without exposing IDs/short URLs; do not retroactively change the locked Milestone 17 evidence.

## Screenshots and presentation assets

- [x] Overview screenshot comes from a fresh deterministic Demo Mode database.
- [x] Policy-safety screenshot shows the real blocked ten-times amount scenario.
- [x] Evaluation screenshot shows the real locked baseline comparison.
- [x] Screenshots contain visible simulated/synthetic labels and no PII, secrets, local filesystem paths, or Test Mode short URLs.
- [x] README embeds optimized files with descriptive alt text.
- [ ] **Optional:** project owner adds a short GIF only if it remains readable, deterministic, and reasonably sized.

## Five-minute rehearsal

- [ ] Presenter rehearses the exact `DEMO_SCRIPT.md` sequence under five minutes.
- [ ] Reset is run immediately before rehearsal/recording.
- [ ] Duplicate and out-of-order scenarios display expected counters.
- [ ] Ten-times amount scenario stops at `INTENT_MONEY_INTEGRITY` with zero executor/link/contact effects.
- [ ] Primary simulated loop reaches `LINK_CREATED`, then terminal `RECOVERED` after the fixed paid event.
- [ ] Presenter says “simulated” with every financial result and correctly converts subunits to rupees.
- [ ] Presenter states the 43 unresolved/escalated outcomes and synthetic/AI/Test Mode limitations.
- [ ] Fallback tabs for README, golden report, and Judge Q&A are ready.

## Final verification before submission

- [ ] Pull/checkout the exact final candidate and run `npm ci`.
- [ ] Run `npm run check` with no credentials.
- [ ] Run `npm run evaluation:check` and verify exact equality.
- [ ] Run `shasum -a 256 docs/evaluation/golden-report.json` and confirm `0405a6621ba88f362877907ba7dea1624643696b92907ef5f4b13cf9bf22f30c`.
- [ ] Run the final repository secret/generated-artifact scan.
- [ ] Inspect `git status` and the staged file list.
- [ ] Confirm no `.env.local`, database/WAL/SHM file, `node_modules`, `.next`, coverage, credential, secret, short URL, or customer data is tracked.
- [ ] Confirm normal verification made zero live provider calls and created zero live Payment Links.
- [ ] **Final CI result — `USER/REMOTE-SUPPLIED`:** link the passing CI run after the final public push.

## Milestone 18 release fields — not part of Milestone 17

- [ ] Perform final desktop/mobile browser verification on the deployed public URL.
- [ ] Check deployed console/runtime logs and all six pages.
- [ ] Confirm signed-webhook and Demo Mode safe failure behavior in the deployment environment.
- [ ] Add the verified Demo URL to README/submission form.
- [ ] **Final release commit — `USER/RELEASE-SUPPLIED`:** record the release commit hash after any Milestone 18-only changes.
- [ ] **Final release tag — `USER/RELEASE-SUPPLIED`:** create only if the owner explicitly approves a tag.
- [ ] Push/publish only after explicit owner approval.

## Final application proofread

- [ ] Project title exactly matches **RecoverAI — Payment Failure Digital Twin & Bounded Recovery Agent**.
- [ ] Track is **Track 03 — AI Revenue Recovery**.
- [ ] Every headline metric matches the committed golden report.
- [ ] Root-cause accuracy says “on handcrafted synthetic fixtures.”
- [ ] The default scorer is described as a deterministic handcrafted mock/test double.
- [ ] Live Test Mode is not described as passed.
- [ ] No real merchant revenue or causal uplift is claimed.
- [ ] Repository, demo, video, team, and license fields contain user-approved final values.
