import { z } from "zod";

import { failureDiagnosisSchema } from "@/domain/diagnosis";
import {
  normalizedPaymentEventSchema,
  razorpayStyleExternalWebhookEnvelopeSchema,
} from "@/domain/events";
import { paymentSatisfactionContextSchema } from "@/domain/payment-satisfaction";
import {
  normalizedPaymentStatusSchema,
  paymentContextSchema,
} from "@/domain/payments";
import {
  canonicalTimestampSchema,
  caseIdSchema,
  eventIdSchema,
  nonnegativeCountSchema,
  paymentIdSchema,
  positiveCountSchema,
} from "@/domain/primitives";

export const DIGITAL_TWIN_DATASET_VERSION =
  "recoverai-payment-failure-digital-twin-v1" as const;
export const DEFAULT_DEVELOPMENT_SEED =
  "recoverai-development:2026-v1" as const;
export const DEFAULT_HELD_OUT_SEED = "recoverai-held-out:2026-v1" as const;
export const DIGITAL_TWIN_GENERATED_AT = "2026-08-26T00:00:00.000Z" as const;
export const LOCKED_DEFAULT_HELD_OUT_FINGERPRINT_SHA256 =
  "2065d1d50588ac7b8e8cf0782e7ae647c59bc02fedc71b856ca7c6d49f96ecdb" as const;

export const developmentSeedSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(
    /^recoverai-development:[A-Za-z0-9._:-]+$/,
    "Development seeds must use the recoverai-development namespace.",
  );

export const heldOutSeedSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(
    /^recoverai-held-out:[A-Za-z0-9._:-]+$/,
    "Held-out seeds must use the recoverai-held-out namespace.",
  );

export const DIGITAL_TWIN_DISTRIBUTION = {
  DOWNTIME_OR_TRANSIENT: 25,
  INSUFFICIENT_FUNDS: 20,
  CUSTOMER_CORRECTABLE: 15,
  NETWORK_OR_INTEGRATION_UNCERTAINTY: 15,
  LATE_SUCCESS: 10,
  NON_RETRYABLE: 10,
  AMBIGUOUS: 5,
} as const;

export const digitalTwinDistributionSchema = z
  .object({
    DOWNTIME_OR_TRANSIENT: nonnegativeCountSchema,
    INSUFFICIENT_FUNDS: nonnegativeCountSchema,
    CUSTOMER_CORRECTABLE: nonnegativeCountSchema,
    NETWORK_OR_INTEGRATION_UNCERTAINTY: nonnegativeCountSchema,
    LATE_SUCCESS: nonnegativeCountSchema,
    NON_RETRYABLE: nonnegativeCountSchema,
    AMBIGUOUS: nonnegativeCountSchema,
  })
  .strict();

export const digitalTwinScenarioSchema = z.enum([
  "STANDARD_FAILURE",
  "LATE_AUTHORIZATION",
  "LATER_CAPTURE",
  "CAPTURED_BEFORE_AUTHORIZED_DELIVERY",
  "STALE_FAILED_AFTER_SUCCESS",
]);

export const digitalTwinAttemptSchema = z
  .object({
    attemptNumber: positiveCountSchema,
    status: normalizedPaymentStatusSchema,
    occurredAt: canonicalTimestampSchema,
    providerEventId: eventIdSchema,
  })
  .strict();

export const digitalTwinLogicalEventSchema = z
  .object({
    providerEventId: eventIdSchema,
    eventCreationOrder: positiveCountSchema,
    signedContentSha256: z.string().regex(/^[a-f0-9]{64}$/),
    providerEnvelope: razorpayStyleExternalWebhookEnvelopeSchema,
    normalizedEvent: normalizedPaymentEventSchema,
  })
  .strict();

export const scorerVisibleDigitalTwinCaseSchema = z
  .object({
    datasetVersion: z.literal(DIGITAL_TWIN_DATASET_VERSION),
    boundary: z.literal("SCORER_VISIBLE_SYNTHETIC"),
    caseId: caseIdSchema,
    syntheticCustomerReference: z
      .string()
      .regex(/^synthetic-non-production:[a-f0-9]{16}$/),
    scenario: digitalTwinScenarioSchema,
    paymentContext: paymentContextSchema,
    paymentSatisfaction: paymentSatisfactionContextSchema,
    diagnosis: failureDiagnosisSchema,
    attemptHistory: z.array(digitalTwinAttemptSchema).min(1).max(4),
    logicalEvents: z.array(digitalTwinLogicalEventSchema).min(1).max(4),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.paymentContext.caseId !== value.caseId) {
      context.addIssue({
        code: "custom",
        path: ["paymentContext", "caseId"],
        message: "Payment context must belong to the Digital Twin case.",
      });
    }
    if (value.diagnosis.caseId !== value.caseId) {
      context.addIssue({
        code: "custom",
        path: ["diagnosis", "caseId"],
        message: "Diagnosis must belong to the Digital Twin case.",
      });
    }
    const paymentId = value.paymentContext.paymentId;
    if (
      value.logicalEvents.some(
        ({ normalizedEvent }) => normalizedEvent.paymentId !== paymentId,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["logicalEvents"],
        message: "Every logical event must belong to the Digital Twin payment.",
      });
    }
    const creationOrders = value.logicalEvents.map(
      ({ eventCreationOrder }) => eventCreationOrder,
    );
    if (
      creationOrders.some((order, index) => order !== index + 1) ||
      new Set(creationOrders).size !== creationOrders.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["logicalEvents"],
        message: "Logical event creation order must be contiguous from one.",
      });
    }
  });

export const deliveryOverlaySchema = z.enum([
  "ORIGINAL",
  "SEQUENTIAL_DUPLICATE",
  "NON_ADJACENT_DUPLICATE",
]);

export const digitalTwinDeliverySchema = z
  .object({
    deliveryId: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    providerEventId: eventIdSchema,
    paymentId: paymentIdSchema,
    deliveryOrder: positiveCountSchema,
    eventCreationOrder: positiveCountSchema,
    deliveredAt: canonicalTimestampSchema,
    overlay: deliveryOverlaySchema,
    signedContentSha256: z.string().regex(/^[a-f0-9]{64}$/),
    normalizedEvent: normalizedPaymentEventSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.normalizedEvent.eventId !== value.providerEventId) {
      context.addIssue({
        code: "custom",
        path: ["providerEventId"],
        message: "Delivery identity must match its normalized provider event.",
      });
    }
    if (value.normalizedEvent.paymentId !== value.paymentId) {
      context.addIssue({
        code: "custom",
        path: ["paymentId"],
        message: "Delivery payment must match its normalized provider event.",
      });
    }
  });

export const digitalTwinManifestSchema = z
  .object({
    datasetVersion: z.literal(DIGITAL_TWIN_DATASET_VERSION),
    datasetKind: z.enum(["DEVELOPMENT", "HELD_OUT"]),
    seed: z.string().trim().min(1).max(128),
    generatedAt: z.literal(DIGITAL_TWIN_GENERATED_AT),
    fingerprintSha256: z.string().regex(/^[a-f0-9]{64}$/),
    uniquePaymentCount: positiveCountSchema,
    uniqueProviderEventCount: positiveCountSchema,
    deliveryCount: positiveCountSchema,
    duplicateDeliveryCount: nonnegativeCountSchema,
    sequentialDuplicateCount: nonnegativeCountSchema,
    nonAdjacentDuplicateCount: nonnegativeCountSchema,
    outOfOrderCaseCount: nonnegativeCountSchema,
    lateAuthorizationCaseCount: nonnegativeCountSchema,
    laterCaptureCaseCount: nonnegativeCountSchema,
    capturedBeforeAuthorizedCaseCount: nonnegativeCountSchema,
    staleFailureAfterSuccessCaseCount: nonnegativeCountSchema,
    distribution: digitalTwinDistributionSchema,
  })
  .strict();

export const digitalTwinSelectionBatchSchema = z
  .object({
    datasetVersion: z.literal(DIGITAL_TWIN_DATASET_VERSION),
    datasetKind: z.enum(["DEVELOPMENT", "HELD_OUT"]),
    boundary: z.enum([
      "DEVELOPMENT_SCORER_VISIBLE_SYNTHETIC",
      "HELD_OUT_SCORER_VISIBLE_SYNTHETIC",
    ]),
    seed: z.string().trim().min(1).max(128),
    generatedAt: z.literal(DIGITAL_TWIN_GENERATED_AT),
    cases: z.array(scorerVisibleDigitalTwinCaseSchema).min(1),
    deliveries: z.array(digitalTwinDeliverySchema).min(1),
    manifest: digitalTwinManifestSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.manifest.seed !== value.seed) {
      context.addIssue({
        code: "custom",
        path: ["manifest", "seed"],
        message: "Manifest seed must match the dataset seed.",
      });
    }
    if (value.manifest.datasetKind !== value.datasetKind) {
      context.addIssue({
        code: "custom",
        path: ["manifest", "datasetKind"],
        message: "Manifest kind must match the dataset kind.",
      });
    }
    const expectedBoundary =
      value.datasetKind === "DEVELOPMENT"
        ? "DEVELOPMENT_SCORER_VISIBLE_SYNTHETIC"
        : "HELD_OUT_SCORER_VISIBLE_SYNTHETIC";
    if (value.boundary !== expectedBoundary) {
      context.addIssue({
        code: "custom",
        path: ["boundary"],
        message: "Dataset kind must use its dedicated scorer-visible boundary.",
      });
    }
    if (
      new Set(value.cases.map(({ caseId }) => caseId)).size !==
      value.cases.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["cases"],
        message: "Digital Twin case IDs must be unique.",
      });
    }
    if (
      new Set(value.cases.map(({ paymentContext }) => paymentContext.paymentId))
        .size !== value.cases.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["cases"],
        message: "Digital Twin payment IDs must be unique.",
      });
    }
    if (
      value.deliveries.some(
        ({ deliveryOrder }, index) => deliveryOrder !== index + 1,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["deliveries"],
        message: "Delivery order must be contiguous from one.",
      });
    }
  });

export type ScorerVisibleDigitalTwinCase = z.infer<
  typeof scorerVisibleDigitalTwinCaseSchema
>;
export type DigitalTwinLogicalEvent = z.infer<
  typeof digitalTwinLogicalEventSchema
>;
export type DigitalTwinDelivery = z.infer<typeof digitalTwinDeliverySchema>;
export type DigitalTwinManifest = z.infer<typeof digitalTwinManifestSchema>;
export type DigitalTwinSelectionBatch = z.infer<
  typeof digitalTwinSelectionBatchSchema
>;
