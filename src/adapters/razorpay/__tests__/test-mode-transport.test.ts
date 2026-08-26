import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  NativeRazorpayTestModeTransport,
  RAZORPAY_TEST_MODE_HTTP_BOUNDARY,
} from "@/adapters/razorpay/test-mode-transport";

afterEach(() => vi.unstubAllGlobals());

describe("fixed Razorpay Test Mode HTTPS transport", () => {
  it("uses the fixed HTTPS origin, allowlisted path and server-side Basic auth", async () => {
    const fetchMock = vi.fn((url: string, init: RequestInit) => {
      void url;
      void init;
      return Promise.resolve(Response.json({ id: "pay_test001" }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const transport = new NativeRazorpayTestModeTransport({
      keyId: "rzp_test_fixture123",
      keySecret: "fixture_secret_never_exposed",
    });
    const result = await transport.fetchPayment("pay_test001", {
      signal: new AbortController().signal,
      timeoutMilliseconds: 100,
    });
    expect(result).toEqual({ status: "OK", body: { id: "pay_test001" } });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.razorpay.com/v1/payments/pay_test001");
    expect(RAZORPAY_TEST_MODE_HTTP_BOUNDARY.origin).toBe(
      "https://api.razorpay.com",
    );
    const serialized = JSON.stringify(init);
    expect(serialized).toContain("Basic ");
    expect(serialized).not.toContain("fixture_secret_never_exposed");
  });

  it("maps authentication and timeout failures without raw response leakage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("provider secret body", { status: 401 })),
    );
    const transport = new NativeRazorpayTestModeTransport({
      keyId: "rzp_test_fixture123",
      keySecret: "fixture_secret_never_exposed",
    });
    const auth = await transport.fetchPayment("pay_test001", {
      signal: new AbortController().signal,
      timeoutMilliseconds: 100,
    });
    expect(auth).toEqual({
      status: "FAILED",
      code: "AUTHENTICATION_REJECTED",
    });
    expect(JSON.stringify(auth)).not.toMatch(/secret|provider body/);

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (_url: string, init: RequestInit) =>
          await new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("aborted", "AbortError")),
              { once: true },
            );
          }),
      ),
    );
    await expect(
      transport.fetchPayment("pay_test001", {
        signal: new AbortController().signal,
        timeoutMilliseconds: 5,
      }),
    ).resolves.toEqual({ status: "FAILED", code: "TIMEOUT" });
  });

  it("rejects Live Mode credentials before network access", () => {
    expect(
      () =>
        new NativeRazorpayTestModeTransport({
          keyId: "rzp_live_fixture123",
          keySecret: "fixture_secret_never_exposed",
        }),
    ).toThrow(/Test Mode/);
  });
});
