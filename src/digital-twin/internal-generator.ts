import { createHash } from "node:crypto";

import { canonicalizeJson } from "@/audit/canonical-json";
import { RECOVERY_ACTIONS, type RecoveryAction } from "@/domain/actions";
import { FAILURE_CLASSES, type FailureClass } from "@/domain/diagnosis";
import {
  normalizedPaymentEventSchema,
  razorpayStyleExternalWebhookEnvelopeSchema,
  type SupportedWebhookEventName,
} from "@/domain/events";
import { paymentContextSchema } from "@/domain/payments";
import type { NormalizedPaymentStatus } from "@/domain/payments";
import { diagnoseKnownPaymentFailure } from "@/diagnosis";

import {
  DEFAULT_DEVELOPMENT_SEED,
  DEFAULT_HELD_OUT_SEED,
  DIGITAL_TWIN_DATASET_VERSION,
  DIGITAL_TWIN_DISTRIBUTION,
  DIGITAL_TWIN_GENERATED_AT,
  LOCKED_DEFAULT_HELD_OUT_FINGERPRINT_SHA256,
  developmentSeedSchema,
  digitalTwinSelectionBatchSchema,
  heldOutSeedSchema,
  scorerVisibleDigitalTwinCaseSchema,
  type DigitalTwinDelivery,
  type DigitalTwinLogicalEvent,
  type DigitalTwinSelectionBatch,
  type ScorerVisibleDigitalTwinCase,
} from "./contracts";

const BASE_TIME_MILLISECONDS = Date.UTC(2026, 7, 26, 6, 0, 0, 0);
const DEVELOPMENT_CASES_PER_CLASS = 4;

const GROUND_TRUTH_ALLOWED_ACTIONS: Record<
  FailureClass,
  readonly RecoveryAction[]
> = {
  DOWNTIME_OR_TRANSIENT: ["WAIT_FOR_RECOVERY", "ESCALATE_HUMAN"],
  INSUFFICIENT_FUNDS: [
    "REQUEST_METHOD_CHANGE",
    "SEND_PAYMENT_LINK",
    "ESCALATE_HUMAN",
  ],
  CUSTOMER_CORRECTABLE: [
    "SEND_PAYMENT_LINK",
    "REQUEST_METHOD_CHANGE",
    "ESCALATE_HUMAN",
  ],
  NETWORK_OR_INTEGRATION_UNCERTAINTY: ["WAIT_FOR_RECOVERY", "ESCALATE_HUMAN"],
  LATE_SUCCESS: ["CANCEL_RECOVERY_ALREADY_PAID"],
  NON_RETRYABLE: ["STOP_NON_RETRYABLE"],
  AMBIGUOUS: ["ESCALATE_HUMAN"],
};

type SimulatedResolution =
  | "SIMULATED_RECOVERED"
  | "SIMULATED_UNRESOLVED"
  | "SIMULATED_ESCALATED"
  | "SIMULATED_STOPPED_LATE_SUCCESS"
  | "SIMULATED_STOPPED_NON_RETRYABLE";

type HiddenSimulatedOutcome = {
  simulationLabel: "SIMULATED";
  recovered: boolean;
  simulatedRecoveredAmountSubunits: number;
  simulatedRecoveryDelaySeconds: number;
  simulatedCustomerContactCount: number;
  simulatedFalsePositiveCostSubunits: number;
  simulatedResolution: SimulatedResolution;
  simulatedReason: string;
};

export type HiddenGroundTruthRecord = {
  boundary: "EVALUATOR_ONLY_HIDDEN_SIMULATED";
  caseId: ScorerVisibleDigitalTwinCase["caseId"];
  groundTruthFailureClass: FailureClass;
  groundTruthAllowedActions: RecoveryAction[];
  hiddenSimulatedOutcomeByAction: Record<
    RecoveryAction,
    HiddenSimulatedOutcome
  >;
};

type CaseDescriptor = {
  failureClass: FailureClass;
  classOrdinal: number;
};

type GeneratedCase = {
  visibleCase: ScorerVisibleDigitalTwinCase;
  hiddenGroundTruth: HiddenGroundTruthRecord;
};

type PendingDelivery = Omit<
  DigitalTwinDelivery,
  "deliveryId" | "deliveryOrder" | "deliveredAt"
>;

export type HeldOutMaterialForEvaluator = {
  selectionBatch: DigitalTwinSelectionBatch;
  hiddenGroundTruthRecords: HiddenGroundTruthRecord[];
};

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function deterministicInteger(seed: string, label: string, modulo: number) {
  const prefix = sha256(
    `${DIGITAL_TWIN_DATASET_VERSION}|${seed}|${label}`,
  ).slice(0, 12);
  return Number.parseInt(prefix, 16) % modulo;
}

function deterministicShuffle<T>(values: readonly T[], seed: string): T[] {
  const output = [...values];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const replacement = deterministicInteger(
      seed,
      `shuffle:${index}`,
      index + 1,
    );
    [output[index], output[replacement]] = [
      output[replacement] as T,
      output[index] as T,
    ];
  }
  return output;
}

function canonicalTimestamp(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}

function failureDetails(failureClass: FailureClass) {
  switch (failureClass) {
    case "DOWNTIME_OR_TRANSIENT":
      return {
        errorCode: "GATEWAY_ERROR",
        errorSource: "gateway",
        errorStep: "payment_authorization",
        errorReason: "bank_technical_error",
      };
    case "INSUFFICIENT_FUNDS":
      return {
        errorCode: "BAD_REQUEST_ERROR",
        errorSource: "customer",
        errorStep: "payment_authorization",
        errorReason: "insufficient_funds",
      };
    case "CUSTOMER_CORRECTABLE":
      return {
        errorCode: "BAD_REQUEST_ERROR",
        errorSource: "customer",
        errorStep: "payment_authentication",
        errorReason: "incorrect_otp",
      };
    case "NETWORK_OR_INTEGRATION_UNCERTAINTY":
    case "LATE_SUCCESS":
      return {
        errorCode: "GATEWAY_ERROR",
        errorSource: "gateway",
        errorStep: "payment_authorization",
        errorReason: "payment_timed_out",
      };
    case "NON_RETRYABLE":
      return {
        errorCode: "BAD_REQUEST_ERROR",
        errorSource: "business",
        errorStep: "payment_authorization",
        errorReason: "compliance_violation",
      };
    case "AMBIGUOUS":
      return {
        errorCode: "GATEWAY_ERROR",
        errorSource: "gateway",
        errorStep: "payment_authorization",
        errorReason: "synthetic_unclassified_failure",
      };
  }
}

function scenarioFor(descriptor: CaseDescriptor) {
  if (descriptor.failureClass !== "LATE_SUCCESS") {
    return "STANDARD_FAILURE" as const;
  }
  if (descriptor.classOrdinal < 4) return "LATE_AUTHORIZATION" as const;
  if (descriptor.classOrdinal < 7) return "LATER_CAPTURE" as const;
  if (descriptor.classOrdinal < 9) {
    return "CAPTURED_BEFORE_AUTHORIZED_DELIVERY" as const;
  }
  return "STALE_FAILED_AFTER_SUCCESS" as const;
}

function makeLogicalEvent(input: {
  seed: string;
  caseId: string;
  paymentId: string;
  orderId: string;
  amountSubunits: number;
  method: string;
  bankOrProvider: string;
  eventName: SupportedWebhookEventName;
  status: NormalizedPaymentStatus;
  eventCreationOrder: number;
  occurredAtMilliseconds: number;
  failure?: ReturnType<typeof failureDetails>;
}): DigitalTwinLogicalEvent {
  const providerEventId = `evt_dt_${sha256(
    `${input.seed}|${input.caseId}|${input.eventName}|${input.eventCreationOrder}`,
  ).slice(0, 20)}`;
  const occurredAt = canonicalTimestamp(input.occurredAtMilliseconds);
  const externalStatus = input.status.toLowerCase();
  const paymentEntity = {
    id: input.paymentId,
    order_id: input.orderId,
    amount: input.amountSubunits,
    currency: "INR",
    status: externalStatus,
    method: input.method,
    bank: input.bankOrProvider,
    created_at: Math.floor(input.occurredAtMilliseconds / 1_000),
    ...(input.failure === undefined
      ? {}
      : {
          error_code: input.failure.errorCode,
          error_source: input.failure.errorSource,
          error_step: input.failure.errorStep,
          error_reason: input.failure.errorReason,
        }),
  };
  const providerEnvelope = razorpayStyleExternalWebhookEnvelopeSchema.parse({
    entity: "event",
    event: input.eventName,
    contains: ["payment"],
    payload: { payment: { entity: paymentEntity } },
    created_at: Math.floor(input.occurredAtMilliseconds / 1_000),
  });
  const signedContentSha256 = sha256(canonicalizeJson(providerEnvelope));
  const normalizedEvent = normalizedPaymentEventSchema.parse({
    eventId: providerEventId,
    eventName: input.eventName,
    occurredAt,
    receivedAt: occurredAt,
    paymentId: input.paymentId,
    orderId: input.orderId,
    paymentSnapshot: {
      paymentId: input.paymentId,
      orderId: input.orderId,
      money: { amountSubunits: input.amountSubunits, currency: "INR" },
      status: input.status,
      method: input.method,
      bankOrProvider: input.bankOrProvider,
      ...(input.failure === undefined ? {} : { failure: input.failure }),
      paymentCreatedAt: canonicalTimestamp(
        input.occurredAtMilliseconds - input.eventCreationOrder * 60_000,
      ),
    },
    signatureVerification: { status: "NOT_CHECKED" },
    duplicateProcessing: { status: "NOT_CHECKED" },
  });

  return {
    providerEventId: normalizedEvent.eventId,
    eventCreationOrder: input.eventCreationOrder,
    signedContentSha256,
    providerEnvelope,
    normalizedEvent,
  };
}

function createOutcomes(input: {
  seed: string;
  caseId: ScorerVisibleDigitalTwinCase["caseId"];
  failureClass: FailureClass;
  amountSubunits: number;
}): Record<RecoveryAction, HiddenSimulatedOutcome> {
  const probabilities: Record<FailureClass, Record<RecoveryAction, number>> = {
    DOWNTIME_OR_TRANSIENT: {
      WAIT_FOR_RECOVERY: 820_000,
      SEND_PAYMENT_LINK: 360_000,
      REQUEST_METHOD_CHANGE: 410_000,
      CANCEL_RECOVERY_ALREADY_PAID: 0,
      STOP_NON_RETRYABLE: 0,
      ESCALATE_HUMAN: 0,
    },
    INSUFFICIENT_FUNDS: {
      WAIT_FOR_RECOVERY: 280_000,
      SEND_PAYMENT_LINK: 470_000,
      REQUEST_METHOD_CHANGE: 610_000,
      CANCEL_RECOVERY_ALREADY_PAID: 0,
      STOP_NON_RETRYABLE: 0,
      ESCALATE_HUMAN: 0,
    },
    CUSTOMER_CORRECTABLE: {
      WAIT_FOR_RECOVERY: 220_000,
      SEND_PAYMENT_LINK: 690_000,
      REQUEST_METHOD_CHANGE: 590_000,
      CANCEL_RECOVERY_ALREADY_PAID: 0,
      STOP_NON_RETRYABLE: 0,
      ESCALATE_HUMAN: 0,
    },
    NETWORK_OR_INTEGRATION_UNCERTAINTY: {
      WAIT_FOR_RECOVERY: 470_000,
      SEND_PAYMENT_LINK: 310_000,
      REQUEST_METHOD_CHANGE: 290_000,
      CANCEL_RECOVERY_ALREADY_PAID: 0,
      STOP_NON_RETRYABLE: 0,
      ESCALATE_HUMAN: 0,
    },
    LATE_SUCCESS: {
      WAIT_FOR_RECOVERY: 0,
      SEND_PAYMENT_LINK: 0,
      REQUEST_METHOD_CHANGE: 0,
      CANCEL_RECOVERY_ALREADY_PAID: 0,
      STOP_NON_RETRYABLE: 0,
      ESCALATE_HUMAN: 0,
    },
    NON_RETRYABLE: {
      WAIT_FOR_RECOVERY: 0,
      SEND_PAYMENT_LINK: 0,
      REQUEST_METHOD_CHANGE: 0,
      CANCEL_RECOVERY_ALREADY_PAID: 0,
      STOP_NON_RETRYABLE: 0,
      ESCALATE_HUMAN: 0,
    },
    AMBIGUOUS: {
      WAIT_FOR_RECOVERY: 0,
      SEND_PAYMENT_LINK: 0,
      REQUEST_METHOD_CHANGE: 0,
      CANCEL_RECOVERY_ALREADY_PAID: 0,
      STOP_NON_RETRYABLE: 0,
      ESCALATE_HUMAN: 0,
    },
  };

  return Object.fromEntries(
    RECOVERY_ACTIONS.map((action) => {
      const selectedNumber = deterministicInteger(
        input.seed,
        `outcome:${input.caseId}:${action}`,
        1_000_000,
      );
      const recovered =
        selectedNumber < probabilities[input.failureClass][action];
      const isAllowed =
        GROUND_TRUTH_ALLOWED_ACTIONS[input.failureClass].includes(action);
      const isEscalation = action === "ESCALATE_HUMAN";
      const isLateStop =
        input.failureClass === "LATE_SUCCESS" &&
        action === "CANCEL_RECOVERY_ALREADY_PAID";
      const isNonRetryableStop =
        input.failureClass === "NON_RETRYABLE" &&
        action === "STOP_NON_RETRYABLE";
      let simulatedResolution: SimulatedResolution = recovered
        ? "SIMULATED_RECOVERED"
        : "SIMULATED_UNRESOLVED";
      if (isEscalation) simulatedResolution = "SIMULATED_ESCALATED";
      if (isLateStop) simulatedResolution = "SIMULATED_STOPPED_LATE_SUCCESS";
      if (isNonRetryableStop) {
        simulatedResolution = "SIMULATED_STOPPED_NON_RETRYABLE";
      }
      const simulatedCustomerContactCount = [
        "SEND_PAYMENT_LINK",
        "REQUEST_METHOD_CHANGE",
      ].includes(action)
        ? 1
        : 0;

      return [
        action,
        {
          simulationLabel: "SIMULATED",
          recovered,
          simulatedRecoveredAmountSubunits: recovered
            ? input.amountSubunits
            : 0,
          simulatedRecoveryDelaySeconds:
            recovered || isLateStop
              ? 60 +
                deterministicInteger(
                  input.seed,
                  `delay:${input.caseId}:${action}`,
                  7_141,
                )
              : 0,
          simulatedCustomerContactCount,
          simulatedFalsePositiveCostSubunits:
            isAllowed || isEscalation
              ? 0
              : 100 +
                deterministicInteger(
                  input.seed,
                  `false-positive:${input.caseId}:${action}`,
                  901,
                ),
          simulatedResolution,
          simulatedReason:
            "A transparent deterministic rule produced this simulated evaluator-only outcome.",
        },
      ];
    }),
  ) as Record<RecoveryAction, HiddenSimulatedOutcome>;
}

function buildCase(
  seed: string,
  descriptor: CaseDescriptor,
  shuffledIndex: number,
): GeneratedCase {
  const identifierSuffix = sha256(
    `${seed}|${descriptor.failureClass}|${descriptor.classOrdinal}|${shuffledIndex}`,
  ).slice(0, 16);
  const caseId = `case_dt_${identifierSuffix}`;
  const paymentId = `pay_dt_${identifierSuffix}`;
  const orderId = `order_dt_${identifierSuffix}`;
  const amountSubunits =
    5_000 + deterministicInteger(seed, `amount:${identifierSuffix}`, 245_001);
  const methods = ["upi", "card", "netbanking"] as const;
  const method = methods[
    deterministicInteger(seed, `method:${identifierSuffix}`, methods.length)
  ] as (typeof methods)[number];
  const bankOrProvider = `synthetic_${method}_provider`;
  const scenario = scenarioFor(descriptor);
  const caseBaseMilliseconds =
    BASE_TIME_MILLISECONDS + shuffledIndex * 15 * 60_000;
  const failedAtMilliseconds = caseBaseMilliseconds + 60_000;
  const failure = failureDetails(descriptor.failureClass);
  const logicalEvents: DigitalTwinLogicalEvent[] = [
    makeLogicalEvent({
      seed,
      caseId,
      paymentId,
      orderId,
      amountSubunits,
      method,
      bankOrProvider,
      eventName: "payment.failed",
      status: "FAILED",
      eventCreationOrder: 1,
      occurredAtMilliseconds: failedAtMilliseconds,
      failure,
    }),
  ];

  if (scenario === "LATE_AUTHORIZATION") {
    logicalEvents.push(
      makeLogicalEvent({
        seed,
        caseId,
        paymentId,
        orderId,
        amountSubunits,
        method,
        bankOrProvider,
        eventName: "payment.authorized",
        status: "AUTHORIZED",
        eventCreationOrder: 2,
        occurredAtMilliseconds: failedAtMilliseconds + 5 * 60_000,
      }),
    );
  } else if (
    scenario === "LATER_CAPTURE" ||
    scenario === "STALE_FAILED_AFTER_SUCCESS"
  ) {
    logicalEvents.push(
      makeLogicalEvent({
        seed,
        caseId,
        paymentId,
        orderId,
        amountSubunits,
        method,
        bankOrProvider,
        eventName: "payment.captured",
        status: "CAPTURED",
        eventCreationOrder: 2,
        occurredAtMilliseconds: failedAtMilliseconds + 8 * 60_000,
      }),
    );
  } else if (scenario === "CAPTURED_BEFORE_AUTHORIZED_DELIVERY") {
    logicalEvents.push(
      makeLogicalEvent({
        seed,
        caseId,
        paymentId,
        orderId,
        amountSubunits,
        method,
        bankOrProvider,
        eventName: "payment.authorized",
        status: "AUTHORIZED",
        eventCreationOrder: 2,
        occurredAtMilliseconds: failedAtMilliseconds + 4 * 60_000,
      }),
      makeLogicalEvent({
        seed,
        caseId,
        paymentId,
        orderId,
        amountSubunits,
        method,
        bankOrProvider,
        eventName: "payment.captured",
        status: "CAPTURED",
        eventCreationOrder: 3,
        occurredAtMilliseconds: failedAtMilliseconds + 7 * 60_000,
      }),
    );
  }

  const currentStatus: NormalizedPaymentStatus =
    scenario === "LATE_AUTHORIZATION"
      ? "AUTHORIZED"
      : descriptor.failureClass === "LATE_SUCCESS"
        ? "CAPTURED"
        : "FAILED";
  const checkedAt = canonicalTimestamp(failedAtMilliseconds + 10 * 60_000);
  const paymentSatisfaction =
    currentStatus === "AUTHORIZED" || currentStatus === "CAPTURED"
      ? {
          status: "SATISFIED" as const,
          basis:
            currentStatus === "AUTHORIZED"
              ? ("PAYMENT_AUTHORIZED" as const)
              : ("PAYMENT_CAPTURED" as const),
          verifiedAt: checkedAt,
        }
      : {
          status: "UNSATISFIED" as const,
          paymentStatus: "FAILED" as const,
          verifiedAt: checkedAt,
        };
  const hasActiveRecoveryLink =
    descriptor.failureClass === "LATE_SUCCESS"
      ? descriptor.classOrdinal % 2 === 0
      : shuffledIndex % 20 === 0;
  const paymentContext = paymentContextSchema.parse({
    caseId,
    paymentId,
    orderId,
    syntheticCustomerHash: sha256(
      `synthetic-non-production-customer|${seed}|${identifierSuffix}`,
    ),
    money: { amountSubunits, currency: "INR" },
    status: "FAILED",
    method,
    bankOrProvider,
    failure,
    attemptNumber: 1,
    previousSuccessCount: descriptor.failureClass === "LATE_SUCCESS" ? 1 : 0,
    previousFailureCount: 1,
    previousContactCount: deterministicInteger(
      seed,
      `contacts:${identifierSuffix}`,
      3,
    ),
    paymentCreatedAt: canonicalTimestamp(caseBaseMilliseconds),
    eventCreatedAt: canonicalTimestamp(failedAtMilliseconds),
    currentReconciledState: {
      availability: "AVAILABLE",
      status: currentStatus,
      fetchedAt: checkedAt,
    },
    activeRecoveryLink: hasActiveRecoveryLink
      ? { exists: true, recoveryLinkId: `plink_dt_${identifierSuffix}` }
      : { exists: false },
    downtimeContext: {
      availability: "AVAILABLE",
      active: descriptor.failureClass === "DOWNTIME_OR_TRANSIENT",
      ...(descriptor.failureClass === "DOWNTIME_OR_TRANSIENT"
        ? { severity: "synthetic_partial", bankOrProvider }
        : {}),
      observedAt: checkedAt,
    },
  });
  const failureSnapshot = logicalEvents[0]?.normalizedEvent.paymentSnapshot;
  if (failureSnapshot === undefined) {
    throw new Error("Synthetic failure event requires a payment snapshot.");
  }
  const diagnosis = diagnoseKnownPaymentFailure({
    caseId: paymentContext.caseId,
    paymentSnapshot: failureSnapshot,
    paymentSatisfaction,
    downtimeContext: paymentContext.downtimeContext,
    activeRecoveryLink: paymentContext.activeRecoveryLink,
    diagnosedAt: checkedAt,
  });
  const visibleCase = scorerVisibleDigitalTwinCaseSchema.parse({
    datasetVersion: DIGITAL_TWIN_DATASET_VERSION,
    boundary: "SCORER_VISIBLE_SYNTHETIC",
    caseId: paymentContext.caseId,
    syntheticCustomerReference: `synthetic-non-production:${sha256(
      `reference|${seed}|${identifierSuffix}`,
    ).slice(0, 16)}`,
    scenario,
    paymentContext,
    paymentSatisfaction,
    diagnosis,
    attemptHistory: logicalEvents.map((event) => ({
      attemptNumber: 1,
      status: event.normalizedEvent.paymentSnapshot?.status,
      occurredAt: event.normalizedEvent.occurredAt,
      providerEventId: event.providerEventId,
    })),
    logicalEvents,
  });
  const hiddenGroundTruth: HiddenGroundTruthRecord = {
    boundary: "EVALUATOR_ONLY_HIDDEN_SIMULATED",
    caseId: visibleCase.caseId,
    groundTruthFailureClass: descriptor.failureClass,
    groundTruthAllowedActions: [
      ...GROUND_TRUTH_ALLOWED_ACTIONS[descriptor.failureClass],
    ],
    hiddenSimulatedOutcomeByAction: createOutcomes({
      seed,
      caseId: visibleCase.caseId,
      failureClass: descriptor.failureClass,
      amountSubunits,
    }),
  };
  return { visibleCase, hiddenGroundTruth };
}

function descriptorsForHeldOut(): CaseDescriptor[] {
  return FAILURE_CLASSES.flatMap((failureClass) =>
    Array.from(
      { length: DIGITAL_TWIN_DISTRIBUTION[failureClass] },
      (_value, classOrdinal) => ({ failureClass, classOrdinal }),
    ),
  );
}

function descriptorsForDevelopment(): CaseDescriptor[] {
  return FAILURE_CLASSES.flatMap((failureClass) =>
    Array.from(
      { length: DEVELOPMENT_CASES_PER_CLASS },
      (_value, classOrdinal) => ({ failureClass, classOrdinal }),
    ),
  );
}

function eventDeliveryOrder(visibleCase: ScorerVisibleDigitalTwinCase) {
  if (visibleCase.scenario === "CAPTURED_BEFORE_AUTHORIZED_DELIVERY") {
    return [
      visibleCase.logicalEvents[0],
      visibleCase.logicalEvents[2],
      visibleCase.logicalEvents[1],
    ].filter((event): event is DigitalTwinLogicalEvent => event !== undefined);
  }
  if (visibleCase.scenario === "STALE_FAILED_AFTER_SUCCESS") {
    return [visibleCase.logicalEvents[1], visibleCase.logicalEvents[0]].filter(
      (event): event is DigitalTwinLogicalEvent => event !== undefined,
    );
  }
  return visibleCase.logicalEvents;
}

function pendingDelivery(
  event: DigitalTwinLogicalEvent,
  overlay: PendingDelivery["overlay"],
): PendingDelivery {
  const paymentId = event.normalizedEvent.paymentId;
  if (paymentId === undefined) {
    throw new Error("Synthetic payment delivery requires a payment ID.");
  }
  return {
    providerEventId: event.providerEventId,
    paymentId,
    eventCreationOrder: event.eventCreationOrder,
    overlay,
    signedContentSha256: event.signedContentSha256,
    normalizedEvent: event.normalizedEvent,
  };
}

function buildDeliveries(
  cases: readonly ScorerVisibleDigitalTwinCase[],
  heldOut: boolean,
): DigitalTwinDelivery[] {
  const pending: PendingDelivery[] = [];
  for (const [caseIndex, visibleCase] of cases.entries()) {
    const orderedEvents = eventDeliveryOrder(visibleCase);
    for (const [eventIndex, event] of orderedEvents.entries()) {
      pending.push(pendingDelivery(event, "ORIGINAL"));
      if (heldOut && caseIndex < 5 && eventIndex === 0) {
        pending.push(pendingDelivery(event, "SEQUENTIAL_DUPLICATE"));
      }
    }
  }
  if (heldOut) {
    for (let caseIndex = 5; caseIndex < 13; caseIndex += 1) {
      const event = eventDeliveryOrder(
        cases[caseIndex] as ScorerVisibleDigitalTwinCase,
      )[0];
      if (event === undefined) {
        throw new Error("Non-adjacent duplicate source event is missing.");
      }
      pending.push(pendingDelivery(event, "NON_ADJACENT_DUPLICATE"));
    }
  }

  return pending.map((delivery, index) => ({
    ...delivery,
    deliveryId: `delivery_dt_${String(index + 1).padStart(3, "0")}_${sha256(
      `${delivery.providerEventId}|${delivery.overlay}|${index + 1}`,
    ).slice(0, 10)}`,
    deliveryOrder: index + 1,
    deliveredAt: canonicalTimestamp(
      BASE_TIME_MILLISECONDS + 2 * 24 * 60 * 60_000 + index * 1_000,
    ),
  }));
}

function distributionOf(records: readonly HiddenGroundTruthRecord[]) {
  return Object.fromEntries(
    FAILURE_CLASSES.map((failureClass) => [
      failureClass,
      records.filter(
        (record) => record.groundTruthFailureClass === failureClass,
      ).length,
    ]),
  ) as Record<FailureClass, number>;
}

function buildDataset(input: {
  seed: string;
  datasetKind: "DEVELOPMENT" | "HELD_OUT";
  descriptors: CaseDescriptor[];
}): HeldOutMaterialForEvaluator {
  const generated = deterministicShuffle(input.descriptors, input.seed).map(
    (descriptor, index) => buildCase(input.seed, descriptor, index),
  );
  const cases = generated.map(({ visibleCase }) => visibleCase);
  const hiddenGroundTruthRecords = generated.map(
    ({ hiddenGroundTruth }) => hiddenGroundTruth,
  );
  const deliveries = buildDeliveries(cases, input.datasetKind === "HELD_OUT");
  const uniqueProviderEventCount = new Set(
    deliveries.map(({ providerEventId }) => providerEventId),
  ).size;
  const distribution = distributionOf(hiddenGroundTruthRecords);
  const withoutManifest = {
    datasetVersion: DIGITAL_TWIN_DATASET_VERSION,
    datasetKind: input.datasetKind,
    boundary:
      input.datasetKind === "DEVELOPMENT"
        ? ("DEVELOPMENT_SCORER_VISIBLE_SYNTHETIC" as const)
        : ("HELD_OUT_SCORER_VISIBLE_SYNTHETIC" as const),
    seed: input.seed,
    generatedAt: DIGITAL_TWIN_GENERATED_AT,
    cases,
    deliveries,
  };
  const fingerprintSha256 = sha256(
    canonicalizeJson({
      ...withoutManifest,
      evaluatorOnlyHiddenSimulatedGroundTruth: hiddenGroundTruthRecords,
    }),
  );
  const selectionBatch = digitalTwinSelectionBatchSchema.parse({
    ...withoutManifest,
    manifest: {
      datasetVersion: DIGITAL_TWIN_DATASET_VERSION,
      datasetKind: input.datasetKind,
      seed: input.seed,
      generatedAt: DIGITAL_TWIN_GENERATED_AT,
      fingerprintSha256,
      uniquePaymentCount: cases.length,
      uniqueProviderEventCount,
      deliveryCount: deliveries.length,
      duplicateDeliveryCount: deliveries.length - uniqueProviderEventCount,
      sequentialDuplicateCount: deliveries.filter(
        ({ overlay }) => overlay === "SEQUENTIAL_DUPLICATE",
      ).length,
      nonAdjacentDuplicateCount: deliveries.filter(
        ({ overlay }) => overlay === "NON_ADJACENT_DUPLICATE",
      ).length,
      outOfOrderCaseCount: cases.filter(({ scenario }) =>
        [
          "CAPTURED_BEFORE_AUTHORIZED_DELIVERY",
          "STALE_FAILED_AFTER_SUCCESS",
        ].includes(scenario),
      ).length,
      lateAuthorizationCaseCount: cases.filter(
        ({ scenario }) => scenario === "LATE_AUTHORIZATION",
      ).length,
      laterCaptureCaseCount: cases.filter(
        ({ scenario }) => scenario === "LATER_CAPTURE",
      ).length,
      capturedBeforeAuthorizedCaseCount: cases.filter(
        ({ scenario }) => scenario === "CAPTURED_BEFORE_AUTHORIZED_DELIVERY",
      ).length,
      staleFailureAfterSuccessCaseCount: cases.filter(
        ({ scenario }) => scenario === "STALE_FAILED_AFTER_SUCCESS",
      ).length,
      distribution,
    },
  });

  return { selectionBatch, hiddenGroundTruthRecords };
}

export function generateHeldOutMaterialForEvaluator(
  rawSeed: string = DEFAULT_HELD_OUT_SEED,
): HeldOutMaterialForEvaluator {
  const seed = heldOutSeedSchema.parse(rawSeed);
  const material = buildDataset({
    seed,
    datasetKind: "HELD_OUT",
    descriptors: descriptorsForHeldOut(),
  });
  if (
    material.selectionBatch.cases.length !== 100 ||
    material.selectionBatch.deliveries.length !== 125
  ) {
    throw new Error("Locked held-out Digital Twin cardinality changed.");
  }
  if (
    canonicalizeJson(material.selectionBatch.manifest.distribution) !==
    canonicalizeJson(DIGITAL_TWIN_DISTRIBUTION)
  ) {
    throw new Error("Locked held-out Digital Twin distribution changed.");
  }
  if (
    seed === DEFAULT_HELD_OUT_SEED &&
    material.selectionBatch.manifest.fingerprintSha256 !==
      LOCKED_DEFAULT_HELD_OUT_FINGERPRINT_SHA256
  ) {
    throw new Error(
      "Default held-out Digital Twin fingerprint changed without a versioned lock update.",
    );
  }
  return material;
}

export function generateDevelopmentMaterial(
  rawSeed: string = DEFAULT_DEVELOPMENT_SEED,
): DigitalTwinSelectionBatch {
  const seed = developmentSeedSchema.parse(rawSeed);
  return buildDataset({
    seed,
    datasetKind: "DEVELOPMENT",
    descriptors: descriptorsForDevelopment(),
  }).selectionBatch;
}
