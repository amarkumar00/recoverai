import { NextResponse } from "next/server";

import { runScenarioRequestSchema } from "@/dashboard/contracts";
import { env } from "@/lib/env";
import { demoRuntime } from "@/orchestration/runtime";

const HEADERS = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  if (env.APP_MODE !== "demo") {
    return NextResponse.json(
      { status: "REJECTED", resultCode: "DEMO_MODE_DISABLED" },
      { status: 403, headers: HEADERS },
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { status: "REJECTED", resultCode: "INVALID_REQUEST" },
      { status: 400, headers: HEADERS },
    );
  }
  const parsed = runScenarioRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { status: "REJECTED", resultCode: "INVALID_SCENARIO" },
      { status: 400, headers: HEADERS },
    );
  }
  try {
    if (parsed.data.scenarioKey === "INVALID_AI_AMOUNT") {
      await demoRuntime().orchestrator.runUnsafeAmountProbe();
    }
    const result = demoRuntime().scenarios.run(parsed.data.scenarioKey);
    return NextResponse.json(
      { status: "COMPLETED", result },
      { headers: HEADERS },
    );
  } catch {
    return NextResponse.json(
      { status: "FAILED_SAFE", resultCode: "SCENARIO_STOPPED_SAFE" },
      { status: 500, headers: HEADERS },
    );
  }
}
