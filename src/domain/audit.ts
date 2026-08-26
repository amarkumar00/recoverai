import { z } from "zod";

import { recoveryActionSchema } from "@/domain/actions";
import { failureClassSchema } from "@/domain/diagnosis";
import {
  auditEntryIdSchema,
  boundedProviderValueSchema,
  boundedReasonSchema,
  canonicalTimestampSchema,
  caseIdSchema,
  eventIdSchema,
  orderIdSchema,
  paymentIdSchema,
  recoveryLinkIdSchema,
  unitIntervalSchema,
} from "@/domain/primitives";
import { recoveryCaseStateSchema } from "@/domain/states";

export const sha256HashSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Audit hash must be lowercase SHA-256 hex.");

export const auditActorSchema = z.enum([
  "WEBHOOK_INGESTOR",
  "STATE_RECONCILER",
  "KNOWN_ERROR_DIAGNOSER",
  "AI_SCORER",
  "POLICY_FIREWALL",
  "RECOVERY_EXECUTOR",
  "AUDIT_SYSTEM",
  "DIGITAL_TWIN",
  "HUMAN_OPERATOR",
]);

export const auditEventTypeSchema = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(/^[A-Z][A-Z0-9_]*$/);

// Metadata is intentionally allowlisted. It must contain no secrets, contact
// details, raw payloads, or real customer identifiers.
export const sanitizedAuditMetadataSchema = z
  .object({
    caseId: caseIdSchema.optional(),
    eventId: eventIdSchema.optional(),
    paymentId: paymentIdSchema.optional(),
    orderId: orderIdSchema.optional(),
    recoveryLinkId: recoveryLinkIdSchema.optional(),
    action: recoveryActionSchema.optional(),
    failureClass: failureClassSchema.optional(),
    providerStatus: boundedProviderValueSchema.optional(),
    webhookStatus: boundedProviderValueSchema.optional(),
    currentStatus: boundedProviderValueSchema.optional(),
    confidence: unitIntervalSchema.optional(),
    checkCount: z.number().int().nonnegative().max(100).optional(),
    isSynthetic: z.boolean().optional(),
  })
  .strict();

export const auditEntrySchema = z
  .object({
    sequence: z.number().int().positive().safe(),
    entryId: auditEntryIdSchema,
    timestamp: canonicalTimestampSchema,
    actor: auditActorSchema,
    inputReference: z.string().trim().min(1).max(128),
    eventType: auditEventTypeSchema,
    reason: boundedReasonSchema,
    previousState: recoveryCaseStateSchema.nullable(),
    newState: recoveryCaseStateSchema.nullable(),
    previousHash: sha256HashSchema.nullable(),
    currentHash: sha256HashSchema,
    metadata: sanitizedAuditMetadataSchema,
  })
  .strict();

export type AuditActor = z.infer<typeof auditActorSchema>;
export type SanitizedAuditMetadata = z.infer<
  typeof sanitizedAuditMetadataSchema
>;
export type AuditEntry = z.infer<typeof auditEntrySchema>;
