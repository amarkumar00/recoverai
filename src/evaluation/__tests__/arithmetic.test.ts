import { describe, expect, it } from "vitest";

import {
  EvaluationArithmeticError,
  checkedAddNonnegativeSubunits,
  checkedSubtractSubunits,
} from "@/evaluation/arithmetic";

describe("checked evaluation money arithmetic", () => {
  it.each([
    [125, 100, 25],
    [100, 100, 0],
    [75, 100, -25],
  ])(
    "preserves positive, zero, and negative deltas",
    (left, right, expected) => {
      expect(checkedSubtractSubunits(left, right)).toBe(expected);
    },
  );

  it("fails closed on unsafe inputs and overflow", () => {
    expect(() =>
      checkedAddNonnegativeSubunits(Number.MAX_SAFE_INTEGER, 1),
    ).toThrow(EvaluationArithmeticError);
    expect(() => checkedSubtractSubunits(-1, 0)).toThrow(
      EvaluationArithmeticError,
    );
    expect(() => checkedAddNonnegativeSubunits(1.5, 1)).toThrow(
      EvaluationArithmeticError,
    );
  });
});
