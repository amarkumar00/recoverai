import {
  parseEmptyDemoBody,
  requireDemoMode,
  routeErrorResponse,
} from "@/orchestration/demo-route";
import { demoRuntime } from "@/orchestration/runtime";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    requireDemoMode();
    await parseEmptyDemoBody(request);
    const operation = await demoRuntime().orchestrator.completePrimary();
    const recoveryCase = await demoRuntime().readModel.caseById(
      "case_demo_primary_v1",
    );
    return Response.json({ operation, recoveryCase }, { status: 200 });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
