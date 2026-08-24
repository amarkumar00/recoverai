import { createHash, timingSafeEqual } from "node:crypto";

import { canonicalJsonBytes, canonicalizeJson } from "@/audit/canonical-json";
import {
  AUDIT_CHAIN_IDENTITY,
  AUDIT_CHAIN_VERSION,
  auditAppendCommandSchema,
  auditHashPreimageSchema,
  type AuditAppendCommand,
  type AuditHashPreimage,
} from "@/audit/contracts";
import type { AuditEntry } from "@/domain/audit";

export function buildAuditHashPreimage(
  rawCommand: unknown,
  sequence: number,
  previousHash: string | null,
): AuditHashPreimage {
  const command = auditAppendCommandSchema.parse(rawCommand);
  return auditHashPreimageSchema.parse({
    chainVersion: AUDIT_CHAIN_VERSION,
    chainIdentity: AUDIT_CHAIN_IDENTITY,
    sequence,
    ...auditAppendCommandSchema.parse(command),
    previousHash,
  });
}

export function hashAuditPreimage(preimage: AuditHashPreimage): string {
  return createHash("sha256")
    .update(canonicalJsonBytes(auditHashPreimageSchema.parse(preimage)))
    .digest("hex");
}

export function createAuditEntry(
  rawCommand: unknown,
  sequence: number,
  previousHash: string | null,
): AuditEntry {
  const command = auditAppendCommandSchema.parse(rawCommand);
  const preimage = buildAuditHashPreimage(command, sequence, previousHash);
  return {
    sequence,
    ...command,
    previousHash,
    currentHash: hashAuditPreimage(preimage),
  };
}

export function commandMatchesEntry(
  command: AuditAppendCommand,
  entry: AuditEntry,
): boolean {
  const storedCommand = {
    entryId: entry.entryId,
    timestamp: entry.timestamp,
    actor: entry.actor,
    inputReference: entry.inputReference,
    eventType: entry.eventType,
    reason: entry.reason,
    previousState: entry.previousState,
    newState: entry.newState,
    metadata: entry.metadata,
  };
  return (
    canonicalizeJson(auditAppendCommandSchema.parse(command)) ===
    canonicalizeJson(storedCommand)
  );
}

export function safeHashEqual(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right))
    return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}
