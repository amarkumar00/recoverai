import type Database from "better-sqlite3";

import {
  AUDIT_CHAIN_IDENTITY,
  AUDIT_CHAIN_VERSION,
  auditAppendCommandSchema,
  auditChainCheckpointSchema,
  privacySafeAuditMetadataSchema,
  type AuditAppendResult,
  type AuditChainCheckpoint,
  type AuditVerificationIssueCode,
  type AuditVerificationResult,
} from "@/audit/contracts";
import {
  commandMatchesEntry,
  createAuditEntry,
  hashAuditPreimage,
  safeHashEqual,
} from "@/audit/hash-chain";
import { auditEntrySchema, type AuditEntry } from "@/domain/audit";
import type { LocalDatabase } from "@/lib/db/client";

type StoredAuditRow = {
  sequence: number;
  entry_id: string;
  timestamp: string;
  actor: string;
  input_reference: string;
  event_type: string;
  reason: string;
  previous_state: string | null;
  new_state: string | null;
  previous_hash: string | null;
  current_hash: string;
  metadata_json: string;
};

type StoredChainState = {
  chain_identity: string;
  chain_version: string;
  entry_count: number;
  last_sequence: number;
  head_hash: string | null;
};

function invalid(
  issue: AuditVerificationIssueCode,
  sequence?: number,
): AuditVerificationResult {
  return sequence === undefined
    ? { status: "INVALID", issue }
    : { status: "INVALID", issue, sequence };
}

function loadCheckpoint(
  sqlite: Database.Database,
): AuditChainCheckpoint | null {
  const row = sqlite
    .prepare(
      "SELECT chain_identity, chain_version, entry_count, last_sequence, head_hash FROM audit_chain_state WHERE chain_identity = ?",
    )
    .get(AUDIT_CHAIN_IDENTITY) as StoredChainState | undefined;
  if (row === undefined) return null;
  return (
    auditChainCheckpointSchema.safeParse({
      chainIdentity: row.chain_identity,
      chainVersion: row.chain_version,
      entryCount: row.entry_count,
      lastSequence: row.last_sequence,
      headHash: row.head_hash,
    }).data ?? null
  );
}

function loadRows(sqlite: Database.Database): StoredAuditRow[] {
  return sqlite
    .prepare(
      "SELECT sequence, entry_id, timestamp, actor, input_reference, event_type, reason, previous_state, new_state, previous_hash, current_hash, metadata_json FROM audit_entries ORDER BY sequence ASC",
    )
    .all() as StoredAuditRow[];
}

function parseRow(row: StoredAuditRow): {
  entry?: AuditEntry;
  issue?: "STORED_METADATA_INVALID" | "ENTRY_SCHEMA_INVALID";
} {
  let metadata: unknown;
  try {
    metadata = JSON.parse(row.metadata_json);
  } catch {
    return { issue: "STORED_METADATA_INVALID" };
  }
  const metadataResult = privacySafeAuditMetadataSchema.safeParse(metadata);
  if (!metadataResult.success) return { issue: "STORED_METADATA_INVALID" };
  const result = auditEntrySchema.safeParse({
    sequence: row.sequence,
    entryId: row.entry_id,
    timestamp: row.timestamp,
    actor: row.actor,
    inputReference: row.input_reference,
    eventType: row.event_type,
    reason: row.reason,
    previousState: row.previous_state,
    newState: row.new_state,
    previousHash: row.previous_hash,
    currentHash: row.current_hash,
    metadata: metadataResult.data,
  });
  if (!result.success) return { issue: "ENTRY_SCHEMA_INVALID" };
  const commandResult = auditAppendCommandSchema.safeParse({
    entryId: result.data.entryId,
    timestamp: result.data.timestamp,
    actor: result.data.actor,
    inputReference: result.data.inputReference,
    eventType: result.data.eventType,
    reason: result.data.reason,
    previousState: result.data.previousState,
    newState: result.data.newState,
    metadata: result.data.metadata,
  });
  return commandResult.success
    ? { entry: result.data }
    : { issue: "ENTRY_SCHEMA_INVALID" };
}

function verifyInternal(
  sqlite: Database.Database,
  retainedCheckpoint?: AuditChainCheckpoint,
): AuditVerificationResult {
  const rawState = sqlite
    .prepare(
      "SELECT chain_identity, chain_version, entry_count, last_sequence, head_hash FROM audit_chain_state WHERE chain_identity = ?",
    )
    .get(AUDIT_CHAIN_IDENTITY) as StoredChainState | undefined;
  if (rawState === undefined) return invalid("CHAIN_STATE_MISSING");
  if (
    rawState.chain_version !== AUDIT_CHAIN_VERSION ||
    rawState.chain_identity !== AUDIT_CHAIN_IDENTITY
  )
    return invalid("CHAIN_VERSION_MISMATCH");
  const checkpointResult = auditChainCheckpointSchema.safeParse({
    chainIdentity: rawState.chain_identity,
    chainVersion: rawState.chain_version,
    entryCount: rawState.entry_count,
    lastSequence: rawState.last_sequence,
    headHash: rawState.head_hash,
  });
  if (!checkpointResult.success) return invalid("HEAD_COUNT_MISMATCH");

  const rows = loadRows(sqlite);
  const seenEntryIds = new Set<string>();
  let expectedPreviousHash: string | null = null;
  let finalHash: string | null = null;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    const parsed = parseRow(row);
    if (parsed.issue !== undefined) return invalid(parsed.issue, row.sequence);
    const entry = parsed.entry!;
    if (seenEntryIds.has(entry.entryId))
      return invalid("ENTRY_ID_DUPLICATE", entry.sequence);
    seenEntryIds.add(entry.entryId);
    const expectedSequence = index + 1;
    if (entry.sequence !== expectedSequence)
      return invalid("SEQUENCE_GAP", entry.sequence);
    if (expectedSequence === 1 && entry.previousHash !== null)
      return invalid("GENESIS_PREVIOUS_HASH_INVALID", entry.sequence);
    if (
      expectedSequence > 1 &&
      (entry.previousHash === null ||
        expectedPreviousHash === null ||
        !safeHashEqual(entry.previousHash, expectedPreviousHash))
    ) {
      return invalid("PREVIOUS_HASH_MISMATCH", entry.sequence);
    }
    const recomputed = hashAuditPreimage({
      chainVersion: AUDIT_CHAIN_VERSION,
      chainIdentity: AUDIT_CHAIN_IDENTITY,
      sequence: entry.sequence,
      entryId: entry.entryId,
      timestamp: entry.timestamp,
      actor: entry.actor,
      inputReference: entry.inputReference,
      eventType: entry.eventType,
      reason: entry.reason,
      previousState: entry.previousState,
      newState: entry.newState,
      previousHash: entry.previousHash,
      metadata: entry.metadata,
    });
    if (!safeHashEqual(entry.currentHash, recomputed))
      return invalid("CURRENT_HASH_MISMATCH", entry.sequence);
    expectedPreviousHash = entry.currentHash;
    finalHash = entry.currentHash;
  }

  const checkpoint = checkpointResult.data;
  if (
    checkpoint.entryCount !== rows.length ||
    checkpoint.lastSequence !== rows.length
  )
    return invalid("HEAD_COUNT_MISMATCH");
  if (
    (checkpoint.headHash === null) !== (finalHash === null) ||
    (checkpoint.headHash !== null &&
      finalHash !== null &&
      !safeHashEqual(checkpoint.headHash, finalHash))
  )
    return invalid("HEAD_HASH_MISMATCH");
  if (retainedCheckpoint !== undefined) {
    const retained = auditChainCheckpointSchema.safeParse(retainedCheckpoint);
    const retainedHeadMatches =
      retained.success &&
      ((retained.data.headHash === null && checkpoint.headHash === null) ||
        (retained.data.headHash !== null &&
          checkpoint.headHash !== null &&
          safeHashEqual(retained.data.headHash, checkpoint.headHash)));
    if (
      !retained.success ||
      retained.data.entryCount !== checkpoint.entryCount ||
      retained.data.lastSequence !== checkpoint.lastSequence ||
      !retainedHeadMatches
    ) {
      return invalid("CHECKPOINT_MISMATCH");
    }
  }
  return { status: "VALID", checkpoint };
}

export class SqliteAuditChain {
  readonly #sqlite: Database.Database;

  constructor(database: Pick<LocalDatabase, "client">) {
    this.#sqlite = database.client;
  }

  append(rawCommand: unknown): AuditAppendResult {
    const command = auditAppendCommandSchema.parse(rawCommand);
    const operation = this.#sqlite.transaction((): AuditAppendResult => {
      const verification = verifyInternal(this.#sqlite);
      if (verification.status === "INVALID") return { status: "CHAIN_CORRUPT" };
      const checkpoint = verification.checkpoint;
      const existingRow = this.#sqlite
        .prepare(
          "SELECT sequence, entry_id, timestamp, actor, input_reference, event_type, reason, previous_state, new_state, previous_hash, current_hash, metadata_json FROM audit_entries WHERE entry_id = ?",
        )
        .get(command.entryId) as StoredAuditRow | undefined;
      if (existingRow !== undefined) {
        const parsed = parseRow(existingRow);
        if (parsed.entry === undefined) return { status: "CHAIN_CORRUPT" };
        return commandMatchesEntry(command, parsed.entry)
          ? { status: "IDEMPOTENT_REPLAY", entry: parsed.entry, checkpoint }
          : { status: "ENTRY_ID_CONFLICT" };
      }

      const entry = createAuditEntry(
        command,
        checkpoint.entryCount + 1,
        checkpoint.headHash,
      );
      this.#sqlite
        .prepare(
          "INSERT INTO audit_entries (sequence, entry_id, timestamp, actor, input_reference, event_type, reason, previous_state, new_state, previous_hash, current_hash, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          entry.sequence,
          entry.entryId,
          entry.timestamp,
          entry.actor,
          entry.inputReference,
          entry.eventType,
          entry.reason,
          entry.previousState,
          entry.newState,
          entry.previousHash,
          entry.currentHash,
          JSON.stringify(entry.metadata),
        );
      const update = this.#sqlite
        .prepare(
          "UPDATE audit_chain_state SET entry_count = ?, last_sequence = ?, head_hash = ? WHERE chain_identity = ? AND chain_version = ? AND entry_count = ? AND ((head_hash IS NULL AND ? IS NULL) OR head_hash = ?)",
        )
        .run(
          entry.sequence,
          entry.sequence,
          entry.currentHash,
          AUDIT_CHAIN_IDENTITY,
          AUDIT_CHAIN_VERSION,
          checkpoint.entryCount,
          checkpoint.headHash,
          checkpoint.headHash,
        );
      if (update.changes !== 1) throw new Error("AUDIT_HEAD_UPDATE_CONFLICT");
      const nextCheckpoint = loadCheckpoint(this.#sqlite);
      if (nextCheckpoint === null)
        throw new Error("AUDIT_HEAD_INVALID_AFTER_UPDATE");
      return { status: "APPENDED", entry, checkpoint: nextCheckpoint };
    });

    try {
      return operation.immediate();
    } catch {
      return { status: "CHAIN_CORRUPT" };
    }
  }

  verify(retainedCheckpoint?: AuditChainCheckpoint): AuditVerificationResult {
    return verifyInternal(this.#sqlite, retainedCheckpoint);
  }

  checkpoint(): AuditChainCheckpoint | null {
    return loadCheckpoint(this.#sqlite);
  }

  readOrdered(): AuditEntry[] {
    const verification = verifyInternal(this.#sqlite);
    if (verification.status === "INVALID") {
      throw new Error(
        `Stored audit chain failed verification: ${verification.issue}.`,
      );
    }
    return loadRows(this.#sqlite).map((row) => {
      const parsed = parseRow(row);
      if (parsed.entry === undefined)
        throw new Error(
          `Stored audit entry ${row.sequence} failed validation.`,
        );
      return parsed.entry;
    });
  }
}

export function createSqliteAuditChain(
  database: Pick<LocalDatabase, "client">,
): SqliteAuditChain {
  return new SqliteAuditChain(database);
}
