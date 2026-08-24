import { describe, expect, it } from "vitest";

import {
  DemoRouteError,
  parseEmptyDemoBody,
  requireDemoMode,
  routeErrorResponse,
} from "@/orchestration/demo-route";

function request(body: string, contentType = "application/json") {
  return new Request("http://localhost/api/demo/recovery/start", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body,
  });
}

describe("internal synthetic demo route boundary", () => {
  it("accepts only a strict empty JSON object", async () => {
    await expect(parseEmptyDemoBody(request("{}"))).resolves.toEqual({});
  });

  it.each([
    ['{"amountSubunits":999999}', "UNEXPECTED_DEMO_INPUT"],
    ["[]", "UNEXPECTED_DEMO_INPUT"],
    ["not-json", "INVALID_JSON_BODY"],
  ])("rejects unsafe or malformed body %s", async (body, resultCode) => {
    await expect(parseEmptyDemoBody(request(body))).rejects.toMatchObject({
      resultCode,
    });
  });

  it("rejects non-JSON mutations", async () => {
    await expect(
      parseEmptyDemoBody(request("{}", "text/plain")),
    ).rejects.toMatchObject({ status: 415, resultCode: "JSON_BODY_REQUIRED" });
  });

  it("rejects mutations when demo mode is disabled", () => {
    expect(() => requireDemoMode("disabled")).toThrowError(
      expect.objectContaining({
        status: 403,
        resultCode: "DEMO_MODE_REQUIRED",
      }),
    );
  });

  it("returns sanitized safe errors without internal details", async () => {
    const response = routeErrorResponse(
      new DemoRouteError(400, "UNEXPECTED_DEMO_INPUT", "Fixed fixture only."),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      status: "ERROR_SAFE",
      resultCode: "UNEXPECTED_DEMO_INPUT",
      explanation: "Fixed fixture only.",
    });

    const internal = routeErrorResponse(new Error("database secret detail"));
    expect(JSON.stringify(await internal.json())).not.toContain(
      "database secret detail",
    );
  });
});
