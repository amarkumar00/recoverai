import { z } from "zod";

import { RECOVERY_ACTIONS, recoveryActionSchema } from "@/domain/actions";
import { failureClassSchema } from "@/domain/diagnosis";
import { normalizedPaymentStatusSchema } from "@/domain/payments";
import { policyOutcomeSchema } from "@/domain/policy";
import {
  boundedReasonSchema,
  canonicalTimestampSchema,
  nonnegativeCountSchema,
} from "@/domain/primitives";
import { recoveryCaseStateSchema } from "@/domain/states";
import { DEMO_SCENARIO_KEYS } from "@/lib/db/schema";

export const dashboardScenarioKeySchema = z.enum(DEMO_SCENARIO_KEYS);

export const dashboardScenarioEventSchema = z
  .object({
    delivery: z.number().int().positive(),
    eventType: z.string().trim().min(1).max(64),
    safeReference: z.string().trim().min(1).max(128),
    deliveredAt: canonicalTimestampSchema,
    signatureStatus: z.enum(["VERIFIED", "NOT_CHECKED"]),
    deliveryStatus: z.enum([
      "ORIGINAL",
      "DUPLICATE_IGNORED",
      "OUT_OF_ORDER",
      "STALE_IGNORED",
    ]),
    webhookSnapshotState: normalizedPaymentStatusSchema.nullable(),
    authoritativeCurrentState: normalizedPaymentStatusSchema.nullable(),
    diagnosis: failureClassSchema.nullable(),
    proposedAction: recoveryActionSchema.nullable(),
    policyOutcome: policyOutcomeSchema.nullable(),
    finalAction: recoveryActionSchema.nullable(),
    resultingCaseState: recoveryCaseStateSchema.nullable(),
  })
  .strict();

export const dashboardScenarioResultSchema = z
  .object({
    scenarioKey: dashboardScenarioKeySchema,
    title: z.string().trim().min(1).max(100),
    completedAt: canonicalTimestampSchema,
    summary: boundedReasonSchema,
    resultCode: z.string().trim().min(1).max(64),
    policyOutcome: policyOutcomeSchema.nullable(),
    primaryRule: z.string().trim().min(1).max(64).nullable(),
    proposedAction: recoveryActionSchema.nullable(),
    finalAction: recoveryActionSchema.nullable(),
    finalCaseState: recoveryCaseStateSchema.nullable(),
    authoritativePaymentState: normalizedPaymentStatusSchema.nullable(),
    counters: z
      .object({
        acceptedDeliveries: nonnegativeCountSchema,
        duplicatesIgnored: nonnegativeCountSchema,
        caseTransitions: nonnegativeCountSchema,
        customerContacts: nonnegativeCountSchema,
        paymentLinksCreated: nonnegativeCountSchema,
        paymentLinksCancelled: nonnegativeCountSchema,
        automaticRetries: z.literal(0),
        simulatedRevenueRecoveredSubunits: nonnegativeCountSchema,
      })
      .strict(),
    evidence: z.array(z.string().trim().min(1).max(300)).min(2).max(12),
    policyChecks: z
      .array(
        z
          .object({
            ruleId: z.string().trim().min(1).max(64),
            status: z.enum(["PASSED", "FAILED", "NOT_APPLICABLE"]),
            reason: boundedReasonSchema,
          })
          .strict(),
      )
      .min(1)
      .max(20),
    events: z.array(dashboardScenarioEventSchema).max(8),
    auditEvidence: z
      .array(
        z
          .object({
            eventType: z.string().trim().min(1).max(64),
            actor: z.string().trim().min(1).max(64),
            reason: boundedReasonSchema,
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict();

export const scenarioCardSchema = z
  .object({
    scenarioKey: dashboardScenarioKeySchema,
    title: z.string().trim().min(1).max(100),
    description: boundedReasonSchema,
    status: z.enum(["READY", "COMPLETED"]),
    result: dashboardScenarioResultSchema.optional(),
  })
  .strict();

export const demoScenarioDashboardSchema = z
  .object({
    mode: z.literal("SYNTHETIC_DEMO"),
    resetPreservesAuditHistory: z.literal(true),
    scenarios: z.array(scenarioCardSchema).length(DEMO_SCENARIO_KEYS.length),
  })
  .strict();

export const runScenarioRequestSchema = z
  .object({ scenarioKey: dashboardScenarioKeySchema })
  .strict();

export const resetDemoRequestSchema = z
  .object({ confirmation: z.literal("RESET_DETERMINISTIC_DEMO") })
  .strict();

export const safeEventStreamRowSchema = dashboardScenarioEventSchema.extend({
  caseReference: z.string().trim().min(1).max(128).nullable(),
});

export const eventStreamReadModelSchema = z
  .object({
    rows: z.array(safeEventStreamRowSchema).max(250),
    generatedFrom: z.enum([
      "EMPTY_DEMO",
      "PERSISTED_DEMO_SCENARIOS",
      "PERSISTED_OPERATIONAL_EVENTS",
      "COMBINED",
    ]),
  })
  .strict();

export const policyReadModelSchema = z
  .object({
    maxPaymentLinksPerOrder: nonnegativeCountSchema,
    maxCustomerContacts: nonnegativeCountSchema,
    maxRecoveryWindowHours: z.number().positive(),
    minimumConfidencePercent: z.number().min(0).max(100),
    allowedActions: z
      .array(recoveryActionSchema)
      .length(RECOVERY_ACTIONS.length),
    integrityRules: z.array(z.string().trim().min(1).max(200)).min(1),
    recentDecisions: z
      .array(
        z
          .object({
            caseReference: z.string().trim().min(1).max(128),
            proposedAction: recoveryActionSchema,
            finalAction: recoveryActionSchema.nullable(),
            outcome: policyOutcomeSchema,
            primaryRule: z.string().trim().min(1).max(64),
            reason: boundedReasonSchema,
            checks: z.array(
              z
                .object({
                  ruleId: z.string().trim().min(1).max(64),
                  status: z.enum(["PASSED", "FAILED", "NOT_APPLICABLE"]),
                  reason: boundedReasonSchema,
                })
                .strict(),
            ),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

export const auditReadModelSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("VALID"),
      chainVersion: z.string().trim().min(1).max(64),
      entryCount: nonnegativeCountSchema,
      latestSequence: nonnegativeCountSchema,
      headHash: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .nullable(),
      entries: z.array(
        z
          .object({
            sequence: z.number().int().positive(),
            timestamp: canonicalTimestampSchema,
            actor: z.string().trim().min(1).max(64),
            inputReference: z.string().trim().min(1).max(128),
            eventType: z.string().trim().min(1).max(64),
            reason: boundedReasonSchema,
            previousState: recoveryCaseStateSchema.nullable(),
            newState: recoveryCaseStateSchema.nullable(),
            previousHash: z
              .string()
              .regex(/^[a-f0-9]{64}$/)
              .nullable(),
            currentHash: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      ),
    })
    .strict(),
  z
    .object({
      status: z.literal("INVALID"),
      issue: z.string().trim().min(1).max(64),
      entries: z.tuple([]),
    })
    .strict(),
]);

export type DashboardScenarioKey = z.infer<typeof dashboardScenarioKeySchema>;
export type DashboardScenarioResult = z.infer<
  typeof dashboardScenarioResultSchema
>;
export type DemoScenarioDashboard = z.infer<typeof demoScenarioDashboardSchema>;
export type EventStreamReadModel = z.infer<typeof eventStreamReadModelSchema>;
export type PolicyReadModel = z.infer<typeof policyReadModelSchema>;
export type AuditReadModel = z.infer<typeof auditReadModelSchema>;
