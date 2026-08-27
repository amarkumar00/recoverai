import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const tracked = spawnSync("git", ["ls-files", "-z"], {
  cwd: root,
  encoding: "utf8",
});
if (tracked.status !== 0) {
  throw new Error("Unable to inspect the tracked repository file list.");
}

const trackedFiles = tracked.stdout.split("\0").filter(Boolean);
const prohibitedTrackedPath =
  /(^|\/)(node_modules|\.next|coverage)(\/|$)|(^|\/)data\/.*\.(db|sqlite)(-(wal|shm))?$/;
const prohibitedEnvironmentFile = /(^|\/)\.env(?:\..+)?$/;
const mergeMarker = /^(<{7}|={7}|>{7})(?:\s|$)/m;
const focusedOrSkippedTest = /\b(?:describe|it|test)\.(?:only|skip)\s*\(/;
const credentialShape = /\brzp_(?:live|test)_[A-Za-z0-9]{16,}\b/;
const failures = [];

for (const file of trackedFiles) {
  if (prohibitedTrackedPath.test(file)) {
    failures.push(`generated/private path is tracked: ${file}`);
  }
  if (prohibitedEnvironmentFile.test(file) && file !== ".env.example") {
    failures.push(`private environment file is tracked: ${file}`);
  }

  const content = readFileSync(join(root, file), "utf8");
  if (mergeMarker.test(content)) failures.push(`merge marker found: ${file}`);
  if (
    /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file) &&
    focusedOrSkippedTest.test(content)
  ) {
    failures.push(`focused or skipped test marker found: ${file}`);
  }
  if (credentialShape.test(content)) {
    failures.push(`credential-shaped value found: ${file}`);
  }
}

function walk(directory) {
  const files = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    const stats = statSync(path);
    if (stats.isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}

const clientBundle = join(root, ".next", "static");
try {
  for (const file of walk(clientBundle)) {
    const content = readFileSync(file, "utf8");
    if (
      /simulatedOutcomeByAction|groundTruthAllowedActions|groundTruthFailureClass/.test(
        content,
      )
    ) {
      failures.push(
        `evaluator-only field reached client output: ${relative(root, file)}`,
      );
    }
  }
} catch (error) {
  if (!(error instanceof Error) || !/ENOENT/.test(error.message)) throw error;
}

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`${failure}\n`);
  process.exit(1);
}

process.stdout.write(
  `${JSON.stringify({ status: "PASS", trackedFiles: trackedFiles.length, clientBundleChecked: statExists(clientBundle) })}\n`,
);

function statExists(path) {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}
