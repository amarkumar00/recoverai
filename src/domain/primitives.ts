import { z } from "zod";

const IDENTIFIER_MAX_LENGTH = 128;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function identifierSchema<TBrand extends string>(label: string) {
  return z
    .string()
    .trim()
    .min(1, `${label} cannot be empty.`)
    .max(IDENTIFIER_MAX_LENGTH, `${label} is too long.`)
    .regex(IDENTIFIER_PATTERN, `${label} contains unsupported characters.`)
    .brand<TBrand>();
}

export const caseIdSchema = identifierSchema<"CaseId">("Case ID");
export const eventIdSchema = identifierSchema<"EventId">("Event ID");
export const paymentIdSchema = identifierSchema<"PaymentId">("Payment ID");
export const orderIdSchema = identifierSchema<"OrderId">("Order ID");
export const recoveryLinkIdSchema =
  identifierSchema<"RecoveryLinkId">("Recovery Link ID");
export const evaluationRunIdSchema =
  identifierSchema<"EvaluationRunId">("Evaluation Run ID");
export const auditEntryIdSchema =
  identifierSchema<"AuditEntryId">("Audit Entry ID");

export const syntheticCustomerHashSchema = z
  .string()
  .regex(
    /^[a-f0-9]{64}$/,
    "Synthetic customer hash must be a lowercase SHA-256 hex value.",
  )
  .brand<"SyntheticCustomerHash">();

export const boundedProviderValueSchema = z.string().trim().min(1).max(128);
export const boundedReasonSchema = z.string().trim().min(1).max(1_000);
export const boundedExplanationSchema = z.string().trim().min(1).max(500);
export const evidenceCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Z][A-Z0-9_]*$/);

export const evidenceItemSchema = z
  .object({
    code: evidenceCodeSchema,
    detail: z.string().trim().min(1).max(500),
  })
  .strict();

// Canonical internal timestamps are UTC ISO 8601 with millisecond precision.
export const canonicalTimestampSchema = z.iso.datetime({
  offset: false,
  local: false,
  precision: 3,
});

export const unixTimestampSecondsSchema = z.number().int().nonnegative().safe();

export const currencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, "Currency must be an uppercase ISO-style code.");

export const amountSubunitsSchema = z.number().int().nonnegative().safe();
export const payableAmountSubunitsSchema = amountSubunitsSchema.min(1);
export const signedSubunitDeltaSchema = z.number().int().safe();

export const moneySchema = z
  .object({
    amountSubunits: amountSubunitsSchema,
    currency: currencyCodeSchema,
  })
  .strict();

export const payableMoneySchema = z
  .object({
    amountSubunits: payableAmountSubunitsSchema,
    currency: currencyCodeSchema,
  })
  .strict();

// Deltas are signed so an honest evaluation can report regression.
export const moneyDeltaSchema = z
  .object({
    subunitDelta: signedSubunitDeltaSchema,
    currency: currencyCodeSchema,
  })
  .strict();

export const nonnegativeCountSchema = z.number().int().nonnegative().safe();
export const positiveCountSchema = z.number().int().positive().safe();
export const unitIntervalSchema = z.number().finite().min(0).max(1);

export type CaseId = z.infer<typeof caseIdSchema>;
export type EventId = z.infer<typeof eventIdSchema>;
export type PaymentId = z.infer<typeof paymentIdSchema>;
export type OrderId = z.infer<typeof orderIdSchema>;
export type RecoveryLinkId = z.infer<typeof recoveryLinkIdSchema>;
export type EvaluationRunId = z.infer<typeof evaluationRunIdSchema>;
export type AuditEntryId = z.infer<typeof auditEntryIdSchema>;
export type SyntheticCustomerHash = z.infer<typeof syntheticCustomerHashSchema>;
export type EvidenceItem = z.infer<typeof evidenceItemSchema>;
export type Money = z.infer<typeof moneySchema>;
export type PayableMoney = z.infer<typeof payableMoneySchema>;
export type MoneyDelta = z.infer<typeof moneyDeltaSchema>;
