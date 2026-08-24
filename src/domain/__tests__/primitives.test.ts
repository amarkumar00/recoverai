import { describe, expect, it } from "vitest";

import { RECOVERY_ACTIONS, recoveryActionSchema } from "@/domain/actions";
import {
  canonicalTimestampSchema,
  caseIdSchema,
  currencyCodeSchema,
  moneySchema,
  payableMoneySchema,
  syntheticCustomerHashSchema,
} from "@/domain/primitives";
import { RECOVERY_CASE_STATES, recoveryCaseStateSchema } from "@/domain/states";

describe("authoritative enums", () => {
  it("validates exactly the six allowed recovery actions", () => {
    expect(RECOVERY_ACTIONS).toHaveLength(6);
    for (const action of RECOVERY_ACTIONS) {
      expect(recoveryActionSchema.parse(action)).toBe(action);
    }

    expect(recoveryActionSchema.safeParse("REFUND_PAYMENT").success).toBe(
      false,
    );
  });

  it("validates exactly the ten recovery-case states", () => {
    expect(RECOVERY_CASE_STATES).toHaveLength(10);
    for (const state of RECOVERY_CASE_STATES) {
      expect(recoveryCaseStateSchema.parse(state)).toBe(state);
    }

    expect(recoveryCaseStateSchema.safeParse("RETRYING").success).toBe(false);
  });
});

describe("money contracts", () => {
  it("accepts zero for accounting values and requires positive payable money", () => {
    expect(moneySchema.parse({ amountSubunits: 0, currency: "INR" })).toEqual({
      amountSubunits: 0,
      currency: "INR",
    });
    expect(
      payableMoneySchema.safeParse({ amountSubunits: 0, currency: "INR" })
        .success,
    ).toBe(false);
  });

  it.each([
    { amountSubunits: -1, currency: "INR" },
    { amountSubunits: 10.5, currency: "INR" },
    { amountSubunits: Number.MAX_SAFE_INTEGER + 1, currency: "INR" },
    { amountSubunits: "100", currency: "INR" },
  ])("rejects invalid authoritative money: $amountSubunits", (money) => {
    expect(moneySchema.safeParse(money).success).toBe(false);
  });

  it("enforces normalized uppercase three-letter currency codes", () => {
    expect(currencyCodeSchema.safeParse("INR").success).toBe(true);
    expect(currencyCodeSchema.safeParse("inr").success).toBe(false);
    expect(currencyCodeSchema.safeParse("RUPEE").success).toBe(false);
  });
});

describe("identifiers and timestamps", () => {
  it("accepts bounded synthetic identifiers without production prefixes", () => {
    expect(caseIdSchema.safeParse("case_demo_001").success).toBe(true);
    expect(caseIdSchema.safeParse("").success).toBe(false);
    expect(caseIdSchema.safeParse("x".repeat(129)).success).toBe(false);
  });

  it("requires synthetic customer hashes instead of customer PII", () => {
    expect(syntheticCustomerHashSchema.safeParse("a".repeat(64)).success).toBe(
      true,
    );
    expect(
      syntheticCustomerHashSchema.safeParse("customer@example.com").success,
    ).toBe(false);
  });

  it("uses UTC ISO timestamps with canonical millisecond precision", () => {
    expect(
      canonicalTimestampSchema.safeParse("2026-08-24T12:30:00.000Z").success,
    ).toBe(true);
    expect(
      canonicalTimestampSchema.safeParse("2026-08-24T18:00:00.000+05:30")
        .success,
    ).toBe(false);
    expect(canonicalTimestampSchema.safeParse("not-a-time").success).toBe(
      false,
    );
  });
});
