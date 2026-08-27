import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";

const root = process.cwd();
const requiredDocuments = [
  "README.md",
  "docs/ARCHITECTURE.md",
  "docs/SETUP_AND_OPERATIONS.md",
  "docs/SECURITY_AND_LIMITATIONS.md",
  "docs/submission/APPLICATION.md",
  "docs/submission/DEMO_SCRIPT.md",
  "docs/submission/JUDGE_QA.md",
  "docs/submission/SUBMISSION_CHECKLIST.md",
];
const requiredScreenshots = [
  "docs/assets/screenshots/overview.jpg",
  "docs/assets/screenshots/policy-safety.jpg",
  "docs/assets/screenshots/evaluation.jpg",
];
const publicDocuments = [
  ...requiredDocuments,
  "docs/evaluation/GOLDEN_REPORT.md",
];
const failures = [];

for (const file of [...requiredDocuments, ...requiredScreenshots]) {
  if (!existsSync(join(root, file)))
    failures.push(`required file missing: ${file}`);
}

for (const file of publicDocuments) {
  if (!existsSync(join(root, file))) continue;
  const content = readFileSync(join(root, file), "utf8");
  checkLocalLinks(file, content);
  if (/\/Users\/|\/var\/folders\/|file:\/\//.test(content)) {
    failures.push(`machine-specific path found: ${file}`);
  }
  if (
    /\]\(https?:\/\/(?:example\.com|example\.org|localhost)(?:\/|\))/.test(
      content,
    )
  ) {
    failures.push(`placeholder URL is presented as a link: ${file}`);
  }
}

const readme = readFileSync(join(root, "README.md"), "utf8");
for (const value of [
  "100 held-out synthetic payments",
  "112 unique provider events",
  "125 deliveries",
  "13 duplicate deliveries",
  "INR 11,883,796 subunits",
  "₹118,837.96 simulated",
  "INR 4,784,383 subunits",
  "₹47,843.83 simulated",
  "INR 5,526,332 subunits",
  "₹55,263.32 simulated",
  "INR +741,949 subunits",
  "₹7,419.49 simulated",
  "100% on handcrafted synthetic fixtures",
  "NOT_RUN_CREDENTIALS_UNAVAILABLE",
  "652 tests across 51 files",
  "No license has been selected",
]) {
  if (!readme.includes(value))
    failures.push(`README evidence lock missing: ${value}`);
}

const datasetFingerprint =
  "2065d1d50588ac7b8e8cf0782e7ae647c59bc02fedc71b856ca7c6d49f96ecdb";
const goldenSha =
  "0405a6621ba88f362877907ba7dea1624643696b92907ef5f4b13cf9bf22f30c";
for (const file of [
  "README.md",
  "docs/ARCHITECTURE.md",
  "docs/submission/APPLICATION.md",
]) {
  const content = readFileSync(join(root, file), "utf8");
  if (!content.includes(datasetFingerprint)) {
    failures.push(`dataset fingerprint missing from ${file}`);
  }
  if (!content.includes(goldenSha)) {
    failures.push(`golden report SHA-256 missing from ${file}`);
  }
}

const goldenPath = join(root, "docs/evaluation/golden-report.json");
const goldenBytes = readFileSync(goldenPath);
const actualGoldenSha = createHash("sha256").update(goldenBytes).digest("hex");
if (actualGoldenSha !== goldenSha) {
  failures.push(`golden report SHA-256 changed: ${actualGoldenSha}`);
}
const golden = JSON.parse(goldenBytes.toString("utf8"));
const result = golden.result;
const exactFields = {
  uniqueCaseCount: 100,
  uniqueProviderEventCount: 112,
  eventDeliveryCount: 125,
  duplicateDeliveryCount: 13,
  recoverAiRecoveredCaseCount: 42,
  rootCauseAccuracy: 1,
  actionSelectionAccuracy: 0.95,
  unsafeActionsBlocked: 19,
  customerContactsAvoided: 69,
  humanEscalationRate: 0.19,
  unresolvedExceptionCount: 43,
};
for (const [field, expected] of Object.entries(exactFields)) {
  if (result[field] !== expected) {
    failures.push(`golden report lock changed: ${field}`);
  }
}
if (result.datasetFingerprintSha256 !== datasetFingerprint) {
  failures.push("golden report dataset fingerprint changed");
}
if (result.simulatedRevenueInitiallyAtRisk.amountSubunits !== 11_883_796) {
  failures.push("golden report initial-at-risk amount changed");
}
if (result.baselineSimulatedRecovery.amountSubunits !== 4_784_383) {
  failures.push("golden report baseline amount changed");
}
if (result.recoverAiSimulatedRecovery.amountSubunits !== 5_526_332) {
  failures.push("golden report RecoverAI amount changed");
}
if (result.incrementalSimulatedRecovery.subunitDelta !== 741_949) {
  failures.push("golden report incremental amount changed");
}
if (result.falsePositiveInterventionCostSimulated.amountSubunits !== 3_436) {
  failures.push("golden report false-positive cost changed");
}

const architecture = readFileSync(join(root, "docs/ARCHITECTURE.md"), "utf8");
for (const [file, content, minimumMermaidBlocks] of [
  ["README.md", readme, 1],
  ["docs/ARCHITECTURE.md", architecture, 2],
]) {
  const openingCount = (content.match(/```mermaid\n/g) ?? []).length;
  const fenceCount = (content.match(/^```/gm) ?? []).length;
  if (openingCount < minimumMermaidBlocks || fenceCount % 2 !== 0) {
    failures.push(`Mermaid/code fences are incomplete in ${file}`);
  }
}
for (const phrase of [
  "Raw-body HMAC",
  "Event-ID deduplication",
  "Current-state reconciliation",
  "Deterministic diagnosis",
  "Bounded AI ranking",
  "Deterministic policy firewall",
  "Idempotent action executor",
  "Tamper-evident audit",
  "Evaluator-only",
]) {
  if (
    !`${readme}\n${architecture}`.toLowerCase().includes(phrase.toLowerCase())
  ) {
    failures.push(`architecture flow phrase missing: ${phrase}`);
  }
}

for (const file of requiredScreenshots) {
  const path = join(root, file);
  if (!existsSync(path)) continue;
  const bytes = readFileSync(path);
  const jpegSignature = "ffd8ff";
  if (bytes.subarray(0, 3).toString("hex") !== jpegSignature) {
    failures.push(`screenshot is not a JPEG: ${file}`);
  }
  if (statSync(path).size > 2_000_000) {
    failures.push(`screenshot exceeds 2 MB: ${file}`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`${failure}\n`);
  process.exit(1);
}

process.stdout.write(
  `${JSON.stringify({ status: "PASS", documents: requiredDocuments.length, screenshots: requiredScreenshots.length, relativeLinks: "VALID", goldenSha256: actualGoldenSha })}\n`,
);

function checkLocalLinks(file, content) {
  const linkPattern = /!?\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of content.matchAll(linkPattern)) {
    const destination = match[1].trim().replace(/^<|>$/g, "");
    if (
      destination.startsWith("http://") ||
      destination.startsWith("https://") ||
      destination.startsWith("mailto:") ||
      destination.startsWith("#")
    ) {
      continue;
    }
    const withoutAnchor = destination.split("#", 1)[0];
    if (withoutAnchor.length === 0) continue;
    const decoded = decodeURIComponent(withoutAnchor);
    const candidate = normalize(resolve(root, dirname(file), decoded));
    if (!candidate.startsWith(`${root}/`) || !existsSync(candidate)) {
      failures.push(`broken relative link in ${file}: ${destination}`);
    }
    if (extname(candidate) === ".md" && !existsSync(candidate)) {
      failures.push(`missing Markdown target in ${file}: ${destination}`);
    }
  }
}
