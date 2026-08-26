import { NextResponse } from "next/server";

import { resetDemoRequestSchema } from "@/dashboard/contracts";
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
  if (!resetDemoRequestSchema.safeParse(body).success) {
    return NextResponse.json(
      { status: "REJECTED", resultCode: "EXPLICIT_CONFIRMATION_REQUIRED" },
      { status: 400, headers: HEADERS },
    );
  }
  try {
    const dashboard = demoRuntime().scenarios.resetKnownDemoFixtures();
    return NextResponse.json(
      {
        status: "RESET",
        resultCode: "KNOWN_DEMO_FIXTURES_RESET",
        dashboard,
        auditHistoryPreserved: true,
      },
      { headers: HEADERS },
    );
  } catch {
    return NextResponse.json(
      { status: "FAILED_SAFE", resultCode: "RESET_ROLLED_BACK" },
      { status: 500, headers: HEADERS },
    );
  }
}
