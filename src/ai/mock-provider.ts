import {
  aiProviderInputSchema,
  aiProviderOutputSchema,
  PROBABILITY_SCALE_MILLIONTHS,
  type AiProviderInput,
  type AiProviderOutput,
} from "@/ai/contracts";
import type { AiRecommendationProvider } from "@/ai/provider";
import { RECOVERY_ACTIONS, type RecoveryAction } from "@/domain/actions";
import type { FailureClass } from "@/domain/diagnosis";

export const DETERMINISTIC_MOCK_PROVIDER_DESCRIPTION =
  "Seeded demo/test double with transparent handcrafted estimates; not a trained production model.";

const BASE_PROBABILITY_MILLIONTHS: Record<
  FailureClass,
  Record<RecoveryAction, number>
> = {
  DOWNTIME_OR_TRANSIENT: {
    WAIT_FOR_RECOVERY: 780_000,
    SEND_PAYMENT_LINK: 350_000,
    REQUEST_METHOD_CHANGE: 320_000,
    CANCEL_RECOVERY_ALREADY_PAID: 0,
    STOP_NON_RETRYABLE: 0,
    ESCALATE_HUMAN: 80_000,
  },
  INSUFFICIENT_FUNDS: {
    WAIT_FOR_RECOVERY: 260_000,
    SEND_PAYMENT_LINK: 420_000,
    REQUEST_METHOD_CHANGE: 560_000,
    CANCEL_RECOVERY_ALREADY_PAID: 0,
    STOP_NON_RETRYABLE: 0,
    ESCALATE_HUMAN: 80_000,
  },
  CUSTOMER_CORRECTABLE: {
    WAIT_FOR_RECOVERY: 180_000,
    SEND_PAYMENT_LINK: 640_000,
    REQUEST_METHOD_CHANGE: 570_000,
    CANCEL_RECOVERY_ALREADY_PAID: 0,
    STOP_NON_RETRYABLE: 0,
    ESCALATE_HUMAN: 80_000,
  },
  NETWORK_OR_INTEGRATION_UNCERTAINTY: {
    WAIT_FOR_RECOVERY: 400_000,
    SEND_PAYMENT_LINK: 250_000,
    REQUEST_METHOD_CHANGE: 240_000,
    CANCEL_RECOVERY_ALREADY_PAID: 0,
    STOP_NON_RETRYABLE: 0,
    ESCALATE_HUMAN: 180_000,
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

const ACTION_REASONS: Record<RecoveryAction, string> = {
  WAIT_FOR_RECOVERY:
    "Waiting is a bounded response to credible temporary or uncertain conditions.",
  SEND_PAYMENT_LINK:
    "A bounded recovery link can offer a fresh customer-initiated payment attempt.",
  REQUEST_METHOD_CHANGE:
    "Another available payment method may improve the chance of customer completion.",
  CANCEL_RECOVERY_ALREADY_PAID:
    "Verified late success means recovery outreach should stop.",
  STOP_NON_RETRYABLE:
    "The deterministic diagnosis marks further automated recovery as unsuitable.",
  ESCALATE_HUMAN:
    "Human review is the conservative choice when automated context is limited.",
};

const ACTION_EVIDENCE: Record<RecoveryAction, string> = {
  WAIT_FOR_RECOVERY: "BOUNDED_WAIT_ESTIMATE",
  SEND_PAYMENT_LINK: "BOUNDED_LINK_ESTIMATE",
  REQUEST_METHOD_CHANGE: "METHOD_CHANGE_ESTIMATE",
  CANCEL_RECOVERY_ALREADY_PAID: "LATE_SUCCESS_ESTIMATE",
  STOP_NON_RETRYABLE: "STOP_RECOVERY_ESTIMATE",
  ESCALATE_HUMAN: "HUMAN_REVIEW_ESTIMATE",
};

const CUSTOMER_MESSAGES: Partial<Record<FailureClass, string>> = {
  DOWNTIME_OR_TRANSIENT:
    "Your payment could not be completed right now. Please try again after a short wait.",
  INSUFFICIENT_FUNDS:
    "Your payment could not be completed. You may try another available payment method.",
  CUSTOMER_CORRECTABLE:
    "Please review your payment details or use another available payment method.",
  NETWORK_OR_INTEGRATION_UNCERTAINTY:
    "Your payment could not be completed right now. Please try again later.",
};

function deterministicHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function seededVariation(
  input: AiProviderInput,
  action: RecoveryAction,
): number {
  if (input.candidateActions.length === 1) {
    return 0;
  }
  const normalized = [
    input.seed,
    input.caseId,
    input.failureClass,
    input.knowledgeStatus,
    input.candidateActions.join(","),
    String(input.previousContactCount),
    String(input.activeRecoveryLinkExists),
    input.paymentMethod,
    action,
  ].join("|");
  return (deterministicHash(normalized) % 20_001) - 10_000;
}

function clampProbability(value: number): number {
  return Math.min(PROBABILITY_SCALE_MILLIONTHS, Math.max(0, value));
}

export class DeterministicMockAiProvider implements AiRecommendationProvider {
  async estimate(
    rawInput: AiProviderInput,
    options: { signal: AbortSignal },
  ): Promise<unknown> {
    const input = aiProviderInputSchema.parse(rawInput);
    if (options.signal.aborted) {
      throw new DOMException("Recommendation request aborted.", "AbortError");
    }

    const output: AiProviderOutput = {
      estimates: input.candidateActions.map((action) => ({
        action,
        recoveryProbabilityMillionths: clampProbability(
          BASE_PROBABILITY_MILLIONTHS[input.failureClass][action] +
            seededVariation(input, action),
        ),
        reason: ACTION_REASONS[action],
        evidence: [
          {
            code: ACTION_EVIDENCE[action],
            detail:
              "A transparent seeded demo estimate was produced from the diagnosed class and bounded context.",
          },
        ],
      })),
      confidenceMillionths: input.knowledgeStatus === "KNOWN" ? 820_000 : 0,
      merchantExplanation:
        "Transparent demo estimates were produced only for deterministic diagnosis candidates.",
      contextStatus:
        input.knowledgeStatus === "KNOWN" ? "SUFFICIENT" : "INSUFFICIENT",
      escalationRecommended: input.knowledgeStatus !== "KNOWN",
    };
    const customerSafeMessage = CUSTOMER_MESSAGES[input.failureClass];
    if (customerSafeMessage !== undefined) {
      output.customerSafeMessage = customerSafeMessage;
    }

    return aiProviderOutputSchema.parse(output);
  }
}

export const DETERMINISTIC_MOCK_BASE_ESTIMATES = Object.freeze(
  Object.fromEntries(
    Object.entries(BASE_PROBABILITY_MILLIONTHS).map(
      ([failureClass, values]) => [
        failureClass,
        Object.freeze(
          Object.fromEntries(
            RECOVERY_ACTIONS.map((action) => [action, values[action]]),
          ),
        ),
      ],
    ),
  ),
);
