import { z } from "zod";

import { paymentSatisfactionContextSchema } from "@/domain/payment-satisfaction";
import {
  boundedReasonSchema,
  canonicalTimestampSchema,
  caseIdSchema,
  evidenceItemSchema,
  positiveCountSchema,
} from "@/domain/primitives";
import { recoveryCaseStateSchema } from "@/domain/states";

export const transitionReasonCodeSchema = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(/^[A-Z][A-Z0-9_]*$/);

export const recoveryCaseTransitionCommandSchema = z
  .object({
    caseId: caseIdSchema,
    expectedCurrentState: recoveryCaseStateSchema,
    requestedState: recoveryCaseStateSchema,
    expectedVersion: positiveCountSchema,
    paymentSatisfaction: paymentSatisfactionContextSchema,
    reasonCode: transitionReasonCodeSchema,
    reason: boundedReasonSchema,
    transitionedAt: canonicalTimestampSchema,
  })
  .strict();

export const recoveryCaseTransitionContextSchema = z
  .object({
    command: recoveryCaseTransitionCommandSchema,
    actualCurrentState: recoveryCaseStateSchema,
    actualVersion: positiveCountSchema,
  })
  .strict();

const transitionResultCommonSchema = z.object({
  caseId: caseIdSchema,
  requestedState: recoveryCaseStateSchema,
  decisionReasonCode: transitionReasonCodeSchema,
  requestReasonCode: transitionReasonCodeSchema,
  reason: boundedReasonSchema,
  evidence: z.array(evidenceItemSchema).min(1).max(10),
  decidedAt: canonicalTimestampSchema,
});

const transitionResultBaseSchema = transitionResultCommonSchema.extend({
  previousState: recoveryCaseStateSchema,
  previousVersion: positiveCountSchema,
  resultingVersion: positiveCountSchema,
});

export const recoveryCaseTransitionResultSchema = z.discriminatedUnion(
  "status",
  [
    transitionResultBaseSchema
      .extend({
        status: z.literal("APPLIED"),
        resultingState: recoveryCaseStateSchema,
      })
      .strict(),
    transitionResultBaseSchema
      .extend({
        status: z.literal("IDEMPOTENT_NO_OP"),
        resultingState: recoveryCaseStateSchema,
      })
      .strict(),
    transitionResultBaseSchema
      .extend({
        status: z.enum([
          "ILLEGAL_TRANSITION",
          "PAID_STATE_SAFETY_REJECTION",
          "PAYMENT_CONTEXT_REJECTION",
          "TERMINAL_STATE_REJECTION",
          "CURRENT_STATE_MISMATCH",
          "VERSION_CONFLICT",
        ]),
        resultingState: recoveryCaseStateSchema,
      })
      .strict(),
    transitionResultCommonSchema
      .extend({
        status: z.literal("CASE_NOT_FOUND"),
        previousState: z.null(),
        resultingState: z.null(),
        previousVersion: z.null(),
        resultingVersion: z.null(),
      })
      .strict(),
  ],
);

export type RecoveryCaseTransitionCommand = z.infer<
  typeof recoveryCaseTransitionCommandSchema
>;
export type RecoveryCaseTransitionContext = z.infer<
  typeof recoveryCaseTransitionContextSchema
>;
export type RecoveryCaseTransitionResult = z.infer<
  typeof recoveryCaseTransitionResultSchema
>;
