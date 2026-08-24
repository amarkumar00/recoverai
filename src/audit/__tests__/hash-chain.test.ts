import { describe, expect, it } from "vitest";

import {
  AUDIT_CHAIN_IDENTITY,
  AUDIT_CHAIN_VERSION,
  buildAuditHashPreimage,
  createAuditEntry,
  hashAuditPreimage,
} from "@/audit";

const command = {
  entryId: "audit_hash_001",
  timestamp: "2026-08-25T10:00:00.000Z",
  actor: "AUDIT_SYSTEM" as const,
  inputReference: "case_hash_001",
  eventType: "CHAIN_TESTED",
  reason: "Canonical hashing is under test.",
  previousState: null,
  newState: null,
  metadata: { caseId: "case_hash_001", isSynthetic: true },
};

describe("audit hash construction", () => {
  it("uses a real lowercase SHA-256 digest", () =>
    expect(createAuditEntry(command, 1, null).currentHash).toMatch(
      /^[a-f0-9]{64}$/,
    ));
  it("is deterministic for identical canonical input", () =>
    expect(createAuditEntry(command, 1, null).currentHash).toBe(
      createAuditEntry(
        {
          ...command,
          metadata: { isSynthetic: true, caseId: "case_hash_001" },
        },
        1,
        null,
      ).currentHash,
    ));
  it("binds the sequence", () =>
    expect(createAuditEntry(command, 1, null).currentHash).not.toBe(
      createAuditEntry(command, 2, null).currentHash,
    ));
  it("binds the previous hash", () =>
    expect(createAuditEntry(command, 2, "a".repeat(64)).currentHash).not.toBe(
      createAuditEntry(command, 2, "b".repeat(64)).currentHash,
    ));
  it("binds every material command field", () =>
    expect(createAuditEntry(command, 1, null).currentHash).not.toBe(
      createAuditEntry({ ...command, reason: "Changed safe reason." }, 1, null)
        .currentHash,
    ));
  it.each([
    ["entryId", "audit_hash_002"],
    ["timestamp", "2026-08-25T10:00:01.000Z"],
    ["actor", "HUMAN_OPERATOR"],
    ["inputReference", "case_hash_002"],
    ["eventType", "CHAIN_CHANGED"],
    ["reason", "A different safe reason."],
    ["previousState", "DETECTED"],
    ["newState", "VERIFYING"],
    ["metadata", { caseId: "case_hash_002", isSynthetic: true }],
  ])("binds material field %s", (field, value) => {
    expect(createAuditEntry(command, 1, null).currentHash).not.toBe(
      createAuditEntry({ ...command, [field]: value }, 1, null).currentHash,
    );
  });
  it("includes the fixed version and identity", () =>
    expect(buildAuditHashPreimage(command, 1, null)).toMatchObject({
      chainVersion: AUDIT_CHAIN_VERSION,
      chainIdentity: AUDIT_CHAIN_IDENTITY,
    }));
  it("excludes currentHash from its preimage", () =>
    expect(Object.keys(buildAuditHashPreimage(command, 1, null))).not.toContain(
      "currentHash",
    ));
  it("hashes an independently built preimage identically", () => {
    const entry = createAuditEntry(command, 1, null);
    expect(hashAuditPreimage(buildAuditHashPreimage(command, 1, null))).toBe(
      entry.currentHash,
    );
  });
});
