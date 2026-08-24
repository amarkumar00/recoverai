import { describe, expect, it } from "vitest";

import { validAiRecommendation } from "@/domain/__tests__/fixtures";
import { aiRecommendationSchema } from "@/domain/ai";

const waitAction = validAiRecommendation.rankedActions[0];
const escalationAction = validAiRecommendation.rankedActions[1];

if (waitAction === undefined || escalationAction === undefined) {
  throw new Error("AI recommendation fixture must contain two ranked actions.");
}

const methodChangeAction = {
  ...waitAction,
  rank: 3,
  action: "REQUEST_METHOD_CHANGE",
  recoveryProbability: 0.2,
  reason: "A method change is a lower-ranked bounded option.",
};

describe("AI ranking invariants", () => {
  it("accepts valid contiguous rankings beginning at 1", () => {
    expect(
      aiRecommendationSchema.safeParse({
        ...validAiRecommendation,
        rankedActions: [waitAction],
      }).success,
    ).toBe(true);

    expect(
      aiRecommendationSchema.safeParse({
        ...validAiRecommendation,
        rankedActions: [waitAction, escalationAction, methodChangeAction],
      }).success,
    ).toBe(true);
  });

  it("rejects duplicate actions", () => {
    expect(
      aiRecommendationSchema.safeParse({
        ...validAiRecommendation,
        rankedActions: [
          waitAction,
          { ...escalationAction, action: waitAction.action },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate ranks", () => {
    expect(
      aiRecommendationSchema.safeParse({
        ...validAiRecommendation,
        rankedActions: [waitAction, { ...escalationAction, rank: 1 }],
      }).success,
    ).toBe(false);
  });

  it("rejects non-contiguous ranks", () => {
    expect(
      aiRecommendationSchema.safeParse({
        ...validAiRecommendation,
        rankedActions: [waitAction, { ...escalationAction, rank: 3 }],
      }).success,
    ).toBe(false);
  });

  it("rejects rankings that do not begin at 1", () => {
    expect(
      aiRecommendationSchema.safeParse({
        ...validAiRecommendation,
        rankedActions: [{ ...waitAction, rank: 2 }],
      }).success,
    ).toBe(false);

    expect(
      aiRecommendationSchema.safeParse({
        ...validAiRecommendation,
        rankedActions: [
          { ...waitAction, rank: 2 },
          { ...escalationAction, rank: 3 },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects a selected action different from the rank-1 action", () => {
    expect(
      aiRecommendationSchema.safeParse({
        ...validAiRecommendation,
        selectedAction: "ESCALATE_HUMAN",
      }).success,
    ).toBe(false);
  });

  it("rejects insufficient context without an escalation recommendation", () => {
    expect(
      aiRecommendationSchema.safeParse({
        ...validAiRecommendation,
        rankedActions: [
          { ...escalationAction, rank: 1 },
          { ...waitAction, rank: 2 },
        ],
        selectedAction: "ESCALATE_HUMAN",
        contextStatus: "INSUFFICIENT",
        escalationRecommended: false,
      }).success,
    ).toBe(false);
  });

  it("rejects insufficient context selecting a non-escalation action", () => {
    expect(
      aiRecommendationSchema.safeParse({
        ...validAiRecommendation,
        contextStatus: "INSUFFICIENT",
        escalationRecommended: true,
      }).success,
    ).toBe(false);
  });

  it("accepts insufficient context when human escalation is ranked first", () => {
    expect(
      aiRecommendationSchema.safeParse({
        ...validAiRecommendation,
        rankedActions: [
          { ...escalationAction, rank: 1 },
          { ...waitAction, rank: 2 },
        ],
        selectedAction: "ESCALATE_HUMAN",
        contextStatus: "INSUFFICIENT",
        escalationRecommended: true,
      }).success,
    ).toBe(true);
  });
});
