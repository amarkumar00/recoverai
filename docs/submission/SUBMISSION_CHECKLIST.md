# RecoverAI Submission Checklist

This checklist distinguishes verified repository evidence from fields that remain owner-supplied. Mark release fields complete only when the owner provides exact values and they are verified; never invent pending URLs or private information.

## Repository readiness

- [x] Track 03 MVP scope matches `docs/RECOVERAI_SPEC.md`.
- [x] Judge-first README includes problem, solution, AI boundary, safety, architecture, exact simulated results, setup, verification, Test Mode status, limitations, references, deployment evidence, team information, and license.
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

## Required links — owner-supplied release fields

- [x] **Repository URL:** <https://github.com/amarkumar00/recoverai>
- [x] **Demo URL:** <https://recoverai-production-6446.up.railway.app/>
- [ ] **Pitch/video URL — owner supplied:** add the final five-minute recording URL.
- [ ] **Buildathon application URL/ID — owner supplied:** add the submission portal record if provided.
- [x] Repository and demo URLs were verified publicly without login and are not placeholders.

## Team information — owner-supplied release fields

- [x] **Team name:** RecoverAI.
- [x] **Member:** Amar Kumar.
- [x] **Team size:** Solo.
- [x] **Role:** Solo Builder — Full-stack Engineer & Product Designer.
- [ ] **Private contact email/phone required by the submission form — owner supplied:** do not commit private contact data unless intentionally public.
- [ ] **Institution, city, or private profile information if required — owner supplied.**
- [x] The solo builder explicitly approved the public team information above.

## License decision

- [x] **Owner-approved license:** MIT License.
- [x] Root `LICENSE` contains the standard MIT text and `Copyright (c) 2026 Amar Kumar`.
- [x] README accurately links to and describes the MIT License.

Current status: **MIT License approved and added**.

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

- [x] Local presenter rehearsal followed the exact `DEMO_SCRIPT.md` sequence in 4 minutes 7 seconds.
- [x] Reset was run immediately before the successful local rehearsal.
- [x] Duplicate and out-of-order scenarios displayed expected counters.
- [x] Ten-times amount scenario stopped at `INTENT_MONEY_INTEGRITY` with zero executor/link/contact effects.
- [x] Primary simulated loop reached `LINK_CREATED`, then terminal `RECOVERED` after the fixed paid event.
- [x] Local rehearsal used “simulated” with every financial result and correctly converted subunits to rupees.
- [x] Local rehearsal stated the 43 unresolved/escalated outcomes and synthetic/AI/Test Mode limitations.
- [x] README, golden report, and Judge Q&A fallback evidence was ready.

The rehearsal above is local Phase A evidence. It is not a hosted recording or public video URL.

## Final verification before submission

- [x] Check out the exact local Phase A candidate in an isolated clone and run `npm ci`.
- [x] Run `npm run check` with no credentials.
- [x] Run `npm run evaluation:check` and verify exact equality.
- [x] Run `shasum -a 256 docs/evaluation/golden-report.json` and confirm `0405a6621ba88f362877907ba7dea1624643696b92907ef5f4b13cf9bf22f30c`.
- [x] Run the local Phase A repository secret/generated-artifact scan.
- [x] Inspect `git status` and the staged file list.
- [x] Confirm no `.env.local`, database/WAL/SHM file, `node_modules`, `.next`, coverage, credential, secret, short URL, or customer data is tracked.
- [x] Confirm normal verification made zero live provider calls and created zero live Payment Links.
- [ ] **Final CI result — `USER/REMOTE-SUPPLIED`:** link the passing CI run after the final public push.

## Milestone 18 release fields — not part of Milestone 17

- [x] Complete local Phase A browser verification across all six pages at desktop, tablet, and mobile widths.
- [x] Verify local production runtime logs, console output, keyboard focus, reduced motion, and deterministic scenario resets.
- [x] Replace the policy-safety screenshot with the corrected deterministic Demo Mode evidence.
- [x] Phase B4 verified desktop, tablet, and 390px mobile layouts on the deployed public URL.
- [x] Phase B4 checked deployed browser console, Railway runtime logs, and all six judge-facing pages.
- [x] The unconfigured signed-webhook boundary returned `WEBHOOK_NOT_CONFIGURED` with no downstream effect; Demo Mode scenarios failed safely where expected.
- [x] Verified public Demo and GitHub URLs are present in README and application copy.
- [ ] **Phase B5 release-documentation commit:** record the exact commit and final CI run in the Phase B5 completion report.
- [ ] **Final release tag:** create only after the owner supplies the pitch/video URL and explicitly approves the final tag phase.
- [x] Phase B5 documentation commit and normal push were explicitly owner-approved; force-push and history rewriting remain prohibited.

## Final application proofread

- [x] Project title exactly matches **RecoverAI — Payment Failure Digital Twin & Bounded Recovery Agent**.
- [x] Track is **Track 03 — AI Revenue Recovery**.
- [x] Every headline metric matches the committed golden report.
- [x] Root-cause accuracy says “on handcrafted synthetic fixtures.”
- [x] The default scorer is described as a deterministic handcrafted mock/test double.
- [x] Live Test Mode is not described as passed.
- [x] No real merchant revenue or causal uplift is claimed.
- [x] Repository, demo, team, and license fields contain owner-approved final values.
- [ ] Pitch/video URL and Buildathon application URL/ID remain pending owner-supplied values.
