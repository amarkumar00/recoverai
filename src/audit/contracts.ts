import { z } from "zod";

import {
  auditActorSchema,
  auditEntrySchema,
  auditEventTypeSchema,
  sanitizedAuditMetadataSchema,
  sha256HashSchema,
} from "@/domain/audit";
import {
  auditEntryIdSchema,
  boundedReasonSchema,
  canonicalTimestampSchema,
} from "@/domain/primitives";
import { recoveryCaseStateSchema } from "@/domain/states";

export const AUDIT_CHAIN_VERSION = "RECOVERAI_AUDIT_V1" as const;
export const AUDIT_CHAIN_IDENTITY = "RECOVERAI_GLOBAL_AUDIT" as const;

const FORBIDDEN_AUDIT_TEXT = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /(?:\+?91[-\s]?)?[6-9]\d{9}\b/,
  /\brzp_(?:test|live)_[A-Za-z0-9]+\b/i,
  /\bbearer\s+[A-Za-z0-9._~+/=-]+/i,
  /\b(?:api[_-]?key|client[_-]?secret|webhook[_-]?secret|password|access[_-]?token|refresh[_-]?token)\b/i,
  /\b(?:raw[\s_-]?payload|stack[\s_-]?trace|system[\s_-]?prompt|user[\s_-]?prompt)\b/i,
] as const;

function containsForbiddenAuditText(value: unknown): boolean {
  if (typeof value === "string") {
    return FORBIDDEN_AUDIT_TEXT.some((pattern) => pattern.test(value));
  }
  if (Array.isArray(value)) {
    return value.some(containsForbiddenAuditText);
  }
  if (value !== null && typeof value === "object") {
    return Object.values(value).some(containsForbiddenAuditText);
  }
  return false;
}

export const privacySafeAuditMetadataSchema =
  sanitizedAuditMetadataSchema.refine(
    (value) => !containsForbiddenAuditText(value),
    {
      message:
        "Audit metadata contains forbidden secret, PII, or raw diagnostic material.",
    },
  );

const operationalReferenceSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const auditAppendCommandSchema = z
  .object({
    entryId: auditEntryIdSchema,
    timestamp: canonicalTimestampSchema,
    actor: auditActorSchema,
    inputReference: operationalReferenceSchema,
    eventType: auditEventTypeSchema,
    reason: boundedReasonSchema,
    previousState: recoveryCaseStateSchema.nullable(),
    newState: recoveryCaseStateSchema.nullable(),
    metadata: privacySafeAuditMetadataSchema,
  })
  .strict()
  .refine((value) => !containsForbiddenAuditText(value), {
    message:
      "Audit content contains forbidden secret, PII, or raw diagnostic material.",
  });

export const auditChainCheckpointSchema = z
  .object({
    chainVersion: z.literal(AUDIT_CHAIN_VERSION),
    chainIdentity: z.literal(AUDIT_CHAIN_IDENTITY),
    entryCount: z.number().int().nonnegative().safe(),
    lastSequence: z.number().int().nonnegative().safe(),
    headHash: sha256HashSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.entryCount !== value.lastSequence) {
      context.addIssue({
        code: "custom",
        path: ["lastSequence"],
        message: "Last sequence must equal entry count.",
      });
    }
    if ((value.entryCount === 0) !== (value.headHash === null)) {
      context.addIssue({
        code: "custom",
        path: ["headHash"],
        message: "Only an empty chain may have a null head hash.",
      });
    }
  });

export const auditHashPreimageSchema = auditEntrySchema
  .omit({ currentHash: true })
  .extend({
    chainVersion: z.literal(AUDIT_CHAIN_VERSION),
    chainIdentity: z.literal(AUDIT_CHAIN_IDENTITY),
  })
  .strict();

export const auditAppendResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("APPENDED"),
      entry: auditEntrySchema,
      checkpoint: auditChainCheckpointSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("IDEMPOTENT_REPLAY"),
      entry: auditEntrySchema,
      checkpoint: auditChainCheckpointSchema,
    })
    .strict(),
  z.object({ status: z.literal("ENTRY_ID_CONFLICT") }).strict(),
  z.object({ status: z.literal("CHAIN_CORRUPT") }).strict(),
]);

export const AUDIT_VERIFICATION_ISSUE_CODES = [
  "CHAIN_STATE_MISSING",
  "CHAIN_VERSION_MISMATCH",
  "ENTRY_SCHEMA_INVALID",
  "SEQUENCE_GAP",
  "GENESIS_PREVIOUS_HASH_INVALID",
  "PREVIOUS_HASH_MISMATCH",
  "CURRENT_HASH_MISMATCH",
  "HEAD_COUNT_MISMATCH",
  "HEAD_HASH_MISMATCH",
  "ENTRY_ID_DUPLICATE",
  "CHECKPOINT_MISMATCH",
  "STORED_METADATA_INVALID",
] as const;

export const auditVerificationIssueCodeSchema = z.enum(
  AUDIT_VERIFICATION_ISSUE_CODES,
);

export type AuditAppendCommand = z.infer<typeof auditAppendCommandSchema>;
export type AuditChainCheckpoint = z.infer<typeof auditChainCheckpointSchema>;
export type AuditHashPreimage = z.infer<typeof auditHashPreimageSchema>;
export type AuditAppendResult = z.infer<typeof auditAppendResultSchema>;
export type AuditVerificationIssueCode = z.infer<
  typeof auditVerificationIssueCodeSchema
>;
export type AuditVerificationResult =
  | { status: "VALID"; checkpoint: AuditChainCheckpoint }
  | { status: "INVALID"; issue: AuditVerificationIssueCode; sequence?: number };
