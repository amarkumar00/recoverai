import { describe, expect, it } from "vitest";

import { parseRuntimeEnvironment } from "@/lib/env";

describe("RecoverAI runtime selection", () => {
  it("defaults to credential-free Demo Mode", () => {
    expect(parseRuntimeEnvironment({})).toMatchObject({
      APP_MODE: "demo",
      RECOVERAI_ALLOW_TEST_MODE_WRITES: false,
    });
  });

  it("accepts explicit complete Test Mode configuration", () => {
    expect(
      parseRuntimeEnvironment({
        APP_MODE: "razorpay_test",
        RAZORPAY_TEST_KEY_ID: "rzp_test_fixture123",
        RAZORPAY_TEST_KEY_SECRET: "fixture_secret_only",
        RECOVERAI_ALLOW_TEST_MODE_WRITES: "true",
      }),
    ).toMatchObject({ APP_MODE: "razorpay_test" });
  });

  it("rejects partial credentials", () => {
    expect(() =>
      parseRuntimeEnvironment({ RAZORPAY_TEST_KEY_ID: "rzp_test_fixture123" }),
    ).toThrow();
  });

  it("rejects Live Mode and public secret variables", () => {
    expect(() =>
      parseRuntimeEnvironment({
        APP_MODE: "razorpay_test",
        RAZORPAY_TEST_KEY_ID: "rzp_live_fixture123",
        RAZORPAY_TEST_KEY_SECRET: "fixture_secret_only",
      }),
    ).toThrow(/Live Mode/);
    expect(() =>
      parseRuntimeEnvironment({
        NEXT_PUBLIC_RAZORPAY_TEST_KEY_SECRET: "never_public",
      }),
    ).toThrow(/NEXT_PUBLIC/);
  });
});
