import { describe, expect, it } from "vitest";

import { aiRecommendationSchema } from "@/domain/ai";
import { auditEntrySchema, sanitizedAuditMetadataSchema } from "@/domain/audit";
import { failureDiagnosisSchema } from "@/domain/diagnosis";
import { simulatedEvaluationResultSchema } from "@/domain/evaluation";
import { policyDecisionSchema } from "@/domain/policy";

import {
  validAiRecommendation,
  validAuditEntry,
  validDiagnosis,
  validPolicyDecision,
  validSimulatedEvaluation,
} from "@/domain/__tests__/fixtures";

describe("failure diagnosis contract", () => {
  it("accepts normalized evidence without implementing diagnosis logic", () => {
    expect(
      failureDiagnosisSchema.parse(validDiagnosis).candidateActions,
    ).toEqual(["WAIT_FOR_RECOVERY", "ESCALATE_HUMAN"]);
  });

  it("rejects repeated or unknown candidate actions", () => {
    expect(
      failureDiagnosisSchema.safeParse({
        ...validDiagnosis,
        candidateActions: ["WAIT_FOR_RECOVERY", "WAIT_FOR_RECOVERY"],
      }).success,
    ).toBe(false);
    expect(
      failureDiagnosisSchema.safeParse({
        ...validDiagnosis,
        candidateActions: ["AUTONOMOUS_CAPTURE"],
      }).success,
    ).toBe(false);
  });
});

describe("AI recommendation boundary", () => {
  it("accepts ranked allowlisted actions with bounded probabilities", () => {
    expect(aiRecommendationSchema.parse(validAiRecommendation).confidence).toBe(
      0.88,
    );
  });

  it.each([-0.01, 1.01])("rejects out-of-range confidence %s", (confidence) => {
    expect(
      aiRecommendationSchema.safeParse({
        ...validAiRecommendation,
        confidence,
      }).success,
    ).toBe(false);
  });

  it.each([-0.01, 1.01])(
    "rejects out-of-range recovery probability %s",
    (recoveryProbability) => {
      expect(
        aiRecommendationSchema.safeParse({
          ...validAiRecommendation,
          rankedActions: [
            {
              ...validAiRecommendation.rankedActions[0],
              recoveryProbability,
            },
          ],
        }).success,
      ).toBe(false);
    },
  );

  it("rejects unknown actions", () => {
    expect(
      aiRecommendationSchema.safeParse({
        ...validAiRecommendation,
        selectedAction: "REFUND_PAYMENT",
      }).success,
    ).toBe(false);
    expect(
      aiRecommendationSchema.safeParse({
        ...validAiRecommendation,
        rankedActions: [
          {
            ...validAiRecommendation.rankedActions[0],
            action: "AUTONOMOUS_CAPTURE",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it.each([
    ["amount", 1_250_000],
    ["currency", "INR"],
    ["apiRoute", "/v1/unsafe"],
    ["recipient", "customer@example.com"],
    ["toolInstructions", "Execute an arbitrary money action"],
  ])("rejects forbidden AI authority field %s", (field, value) => {
    expect(
      aiRecommendationSchema.safeParse({
        ...validAiRecommendation,
        [field]: value,
      }).success,
    ).toBe(false);
  });

  it("requires insufficient context to recommend escalation", () => {
    expect(
      aiRecommendationSchema.safeParse({
        ...validAiRecommendation,
        contextStatus: "INSUFFICIENT",
        escalationRecommended: false,
      }).success,
    ).toBe(false);
  });
});

describe("policy and audit data boundaries", () => {
  it("accepts a passive policy decision and rejects invalid outcomes", () => {
    expect(policyDecisionSchema.safeParse(validPolicyDecision).success).toBe(
      true,
    );
    expect(
      policyDecisionSchema.safeParse({
        ...validPolicyDecision,
        outcome: "RETRIED_AUTOMATICALLY",
      }).success,
    ).toBe(false);
  });

  it("requires a final action for an approved policy decision", () => {
    const withoutFinalAction = structuredClone(validPolicyDecision) as Record<
      string,
      unknown
    >;
    delete withoutFinalAction.finalAction;
    expect(policyDecisionSchema.safeParse(withoutFinalAction).success).toBe(
      false,
    );
  });

  it("rejects malformed hashes and non-allowlisted audit metadata", () => {
    expect(auditEntrySchema.safeParse(validAuditEntry).success).toBe(true);
    expect(
      auditEntrySchema.safeParse({
        ...validAuditEntry,
        currentHash: "not-a-sha256-hash",
      }).success,
    ).toBe(false);
    expect(
      sanitizedAuditMetadataSchema.safeParse({
        ...validAuditEntry.metadata,
        customerEmail: "customer@example.com",
      }).success,
    ).toBe(false);
    expect(
      sanitizedAuditMetadataSchema.safeParse({
        ...validAuditEntry.metadata,
        apiSecret: "must-not-be-stored",
      }).success,
    ).toBe(false);
  });
});

describe("simulated evaluation result", () => {
  it("round-trips a representative valid result without losing data", () => {
    const firstParse = simulatedEvaluationResultSchema.parse(
      validSimulatedEvaluation,
    );
    const roundTrip = simulatedEvaluationResultSchema.parse(
      JSON.parse(JSON.stringify(firstParse)),
    );

    expect(roundTrip).toEqual(firstParse);
    expect(roundTrip.incrementalSimulatedRecovery.subunitDelta).toBe(
      11_925_000,
    );
  });

  it("allows a signed incremental delta for honest simulated regressions", () => {
    expect(
      simulatedEvaluationResultSchema.safeParse({
        ...validSimulatedEvaluation,
        incrementalSimulatedRecovery: {
          subunitDelta: -50_000,
          currency: "INR",
        },
      }).success,
    ).toBe(true);
  });

  it.each([
    ["uniqueCaseCount", -1],
    ["eventDeliveryCount", 99],
    ["simulatedRecoveryRate", 1.1],
    ["humanEscalationRate", -0.1],
    ["meanProcessingTimeMilliseconds", -1],
    ["unresolvedExceptionCount", 1.5],
  ])("rejects invalid evaluation metric %s", (field, value) => {
    expect(
      simulatedEvaluationResultSchema.safeParse({
        ...validSimulatedEvaluation,
        [field]: value,
      }).success,
    ).toBe(false);
  });

  it("rejects fractional money and mixed currencies", () => {
    expect(
      simulatedEvaluationResultSchema.safeParse({
        ...validSimulatedEvaluation,
        baselineSimulatedRecovery: {
          amountSubunits: 1.5,
          currency: "INR",
        },
      }).success,
    ).toBe(false);
    expect(
      simulatedEvaluationResultSchema.safeParse({
        ...validSimulatedEvaluation,
        baselineSimulatedRecovery: {
          amountSubunits: 24_850_000,
          currency: "USD",
        },
      }).success,
    ).toBe(false);
  });
});
