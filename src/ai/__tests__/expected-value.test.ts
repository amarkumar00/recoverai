import { describe, expect, it } from "vitest";

import {
  ArithmeticOutOfRangeError,
  calculateExpectedValue,
} from "@/ai/expected-value";

const zeroPenalties = {
  contactCostSubunits: 0,
  frictionPenaltySubunits: 0,
  duplicatePaymentRiskPenaltySubunits: 0,
  operationalCostSubunits: 0,
};

describe("fixed-point expected-value calculation", () => {
  it("calculates the canonical formula for a known example", () => {
    expect(
      calculateExpectedValue({
        action: "SEND_PAYMENT_LINK",
        amountSubunits: 100_000,
        currency: "INR",
        recoveryProbabilityMillionths: 600_000,
        penalties: {
          contactCostSubunits: 100,
          frictionPenaltySubunits: 200,
          duplicatePaymentRiskPenaltySubunits: 300,
          operationalCostSubunits: 400,
        },
      }),
    ).toMatchObject({
      expectedRecoveredSubunits: 60_000,
      totalPenaltySubunits: 1_000,
      expectedValueSubunits: 59_000,
    });
  });

  it("uses zero expected recovery at probability zero", () => {
    const result = calculateExpectedValue({
      action: "WAIT_FOR_RECOVERY",
      amountSubunits: 100_000,
      currency: "INR",
      recoveryProbabilityMillionths: 0,
      penalties: { ...zeroPenalties, operationalCostSubunits: 5 },
    });
    expect(result.expectedRecoveredSubunits).toBe(0);
    expect(result.expectedValueSubunits).toBe(-5);
  });

  it("uses the full verified amount at probability one", () => {
    const result = calculateExpectedValue({
      action: "STOP_NON_RETRYABLE",
      amountSubunits: 99_999,
      currency: "INR",
      recoveryProbabilityMillionths: 1_000_000,
      penalties: zeroPenalties,
    });
    expect(result.expectedRecoveredSubunits).toBe(99_999);
  });

  it("preserves a negative expected value", () => {
    const result = calculateExpectedValue({
      action: "ESCALATE_HUMAN",
      amountSubunits: 100,
      currency: "INR",
      recoveryProbabilityMillionths: 100_000,
      penalties: { ...zeroPenalties, operationalCostSubunits: 50 },
    });
    expect(result.expectedValueSubunits).toBe(-40);
  });

  it("preserves the trusted input currency", () => {
    expect(
      calculateExpectedValue({
        action: "WAIT_FOR_RECOVERY",
        amountSubunits: 100,
        currency: "USD",
        recoveryProbabilityMillionths: 500_000,
        penalties: zeroPenalties,
      }).currency,
    ).toBe("USD");
  });

  it("returns integer subunits only", () => {
    const result = calculateExpectedValue({
      action: "WAIT_FOR_RECOVERY",
      amountSubunits: 10_001,
      currency: "INR",
      recoveryProbabilityMillionths: 333_333,
      penalties: zeroPenalties,
    });
    expect(Number.isInteger(result.expectedRecoveredSubunits)).toBe(true);
    expect(Number.isInteger(result.expectedValueSubunits)).toBe(true);
  });

  it("rounds probability multiplication down to the nearest subunit", () => {
    expect(
      calculateExpectedValue({
        action: "WAIT_FOR_RECOVERY",
        amountSubunits: 10_001,
        currency: "INR",
        recoveryProbabilityMillionths: 333_333,
        penalties: zeroPenalties,
      }).expectedRecoveredSubunits,
    ).toBe(3_333);
  });

  it("returns identical arithmetic for identical input", () => {
    const input = {
      action: "WAIT_FOR_RECOVERY" as const,
      amountSubunits: 12_345,
      currency: "INR",
      recoveryProbabilityMillionths: 456_789,
      penalties: zeroPenalties,
    };
    expect(calculateExpectedValue(input)).toEqual(
      calculateExpectedValue(input),
    );
  });

  it("rejects out-of-range probability", () => {
    expect(() =>
      calculateExpectedValue({
        action: "WAIT_FOR_RECOVERY",
        amountSubunits: 100,
        currency: "INR",
        recoveryProbabilityMillionths: 1_000_001,
        penalties: zeroPenalties,
      }),
    ).toThrow();
  });

  it("throws a typed error when penalty totals exceed safe integer range", () => {
    expect(() =>
      calculateExpectedValue({
        action: "SEND_PAYMENT_LINK",
        amountSubunits: Number.MAX_SAFE_INTEGER,
        currency: "INR",
        recoveryProbabilityMillionths: 1_000_000,
        penalties: {
          contactCostSubunits: Number.MAX_SAFE_INTEGER,
          frictionPenaltySubunits: Number.MAX_SAFE_INTEGER,
          duplicatePaymentRiskPenaltySubunits: 0,
          operationalCostSubunits: 0,
        },
      }),
    ).toThrow(ArithmeticOutOfRangeError);
  });
});
