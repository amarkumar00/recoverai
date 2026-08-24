import { describe, expect, it } from "vitest";

import { overviewFixture } from "@/lib/fixtures/overview";

describe("Milestone 1 overview fixture", () => {
  it("contains exactly 100 synthetic cases across failure classes", () => {
    const total = overviewFixture.failureClasses.reduce(
      (sum, failureClass) => sum + failureClass.count,
      0,
    );

    expect(total).toBe(100);
  });

  it("labels every financial metric as simulated", () => {
    const financialMetrics = overviewFixture.metrics.filter((metric) =>
      metric.value.includes("₹"),
    );

    expect(financialMetrics).not.toHaveLength(0);
    for (const metric of financialMetrics) {
      expect(`${metric.label} ${metric.detail}`.toLowerCase()).toContain(
        "simulated",
      );
    }
  });
});
