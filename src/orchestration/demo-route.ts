import { emptyDemoMutationBodySchema } from "@/orchestration/contracts";

export class DemoRouteError extends Error {
  constructor(
    readonly status: number,
    readonly resultCode: string,
    message: string,
  ) {
    super(message);
    this.name = "DemoRouteError";
  }
}

export function requireDemoMode(mode = process.env.APP_MODE ?? "demo") {
  if (mode !== "demo") {
    throw new DemoRouteError(
      403,
      "DEMO_MODE_REQUIRED",
      "Synthetic demo mutations are disabled outside demo mode.",
    );
  }
}

export async function parseEmptyDemoBody(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new DemoRouteError(
      415,
      "JSON_BODY_REQUIRED",
      "A strict empty JSON object is required.",
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new DemoRouteError(
      400,
      "INVALID_JSON_BODY",
      "A strict empty JSON object is required.",
    );
  }
  const parsed = emptyDemoMutationBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new DemoRouteError(
      400,
      "UNEXPECTED_DEMO_INPUT",
      "The fixed synthetic scenario does not accept user-supplied values.",
    );
  }
  return parsed.data;
}

export function routeErrorResponse(error: unknown) {
  if (error instanceof DemoRouteError) {
    return Response.json(
      {
        status: "ERROR_SAFE",
        resultCode: error.resultCode,
        explanation: error.message,
      },
      { status: error.status },
    );
  }
  return Response.json(
    {
      status: "ERROR_SAFE",
      resultCode: "DEMO_OPERATION_FAILED_SAFE",
      explanation:
        "The synthetic demo operation failed safely without another financial action.",
    },
    { status: 500 },
  );
}
