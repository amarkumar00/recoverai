import { z } from "zod";

import { trustedScoringConfigSchema } from "@/ai";
import { normalizedPaymentEventSchema } from "@/domain";
import {
  canonicalTimestampSchema,
  caseIdSchema,
  currencyCodeSchema,
  eventIdSchema,
  orderIdSchema,
  payableAmountSubunitsSchema,
  paymentIdSchema,
  syntheticCustomerHashSchema,
} from "@/domain/primitives";
import { recoveryCaseRecordSchema } from "@/repositories/contracts";

export const DEMO_SCENARIO_VERSION = "recoverai_demo_v1" as const;

const demoTimesSchema = z
  .object({
    event: canonicalTimestampSchema,
    caseCreated: canonicalTimestampSchema,
    verifying: canonicalTimestampSchema,
    diagnosed: canonicalTimestampSchema,
    recommended: canonicalTimestampSchema,
    policy: canonicalTimestampSchema,
    executed: canonicalTimestampSchema,
    linkExpires: canonicalTimestampSchema,
    paid: canonicalTimestampSchema,
    recovered: canonicalTimestampSchema,
  })
  .strict();

const demoScenarioSchema = z
  .object({
    version: z.literal(DEMO_SCENARIO_VERSION),
    caseId: caseIdSchema,
    paymentId: paymentIdSchema,
    orderId: orderIdSchema,
    failureEventId: eventIdSchema,
    failureProviderEventId: eventIdSchema,
    paidEventId: eventIdSchema,
    paidProviderEventId: eventIdSchema,
    recommendationId: z.string().min(1).max(128),
    decisionId: z.string().min(1).max(128),
    syntheticCustomerHash: syntheticCustomerHashSchema,
    amountSubunits: payableAmountSubunitsSchema,
    currency: currencyCodeSchema,
    seed: z.string().min(1).max(128),
    times: demoTimesSchema,
    failureEvent: normalizedPaymentEventSchema,
    initialCase: recoveryCaseRecordSchema,
    scoringConfig: trustedScoringConfigSchema,
  })
  .strict();

const scoringConfig = trustedScoringConfigSchema.parse({
  providerTimeoutMilliseconds: 1_000,
  actionPenalties: {
    WAIT_FOR_RECOVERY: {
      contactCostSubunits: 0,
      frictionPenaltySubunits: 100,
      duplicatePaymentRiskPenaltySubunits: 100,
      operationalCostSubunits: 50,
    },
    SEND_PAYMENT_LINK: {
      contactCostSubunits: 200,
      frictionPenaltySubunits: 300,
      duplicatePaymentRiskPenaltySubunits: 400,
      operationalCostSubunits: 100,
    },
    REQUEST_METHOD_CHANGE: {
      contactCostSubunits: 200,
      frictionPenaltySubunits: 350,
      duplicatePaymentRiskPenaltySubunits: 200,
      operationalCostSubunits: 120,
    },
    CANCEL_RECOVERY_ALREADY_PAID: {
      contactCostSubunits: 0,
      frictionPenaltySubunits: 0,
      duplicatePaymentRiskPenaltySubunits: 0,
      operationalCostSubunits: 20,
    },
    STOP_NON_RETRYABLE: {
      contactCostSubunits: 0,
      frictionPenaltySubunits: 0,
      duplicatePaymentRiskPenaltySubunits: 0,
      operationalCostSubunits: 30,
    },
    ESCALATE_HUMAN: {
      contactCostSubunits: 0,
      frictionPenaltySubunits: 0,
      duplicatePaymentRiskPenaltySubunits: 0,
      operationalCostSubunits: 500,
    },
  },
});

function scenario(values: {
  caseId: string;
  paymentId: string;
  orderId: string;
  suffix: string;
  customerHashCharacter: string;
  amountSubunits: number;
  errorReason: string;
}) {
  const times = {
    event: "2026-08-25T08:00:00.000Z",
    caseCreated: "2026-08-25T08:00:10.000Z",
    verifying: "2026-08-25T08:01:00.000Z",
    diagnosed: "2026-08-25T08:02:00.000Z",
    recommended: "2026-08-25T08:03:00.000Z",
    policy: "2026-08-25T08:04:00.000Z",
    executed: "2026-08-25T08:05:00.000Z",
    linkExpires: "2026-08-25T20:00:00.000Z",
    paid: "2026-08-25T08:10:00.000Z",
    recovered: "2026-08-25T08:11:00.000Z",
  } as const;
  const failureEventId = `evt_demo_failure_${values.suffix}`;
  const failureProviderEventId = `delivery_demo_failure_${values.suffix}`;
  const paidEventId = `evt_demo_link_paid_${values.suffix}`;
  const paidProviderEventId = `delivery_demo_link_paid_${values.suffix}`;
  const syntheticCustomerHash = values.customerHashCharacter.repeat(64);
  const failureEvent = normalizedPaymentEventSchema.parse({
    eventId: failureEventId,
    eventName: "payment.failed",
    occurredAt: times.event,
    receivedAt: times.event,
    paymentId: values.paymentId,
    orderId: values.orderId,
    paymentSnapshot: {
      paymentId: values.paymentId,
      orderId: values.orderId,
      money: { amountSubunits: values.amountSubunits, currency: "INR" },
      status: "FAILED",
      method: "upi",
      bankOrProvider: "synthetic_psp",
      failure: {
        errorCode: "BAD_REQUEST_ERROR",
        errorSource: "customer",
        errorStep: "payment_authentication",
        errorReason: values.errorReason,
      },
      paymentCreatedAt: times.event,
    },
    signatureVerification: { status: "NOT_CHECKED" },
    duplicateProcessing: { status: "NOT_CHECKED" },
  });
  const initialCase = recoveryCaseRecordSchema.parse({
    caseId: values.caseId,
    paymentId: values.paymentId,
    orderId: values.orderId,
    syntheticCustomerHash,
    verifiedUnpaidAmountSubunits: values.amountSubunits,
    currency: "INR",
    state: "DETECTED",
    attemptNumber: 1,
    previousSuccessCount: 0,
    previousFailureCount: 1,
    contactCount: 0,
    recoveryWindowStartsAt: times.event,
    recoveryWindowEndsAt: "2026-08-26T08:00:00.000Z",
    version: 1,
    createdAt: times.caseCreated,
    updatedAt: times.caseCreated,
  });

  return demoScenarioSchema.parse({
    version: DEMO_SCENARIO_VERSION,
    caseId: values.caseId,
    paymentId: values.paymentId,
    orderId: values.orderId,
    failureEventId,
    failureProviderEventId,
    paidEventId,
    paidProviderEventId,
    recommendationId: `recommendation_demo_${values.suffix}`,
    decisionId: `decision_demo_${values.suffix}`,
    syntheticCustomerHash,
    amountSubunits: values.amountSubunits,
    currency: "INR",
    seed: `RECOVERAI_DEMO_${values.suffix.toUpperCase()}`,
    times,
    failureEvent,
    initialCase,
    scoringConfig,
  });
}

export const PRIMARY_DEMO_SCENARIO = Object.freeze(
  scenario({
    caseId: "case_demo_primary_v1",
    paymentId: "pay_demo_primary_v1",
    orderId: "order_demo_primary_v1",
    suffix: "primary_v1",
    customerHashCharacter: "a",
    amountSubunits: 149_900,
    errorReason: "incorrect_otp",
  }),
);

export const UNSAFE_DEMO_SCENARIO = Object.freeze(
  scenario({
    caseId: "case_demo_unsafe_v1",
    paymentId: "pay_demo_unsafe_v1",
    orderId: "order_demo_unsafe_v1",
    suffix: "unsafe_v1",
    customerHashCharacter: "b",
    amountSubunits: 50_000,
    errorReason: "incorrect_card_details",
  }),
);

export const UNSAFE_PROPOSED_AMOUNT_SUBUNITS =
  UNSAFE_DEMO_SCENARIO.amountSubunits * 10;

export type DemoScenario = z.infer<typeof demoScenarioSchema>;
