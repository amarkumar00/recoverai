type PolicyCheckStatusValue = "PASSED" | "FAILED" | "NOT_APPLICABLE";

const STATUS_MARKS: Record<PolicyCheckStatusValue, string> = {
  PASSED: "✓",
  FAILED: "×",
  NOT_APPLICABLE: "—",
};

export function PolicyCheckStatus({
  status,
}: {
  status: PolicyCheckStatusValue;
}) {
  return (
    <span
      aria-label={`Status: ${status.replaceAll("_", " ")}`}
      className="policy-check-status"
      data-policy-status={status}
    >
      <span aria-hidden="true">{STATUS_MARKS[status]}</span>
      <span>{status}</span>
    </span>
  );
}
