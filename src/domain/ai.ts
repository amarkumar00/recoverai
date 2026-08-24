import { z } from "zod";

import { recoveryActionSchema } from "@/domain/actions";
import {
  boundedExplanationSchema,
  boundedReasonSchema,
  canonicalTimestampSchema,
  caseIdSchema,
  evidenceItemSchema,
  unitIntervalSchema,
} from "@/domain/primitives";

export const rankedRecoveryActionSchema = z
  .object({
    rank: z.number().int().min(1).max(6),
    action: recoveryActionSchema,
    recoveryProbability: unitIntervalSchema,
    reason: boundedReasonSchema,
    evidence: z.array(evidenceItemSchema).min(1).max(10),
  })
  .strict();

export const aiRecommendationSchema = z
  .object({
    caseId: caseIdSchema,
    rankedActions: z.array(rankedRecoveryActionSchema).min(1).max(6),
    selectedAction: recoveryActionSchema,
    confidence: unitIntervalSchema,
    merchantExplanation: boundedExplanationSchema,
    customerSafeMessage: boundedExplanationSchema.optional(),
    reason: boundedReasonSchema,
    evidence: z.array(evidenceItemSchema).min(1).max(20),
    contextStatus: z.enum(["SUFFICIENT", "INSUFFICIENT"]),
    escalationRecommended: z.boolean(),
    recommendedAt: canonicalTimestampSchema,
  })
  .strict()
  .superRefine((recommendation, context) => {
    const actions = recommendation.rankedActions.map((item) => item.action);
    const ranks = recommendation.rankedActions.map((item) => item.rank);

    if (new Set(actions).size !== actions.length) {
      context.addIssue({
        code: "custom",
        path: ["rankedActions"],
        message: "Ranked actions must be unique.",
      });
    }

    if (new Set(ranks).size !== ranks.length) {
      context.addIssue({
        code: "custom",
        path: ["rankedActions"],
        message: "Action ranks must be unique.",
      });
    }

    const sortedRanks = [...ranks].sort((left, right) => left - right);
    const hasContiguousRanks = sortedRanks.every(
      (rank, index) => rank === index + 1,
    );

    if (!hasContiguousRanks) {
      context.addIssue({
        code: "custom",
        path: ["rankedActions"],
        message: "Action ranks must form a contiguous sequence starting at 1.",
      });
    }

    if (!actions.includes(recommendation.selectedAction)) {
      context.addIssue({
        code: "custom",
        path: ["selectedAction"],
        message: "Selected action must appear in the ranked actions.",
      });
    }

    const topRankedAction = recommendation.rankedActions.find(
      (item) => item.rank === 1,
    )?.action;

    if (
      topRankedAction !== undefined &&
      recommendation.selectedAction !== topRankedAction
    ) {
      context.addIssue({
        code: "custom",
        path: ["selectedAction"],
        message: "Selected action must be the action ranked first.",
      });
    }

    if (
      recommendation.contextStatus === "INSUFFICIENT" &&
      !recommendation.escalationRecommended
    ) {
      context.addIssue({
        code: "custom",
        path: ["escalationRecommended"],
        message: "Insufficient context must recommend escalation.",
      });
    }

    if (
      recommendation.contextStatus === "INSUFFICIENT" &&
      recommendation.selectedAction !== "ESCALATE_HUMAN"
    ) {
      context.addIssue({
        code: "custom",
        path: ["selectedAction"],
        message: "Insufficient context must select human escalation.",
      });
    }
  });

export type RankedRecoveryAction = z.infer<typeof rankedRecoveryActionSchema>;
export type AiRecommendation = z.infer<typeof aiRecommendationSchema>;
