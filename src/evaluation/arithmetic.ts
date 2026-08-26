export class EvaluationArithmeticError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvaluationArithmeticError";
  }
}

function checkedSafeInteger(value: bigint, label: string): number {
  if (
    value < BigInt(Number.MIN_SAFE_INTEGER) ||
    value > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new EvaluationArithmeticError(
      `${label} exceeds checked safe-integer range.`,
    );
  }
  return Number(value);
}

export function checkedAddNonnegativeSubunits(
  left: number,
  right: number,
  label = "Money total",
): number {
  if (
    !Number.isSafeInteger(left) ||
    left < 0 ||
    !Number.isSafeInteger(right) ||
    right < 0
  ) {
    throw new EvaluationArithmeticError(
      `${label} requires nonnegative safe integers.`,
    );
  }
  return checkedSafeInteger(BigInt(left) + BigInt(right), label);
}

export function checkedSubtractSubunits(
  minuend: number,
  subtrahend: number,
  label = "Money delta",
): number {
  if (
    !Number.isSafeInteger(minuend) ||
    minuend < 0 ||
    !Number.isSafeInteger(subtrahend) ||
    subtrahend < 0
  ) {
    throw new EvaluationArithmeticError(
      `${label} requires nonnegative safe-integer operands.`,
    );
  }
  return checkedSafeInteger(BigInt(minuend) - BigInt(subtrahend), label);
}
