import { createSqliteAuditChain } from "@/audit";
import { createLocalDatabase } from "@/lib/db/client";

const [, , databasePath, indexText, startText] = process.argv;
if (
  databasePath === undefined ||
  indexText === undefined ||
  startText === undefined
) {
  throw new Error(
    "Concurrent audit worker requires database, index, and start arguments.",
  );
}

const index = Number(indexText);
const startAt = Number(startText);
if (!Number.isInteger(index) || !Number.isFinite(startAt)) {
  throw new Error(
    "Concurrent audit worker received invalid numeric arguments.",
  );
}

const waitArray = new Int32Array(new SharedArrayBuffer(4));
while (Date.now() < startAt) {
  Atomics.wait(waitArray, 0, 0, Math.min(startAt - Date.now(), 25));
}

const database = createLocalDatabase(databasePath);
try {
  const result = createSqliteAuditChain(database).append({
    entryId: `audit_concurrent_${index}`,
    timestamp: `2026-08-25T12:00:0${index}.000Z`,
    actor: "AUDIT_SYSTEM",
    inputReference: `case_concurrent_${index}`,
    eventType: "CONCURRENT_APPEND_TESTED",
    reason: `Concurrent writer ${index} recorded a safe event.`,
    previousState: null,
    newState: null,
    metadata: { isSynthetic: true, checkCount: index },
  });
  process.stdout.write(JSON.stringify(result));
} finally {
  database.client.close();
}
