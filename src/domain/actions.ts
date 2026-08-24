import { z } from "zod";

export const RECOVERY_ACTIONS = [
  "WAIT_FOR_RECOVERY",
  "SEND_PAYMENT_LINK",
  "REQUEST_METHOD_CHANGE",
  "CANCEL_RECOVERY_ALREADY_PAID",
  "STOP_NON_RETRYABLE",
  "ESCALATE_HUMAN",
] as const;

export const recoveryActionSchema = z.enum(RECOVERY_ACTIONS);

export type RecoveryAction = z.infer<typeof recoveryActionSchema>;
