import { z } from "zod";

export const RECOVERY_CASE_STATES = [
  "DETECTED",
  "VERIFYING",
  "DIAGNOSED",
  "AWAITING_POLICY",
  "WAITING",
  "LINK_CREATED",
  "RECOVERED",
  "STOPPED",
  "ESCALATED",
  "ERROR_SAFE",
] as const;

export const recoveryCaseStateSchema = z.enum(RECOVERY_CASE_STATES);

export type RecoveryCaseState = z.infer<typeof recoveryCaseStateSchema>;
