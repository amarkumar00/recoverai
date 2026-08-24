import { connection } from "next/server";

import { CasesWorkspace } from "@/components/cases/cases-workspace";
import { demoRuntime } from "@/orchestration/runtime";

export const metadata = { title: "Cases" };

export default async function CasesPage() {
  await connection();
  const model = await demoRuntime().readModel.dashboard();
  return <CasesWorkspace initialModel={model} />;
}
