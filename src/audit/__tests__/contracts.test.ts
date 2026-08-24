import { describe, expect, it } from "vitest";

import { auditAppendCommandSchema } from "@/audit";

const validCommand = {
  entryId: "audit_contract_001",
  timestamp: "2026-08-25T10:00:00.000Z",
  actor: "POLICY_FIREWALL",
  inputReference: "case_contract_001",
  eventType: "ACTION_APPROVED",
  reason: "A bounded policy decision was recorded.",
  previousState: "AWAITING_POLICY",
  newState: "WAITING",
  metadata: {
    caseId: "case_contract_001",
    action: "WAIT_FOR_RECOVERY",
    isSynthetic: true,
  },
};

describe("privacy-safe audit append contract", () => {
  it("accepts a bounded operational command", () =>
    expect(auditAppendCommandSchema.safeParse(validCommand).success).toBe(
      true,
    ));
  it("rejects caller-supplied sequence", () =>
    expect(
      auditAppendCommandSchema.safeParse({ ...validCommand, sequence: 1 })
        .success,
    ).toBe(false));
  it("rejects caller-supplied previous hash", () =>
    expect(
      auditAppendCommandSchema.safeParse({
        ...validCommand,
        previousHash: "a".repeat(64),
      }).success,
    ).toBe(false));
  it("rejects caller-supplied current hash", () =>
    expect(
      auditAppendCommandSchema.safeParse({
        ...validCommand,
        currentHash: "b".repeat(64),
      }).success,
    ).toBe(false));
  it("rejects email-like input references", () =>
    expect(
      auditAppendCommandSchema.safeParse({
        ...validCommand,
        inputReference: "person@example.com",
      }).success,
    ).toBe(false));
  it("rejects email addresses in reasons", () =>
    expect(
      auditAppendCommandSchema.safeParse({
        ...validCommand,
        reason: "Contact person@example.com",
      }).success,
    ).toBe(false));
  it("rejects phone numbers", () =>
    expect(
      auditAppendCommandSchema.safeParse({
        ...validCommand,
        reason: "Call +91 9876543210",
      }).success,
    ).toBe(false));
  it("rejects Razorpay credential-like values", () =>
    expect(
      auditAppendCommandSchema.safeParse({
        ...validCommand,
        reason: "Used rzp_test_1234567890secret",
      }).success,
    ).toBe(false));
  it("rejects bearer credentials", () =>
    expect(
      auditAppendCommandSchema.safeParse({
        ...validCommand,
        reason: "Bearer abc.def.ghi",
      }).success,
    ).toBe(false));
  it.each([
    "api_key exposed",
    "client_secret exposed",
    "webhook-secret exposed",
    "password exposed",
    "access_token exposed",
  ])("rejects secret label %s", (reason) =>
    expect(
      auditAppendCommandSchema.safeParse({ ...validCommand, reason }).success,
    ).toBe(false),
  );
  it.each([
    "raw payload copied",
    "stack trace copied",
    "system prompt copied",
    "user_prompt copied",
  ])("rejects unsafe diagnostic material %s", (reason) =>
    expect(
      auditAppendCommandSchema.safeParse({ ...validCommand, reason }).success,
    ).toBe(false),
  );
  it("rejects non-allowlisted metadata keys", () =>
    expect(
      auditAppendCommandSchema.safeParse({
        ...validCommand,
        metadata: {
          ...validCommand.metadata,
          customerEmail: "person@example.com",
        },
      }).success,
    ).toBe(false));
  it("rejects secret-like values in allowlisted metadata", () =>
    expect(
      auditAppendCommandSchema.safeParse({
        ...validCommand,
        metadata: { providerStatus: "api_key exposed" },
      }).success,
    ).toBe(false));
  it("rejects raw prompt fields at the top level", () =>
    expect(
      auditAppendCommandSchema.safeParse({
        ...validCommand,
        prompt: "do something",
      }).success,
    ).toBe(false));
  it("rejects even a syntactically valid synthetic customer hash because it is not allowlisted", () =>
    expect(
      auditAppendCommandSchema.safeParse({
        ...validCommand,
        metadata: {
          ...validCommand.metadata,
          syntheticCustomerHash: "a".repeat(64),
        },
      }).success,
    ).toBe(false));
});
