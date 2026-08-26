import {
  goldenEvaluationReportSchema,
  type GoldenEvaluationReport,
} from "@/evaluation/contracts";
import type { SimulatedEvaluationResult } from "@/domain/evaluation";

export function createGoldenEvaluationReport(
  result: SimulatedEvaluationResult,
): GoldenEvaluationReport {
  return goldenEvaluationReportSchema.parse({
    title: "RecoverAI Held-Out Digital Twin Evaluation",
    simulationLabel: "SIMULATED",
    result,
    baselineDefinition:
      "At exactly 15 deterministic minutes, every eligible verified-unpaid failure selects the same generic SEND_PAYMENT_LINK action. An existing active link is reused; already-paid cases use STOP_NON_RETRYABLE only as a no-intervention representation, without claiming cancellation; unavailable or conflicting state escalates without a link or customer contact.",
    recoverAiDefinition:
      "Each unique scorer-visible synthetic case is re-diagnosed, ranked by the existing deterministic bounded mock scorer, gated by the existing policy firewall, and evaluated through the hidden simulated oracle only after its final action is fixed.",
    metricDefinitions: [
      "All money is SIMULATED integer subunits in one currency; incremental simulated recovery equals RecoverAI simulated recovery minus baseline simulated recovery and may be negative.",
      "RecoverAI simulated recovery rate is recovered unique cases divided by 100 unique payment cases; revenue and contacts are counted at most once per unique payment.",
      "Root-cause accuracy is exact predicted-versus-revealed class matches divided by 100; action-selection accuracy is revealed allowed selections divided by 100.",
      "Contacts avoided is max(0, baseline selected-outcome contacts minus RecoverAI selected-outcome contacts).",
      "Human escalation rate is final ESCALATE_HUMAN selections divided by 100; unresolved exceptions are selected outcomes marked SIMULATED_UNRESOLVED or SIMULATED_ESCALATED.",
      "Unsafe actions blocked counts actual policy blocks or safety redirects where the final action differs from the proposed action; duplicate-charge prevention counts actual ORIGINAL_PAYMENT_SATISFIED policy decisions.",
      "Payment Link creation counts only approved CREATE_NEW link intents; API fallback/failure counts actual scorer safe fallbacks or invalid policy inputs.",
      "Mean processing time is deterministic logical model time divided by all 125 deliveries; it is simulated and is not production latency.",
    ],
    knownLimitations: [
      "The held-out oracle and outcomes are handcrafted synthetic fixtures, not production observations or real recovered revenue.",
      "The deterministic mock scorer is not a trained model and the evaluation does not estimate production uplift, causality, or latency.",
      "No network, credentials, real Razorpay Test Mode calls, real customer messaging, or real financial action is used.",
      "The evaluator-only module boundary is enforced by code structure, lint rules, and tests; it is not a cryptographic secrecy boundary.",
    ],
  });
}
