import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  aiProviderInputSchema,
  aiScorerInputSchema,
  type TrustedScoringConfig,
} from "@/ai/contracts";
import { createProviderInput } from "@/ai/recommendation-service";
import { RECOVERY_ACTIONS } from "@/domain/actions";

import {
  DEFAULT_HELD_OUT_SEED,
  generateDevelopmentDataset,
  generateHeldOutSelectionBatch,
} from "..";
import { createHeldOutDigitalTwin } from "../evaluator-only";

const zeroPenalty = {
  contactCostSubunits: 0,
  frictionPenaltySubunits: 0,
  duplicatePaymentRiskPenaltySubunits: 0,
  operationalCostSubunits: 0,
};

const scoringConfig: TrustedScoringConfig = {
  providerTimeoutMilliseconds: 100,
  actionPenalties: {
    WAIT_FOR_RECOVERY: zeroPenalty,
    SEND_PAYMENT_LINK: zeroPenalty,
    REQUEST_METHOD_CHANGE: zeroPenalty,
    CANCEL_RECOVERY_ALREADY_PAID: zeroPenalty,
    STOP_NON_RETRYABLE: zeroPenalty,
    ESCALATE_HUMAN: zeroPenalty,
  },
};

const evaluatorOnlyKeyPattern =
  /groundtruth|hidden|evaluator|simulatedoutcome|allowedactions/i;

function collectKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectKeys);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, nested]) => [
    key,
    ...collectKeys(nested),
  ]);
}

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

describe("Digital Twin leakage and privacy boundaries", () => {
  it("keeps held-out ground truth and hidden simulated outcomes out of scorer-visible serialization", () => {
    const batch = generateHeldOutSelectionBatch();
    const keys = collectKeys(batch);

    expect(keys.filter((key) => evaluatorOnlyKeyPattern.test(key))).toEqual([]);
    expect(JSON.stringify(batch)).not.toMatch(
      /EVALUATOR_ONLY_HIDDEN_SIMULATED|EVALUATOR_ONLY_AFTER_SELECTION/,
    );
  });

  it("creates the existing strict scorer and provider contexts without evaluator-only fields", () => {
    const visibleCase = generateHeldOutSelectionBatch().cases.find(
      ({ diagnosis, paymentContext }) =>
        diagnosis.failureClass === "CUSTOMER_CORRECTABLE" &&
        !paymentContext.activeRecoveryLink.exists,
    );
    expect(visibleCase).toBeDefined();

    const scorerInput = aiScorerInputSchema.parse({
      caseId: visibleCase!.caseId,
      seed: DEFAULT_HELD_OUT_SEED,
      recommendedAt: "2026-08-26T12:00:00.000Z",
      paymentContext: visibleCase!.paymentContext,
      diagnosis: visibleCase!.diagnosis,
      scoringConfig,
    });
    const providerInput = createProviderInput(scorerInput);

    expect(aiProviderInputSchema.safeParse(providerInput).success).toBe(true);
    expect(
      collectKeys(scorerInput).filter((key) =>
        evaluatorOnlyKeyPattern.test(key),
      ),
    ).toEqual([]);
    expect(
      collectKeys(providerInput).filter((key) =>
        evaluatorOnlyKeyPattern.test(key),
      ),
    ).toEqual([]);
  });

  it("makes the existing AI provider schema reject evaluator-only additions", () => {
    const visibleCase = generateDevelopmentDataset().cases.find(
      ({ diagnosis }) => diagnosis.candidateActions.length > 0,
    );
    expect(visibleCase).toBeDefined();
    const providerInput = createProviderInput(
      aiScorerInputSchema.parse({
        caseId: visibleCase!.caseId,
        seed: visibleCase!.caseId,
        recommendedAt: "2026-08-26T12:00:00.000Z",
        paymentContext: visibleCase!.paymentContext,
        diagnosis: visibleCase!.diagnosis,
        scoringConfig,
      }),
    );

    expect(
      aiProviderInputSchema.safeParse({
        ...providerInput,
        groundTruthFailureClass: "CUSTOMER_CORRECTABLE",
      }).success,
    ).toBe(false);
    expect(
      aiProviderInputSchema.safeParse({
        ...providerInput,
        hiddenSimulatedOutcomeByAction: {},
      }).success,
    ).toBe(false);
  });

  it("reveals an outcome only through the evaluator-only selected-action request", () => {
    const twin = createHeldOutDigitalTwin();
    const visibleCase = twin.selectionBatch.cases[0];
    expect(visibleCase).toBeDefined();

    expect(() =>
      twin.evaluator.revealSelectedOutcome({
        caseId: visibleCase!.caseId,
        selectedAt: "2026-08-26T12:00:00.000Z",
      } as never),
    ).toThrow();
    const revealed = twin.evaluator.revealSelectedOutcome({
      caseId: visibleCase!.caseId,
      selectedAction: "ESCALATE_HUMAN",
      selectedAt: "2026-08-26T12:00:00.000Z",
    });
    expect(revealed.boundary).toBe("EVALUATOR_ONLY_AFTER_SELECTION");
    expect(revealed.outcome.simulationLabel).toBe("SIMULATED");
  });

  it("prevents action-selection and execution modules from importing evaluator-only material", () => {
    const protectedDirectories = ["ai", "diagnosis", "policy", "recovery"].map(
      (directory) => resolve(process.cwd(), "src", directory),
    );
    const sources = protectedDirectories
      .flatMap(filesUnder)
      .filter((path) => path.endsWith(".ts") && !path.includes("/__tests__/"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    expect(sources).not.toMatch(
      /digital-twin\/(?:evaluator-only|internal-generator)/,
    );
    expect(sources).not.toMatch(
      /hiddenSimulatedOutcome|groundTruthAllowedActions/,
    );
  });

  it("contains no real PII fields, credentials or unsafe provider raw-body material", () => {
    const twin = createHeldOutDigitalTwin();
    const visibleSerialized = JSON.stringify(twin.selectionBatch);

    expect(visibleSerialized).not.toMatch(
      /"(?:name|email|phone|address|card_number|cardNumber|vpa|token|secret)"\s*:/i,
    );
    expect(visibleSerialized).not.toMatch(/rzp_(?:live|test)_[A-Za-z0-9]+/);
    expect(visibleSerialized).not.toMatch(
      /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/,
    );
    expect(visibleSerialized).not.toMatch(/authorization:\s*bearer/i);
    expect(visibleSerialized).not.toMatch(/rawBody|rawPayload/i);
    expect(
      twin.selectionBatch.cases.every(({ syntheticCustomerReference }) =>
        syntheticCustomerReference.startsWith("synthetic-non-production:"),
      ),
    ).toBe(true);
  });

  it("never exposes an unknown action through evaluator selection", () => {
    const twin = createHeldOutDigitalTwin();
    const selectedAt = "2026-08-26T12:00:00.000Z";
    const revealedActions = new Set(
      RECOVERY_ACTIONS.map(
        (selectedAction) =>
          twin.evaluator.revealSelectedOutcome({
            caseId: twin.selectionBatch.cases[0]!.caseId,
            selectedAction,
            selectedAt,
          }).selectedAction,
      ),
    );

    expect(revealedActions).toEqual(new Set(RECOVERY_ACTIONS));
  });
});
