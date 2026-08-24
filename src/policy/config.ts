import { z } from "zod";

import { PROBABILITY_SCALE_MILLIONTHS } from "@/ai/contracts";

export const DEFAULT_MAX_PAYMENT_LINKS_PER_ORDER = 1;
export const DEFAULT_MAX_CUSTOMER_CONTACTS = 2;
export const DEFAULT_MAX_RECOVERY_WINDOW_MILLISECONDS = 24 * 60 * 60 * 1_000;
export const DEFAULT_MIN_AI_CONFIDENCE_MILLIONTHS = 700_000;

export const policyConfigSchema = z
  .object({
    maxPaymentLinksPerOrder: z.number().int().nonnegative().safe(),
    maxCustomerContacts: z.number().int().nonnegative().safe(),
    maxRecoveryWindowMilliseconds: z.number().int().positive().safe(),
    minAiConfidenceMillionths: z
      .number()
      .int()
      .min(0)
      .max(PROBABILITY_SCALE_MILLIONTHS),
  })
  .strict();

export const DEFAULT_POLICY_CONFIG = Object.freeze(
  policyConfigSchema.parse({
    maxPaymentLinksPerOrder: DEFAULT_MAX_PAYMENT_LINKS_PER_ORDER,
    maxCustomerContacts: DEFAULT_MAX_CUSTOMER_CONTACTS,
    maxRecoveryWindowMilliseconds: DEFAULT_MAX_RECOVERY_WINDOW_MILLISECONDS,
    minAiConfidenceMillionths: DEFAULT_MIN_AI_CONFIDENCE_MILLIONTHS,
  }),
);

export type PolicyConfig = z.infer<typeof policyConfigSchema>;
