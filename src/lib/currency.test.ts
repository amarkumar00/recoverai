import { describe, expect, it } from "vitest";

import { formatInrFromPaise } from "@/lib/currency";

describe("formatInrFromPaise", () => {
  it("converts integer paise to correctly grouped INR", () => {
    expect(formatInrFromPaise(84_250_000)).toBe("₹8,42,500");
    expect(formatInrFromPaise(12_345)).toBe("₹123.45");
  });

  it("rejects fractional paise", () => {
    expect(() => formatInrFromPaise(10.5)).toThrow(
      "Money must be provided as integer paise.",
    );
  });
});
