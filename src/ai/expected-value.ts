import {
  actionPenaltySchema,
  actionScoreBreakdownSchema,
  PROBABILITY_SCALE_MILLIONTHS,
  probabilityMillionthsSchema,
  type ActionPenalty,
  type ActionScoreBreakdown,
} from "@/ai/contracts";
import type { RecoveryAction } from "@/domain/actions";
import {
  currencyCodeSchema,
  payableAmountSubunitsSchema,
} from "@/domain/primitives";

export class ArithmeticOutOfRangeError extends Error {
  constructor() {
    super("Scoring arithmetic exceeded the safe integer range.");
    this.name = "ArithmeticOutOfRangeError";
  }
}

function checkedSafeInteger(value: bigint): number {
  if (
    value > BigInt(Number.MAX_SAFE_INTEGER) ||
    value < BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    throw new ArithmeticOutOfRangeError();
  }
  return Number(value);
}

export type ExpectedValueInput = {
  action: RecoveryAction;
  amountSubunits: number;
  currency: string;
  recoveryProbabilityMillionths: number;
  penalties: ActionPenalty;
};

// Probability multiplication uses integer millionths and rounds down to the
// nearest currency subunit. Money never passes through floating-point math.
export function calculateExpectedValue(
  rawInput: ExpectedValueInput,
): ActionScoreBreakdown {
  const amountSubunits = payableAmountSubunitsSchema.parse(
    rawInput.amountSubunits,
  );
  const currency = currencyCodeSchema.parse(rawInput.currency);
  const probability = probabilityMillionthsSchema.parse(
    rawInput.recoveryProbabilityMillionths,
  );
  const penalties = actionPenaltySchema.parse(rawInput.penalties);

  const expectedRecovered =
    (BigInt(amountSubunits) * BigInt(probability)) /
    BigInt(PROBABILITY_SCALE_MILLIONTHS);
  const totalPenalty =
    BigInt(penalties.contactCostSubunits) +
    BigInt(penalties.frictionPenaltySubunits) +
    BigInt(penalties.duplicatePaymentRiskPenaltySubunits) +
    BigInt(penalties.operationalCostSubunits);
  const expectedValue = expectedRecovered - totalPenalty;

  return actionScoreBreakdownSchema.parse({
    action: rawInput.action,
    recoveryProbabilityMillionths: probability,
    expectedRecoveredSubunits: checkedSafeInteger(expectedRecovered),
    ...penalties,
    totalPenaltySubunits: checkedSafeInteger(totalPenalty),
    expectedValueSubunits: checkedSafeInteger(expectedValue),
    currency,
  });
}
