import { z } from "zod";

import { recoveryActionSchema } from "@/domain/actions";
import {
  boundedReasonSchema,
  canonicalTimestampSchema,
  caseIdSchema,
  evidenceItemSchema,
} from "@/domain/primitives";

export const FAILURE_CLASSES = [
  "DOWNTIME_OR_TRANSIENT",
  "INSUFFICIENT_FUNDS",
  "CUSTOMER_CORRECTABLE",
  "NETWORK_OR_INTEGRATION_UNCERTAINTY",
  "LATE_SUCCESS",
  "NON_RETRYABLE",
  "AMBIGUOUS",
] as const;

export const failureClassSchema = z.enum(FAILURE_CLASSES);
export const diagnosisKnowledgeStatusSchema = z.enum([
  "KNOWN",
  "AMBIGUOUS",
  "UNAVAILABLE",
]);

export const failureDiagnosisSchema = z
  .object({
    caseId: caseIdSchema,
    failureClass: failureClassSchema,
    knowledgeStatus: diagnosisKnowledgeStatusSchema,
    reason: boundedReasonSchema,
    evidence: z.array(evidenceItemSchema).min(1).max(20),
    candidateActions: z.array(recoveryActionSchema).max(6),
    diagnosedAt: canonicalTimestampSchema,
  })
  .strict()
  .superRefine(({ candidateActions }, context) => {
    if (new Set(candidateActions).size !== candidateActions.length) {
      context.addIssue({
        code: "custom",
        path: ["candidateActions"],
        message: "Candidate recovery actions must be unique.",
      });
    }
  });

export type FailureClass = z.infer<typeof failureClassSchema>;
export type DiagnosisKnowledgeStatus = z.infer<
  typeof diagnosisKnowledgeStatusSchema
>;
export type FailureDiagnosis = z.infer<typeof failureDiagnosisSchema>;
