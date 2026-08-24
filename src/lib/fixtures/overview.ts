export type OverviewMetric = {
  label: string;
  value: string;
  detail: string;
  tone: "neutral" | "positive" | "warning" | "blocked";
};

export type RecoveryActivity = {
  caseId: string;
  event: string;
  evidence: string;
  outcome: string;
  tone: "positive" | "warning" | "blocked" | "neutral";
  time: string;
};

export const overviewFixture = {
  generatedAt: "Demo snapshot · seed RECOVERAI-M1",
  metrics: [
    {
      label: "Total payment cases",
      value: "100",
      detail: "Unique synthetic cases",
      tone: "neutral",
    },
    {
      label: "Revenue initially at risk",
      value: "₹8,42,500",
      detail: "Simulated value across the batch",
      tone: "warning",
    },
    {
      label: "Baseline simulated recovery",
      value: "₹2,48,500",
      detail: "29.5% simulated recovery rate",
      tone: "neutral",
    },
    {
      label: "RecoverAI simulated recovery",
      value: "₹3,67,750",
      detail: "43.6% simulated recovery rate",
      tone: "positive",
    },
    {
      label: "Incremental simulated recovery",
      value: "+₹1,19,250",
      detail: "+14.1 percentage points simulated",
      tone: "positive",
    },
    {
      label: "Duplicate events ignored",
      value: "18",
      detail: "No repeated simulated action",
      tone: "neutral",
    },
    {
      label: "Unsafe actions blocked",
      value: "7",
      detail: "Deterministic policy preview",
      tone: "blocked",
    },
    {
      label: "Human escalations",
      value: "5",
      detail: "Synthetic unresolved cases",
      tone: "warning",
    },
  ] satisfies OverviewMetric[],
  comparison: [
    {
      label: "Baseline simulated recovery",
      value: "₹2,48,500",
      percent: 29.5,
      tone: "baseline",
    },
    {
      label: "RecoverAI simulated recovery",
      value: "₹3,67,750",
      percent: 43.6,
      tone: "recoverai",
    },
  ],
  failureClasses: [
    { label: "Issuer or network downtime", count: 25, tone: "blue" },
    { label: "Insufficient funds", count: 20, tone: "amber" },
    { label: "Customer-correctable details", count: 15, tone: "violet" },
    { label: "Uncertain or unknown", count: 15, tone: "slate" },
    { label: "Late success", count: 10, tone: "green" },
    { label: "Hard decline", count: 10, tone: "red" },
    { label: "Ambiguous state", count: 5, tone: "orange" },
  ],
  activities: [
    {
      caseId: "RCV-0100",
      event: "Late success detected",
      evidence: "Current payment state: captured",
      outcome: "Recovery stopped safely",
      tone: "positive",
      time: "12:42",
    },
    {
      caseId: "RCV-0099",
      event: "Amount mismatch proposed",
      evidence: "Suggested amount exceeded original",
      outcome: "Unsafe action blocked",
      tone: "blocked",
      time: "12:39",
    },
    {
      caseId: "RCV-0098",
      event: "Duplicate event received",
      evidence: "Previously seen event identifier",
      outcome: "Ignored idempotently",
      tone: "neutral",
      time: "12:34",
    },
    {
      caseId: "RCV-0097",
      event: "Failure remains ambiguous",
      evidence: "No reliable known-error match",
      outcome: "Escalated to human review",
      tone: "warning",
      time: "12:28",
    },
  ] satisfies RecoveryActivity[],
} as const;
