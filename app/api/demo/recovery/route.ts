import { demoRuntime } from "@/orchestration/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  const model = await demoRuntime().readModel.dashboard();
  return Response.json(model, {
    headers: { "Cache-Control": "no-store" },
  });
}
