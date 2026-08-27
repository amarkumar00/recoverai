import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = process.cwd();
const directory = mkdtempSync(join(tmpdir(), "recoverai-production-smoke-"));
const databasePath = join(directory, "smoke.db");
const safeEnvironment = {
  ...process.env,
  APP_MODE: "demo",
  DATABASE_PATH: databasePath,
};
for (const key of Object.keys(safeEnvironment)) {
  if (
    key.startsWith("RAZORPAY_") ||
    key === "OPENAI_API_KEY" ||
    key === "ANTHROPIC_API_KEY"
  ) {
    delete safeEnvironment[key];
  }
}

const migrated = spawnSync(
  process.execPath,
  [resolve(root, "scripts/migrate-db.mjs")],
  {
    cwd: root,
    env: safeEnvironment,
    encoding: "utf8",
  },
);
if (migrated.status !== 0) {
  rmSync(directory, { recursive: true, force: true });
  throw new Error("Credential-free smoke database migration failed.");
}

const port = await availablePort();
const server = spawn(
  process.execPath,
  [
    resolve(root, "node_modules/next/dist/bin/next"),
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  { cwd: root, env: safeEnvironment, stdio: ["ignore", "pipe", "pipe"] },
);
let serverOutput = "";
server.stdout.setEncoding("utf8").on("data", (chunk) => {
  serverOutput += chunk;
});
server.stderr.setEncoding("utf8").on("data", (chunk) => {
  serverOutput += chunk;
});

try {
  await waitForServer(port, server);
  const pages = [
    ["/", "Payment failure recovery, with hard boundaries."],
    ["/events", "Live Event Stream"],
    ["/cases", "One recovery path, fully bounded."],
    ["/policy", "Policy Firewall"],
    ["/audit", "Tamper-Evident Audit Trail"],
    ["/evaluation", "Digital Twin Evaluation"],
  ];

  for (const [path, marker] of pages) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    const body = await response.text();
    if (!response.ok || !body.includes(marker)) {
      throw new Error(`Production page smoke failed for ${path}.`);
    }
    if (
      /rzp_(?:live|test)_[A-Za-z0-9]{8,}|https:\/\/rzp\.io\/|simulatedOutcomeByAction|groundTruthAllowedActions/.test(
        body,
      )
    ) {
      throw new Error(`Private or evaluator-only data reached ${path}.`);
    }
  }

  const unconfiguredWebhook = await fetch(
    `http://127.0.0.1:${port}/api/webhooks/razorpay`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    },
  );
  if (
    unconfiguredWebhook.status !== 503 ||
    JSON.stringify(await unconfiguredWebhook.json()) !==
      JSON.stringify({
        status: "ERROR_SAFE",
        resultCode: "WEBHOOK_NOT_CONFIGURED",
      })
  ) {
    throw new Error("Credential-free webhook did not fail safely.");
  }

  for (const path of [
    "/api/webhooks/razorpay",
    "/api/demo/scenarios/run",
    "/api/demo/scenarios/reset",
  ]) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    if (response.status !== 405) {
      throw new Error(`Unsupported HTTP method was not rejected for ${path}.`);
    }
  }

  if (/credential|secret|stack trace|unhandled/i.test(serverOutput)) {
    throw new Error(
      "Production smoke logs contained unsafe or unexpected failure text.",
    );
  }

  process.stdout.write(
    `${JSON.stringify({ status: "PASS", mode: "Demo Mode", credentials: false, pages: pages.length, externalFinancialCalls: 0 })}\n`,
  );
} finally {
  server.kill("SIGTERM");
  await new Promise((resolveExit) => {
    if (server.exitCode !== null) resolveExit();
    else server.once("exit", resolveExit);
  });
  rmSync(directory, { recursive: true, force: true });
}

function availablePort() {
  return new Promise((resolvePort, rejectPort) => {
    const listener = net.createServer();
    listener.on("error", rejectPort);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      const selected =
        typeof address === "object" && address !== null ? address.port : null;
      listener.close((error) => {
        if (error) rejectPort(error);
        else if (selected === null)
          rejectPort(new Error("Could not select a smoke-test port."));
        else resolvePort(selected);
      });
    });
  });
}

async function waitForServer(port, child) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error("Production server exited before smoke verification.");
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) return;
    } catch {
      // The bounded readiness poll continues until the server accepts requests.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("Production server did not become ready within 20 seconds.");
}
