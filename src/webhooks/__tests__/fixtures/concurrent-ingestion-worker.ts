import { createSqliteAuditChain } from "@/audit";
import { createLocalDatabase } from "@/lib/db/client";
import { createSqliteRepositories } from "@/repositories";
import {
  SecureRazorpayWebhookIngestor,
  VerifiedWebhookAuditProcessor,
} from "@/webhooks";

const [
  ,
  ,
  databasePath,
  rawBodyBase64,
  signature,
  providerEventId,
  webhookSecret,
  receivedAt,
  startText,
] = process.argv;

if (
  databasePath === undefined ||
  rawBodyBase64 === undefined ||
  signature === undefined ||
  providerEventId === undefined ||
  webhookSecret === undefined ||
  receivedAt === undefined ||
  startText === undefined
) {
  throw new Error("Concurrent ingestion worker received incomplete input.");
}

const startAt = Number(startText);
if (!Number.isFinite(startAt)) {
  throw new Error(
    "Concurrent ingestion worker received an invalid start time.",
  );
}

const workerInput = {
  databasePath,
  rawBodyBase64,
  signature,
  providerEventId,
  webhookSecret,
  receivedAt,
};

async function main() {
  const database = createLocalDatabase(workerInput.databasePath);
  try {
    const waitArray = new Int32Array(new SharedArrayBuffer(4));
    while (Date.now() < startAt) {
      Atomics.wait(waitArray, 0, 0, Math.min(startAt - Date.now(), 25));
    }

    const repositories = createSqliteRepositories(database);
    const ingestor = new SecureRazorpayWebhookIngestor({
      repositories,
      processor: new VerifiedWebhookAuditProcessor(
        createSqliteAuditChain(database),
      ),
    });
    const result = await ingestor.ingest({
      rawBody: Buffer.from(workerInput.rawBodyBase64, "base64"),
      signature: workerInput.signature,
      providerEventId: workerInput.providerEventId,
      webhookSecret: workerInput.webhookSecret,
      receivedAt: workerInput.receivedAt,
    });
    process.stdout.write(JSON.stringify({ status: result.status }));
  } finally {
    database.client.close();
  }
}

void main();
