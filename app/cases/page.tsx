import { connection } from "next/server";

import { CasesWorkspace } from "@/components/cases/cases-workspace";
import { ScenarioConsole } from "@/components/cases/scenario-console";
import { demoRuntime } from "@/orchestration/runtime";

export const metadata = { title: "Cases" };

export default async function CasesPage() {
  await connection();
  const model = await demoRuntime().readModel.dashboard();
  const scenarios = demoRuntime().scenarios.list();
  return (
    <>
      <CasesWorkspace initialModel={model} />
      <div className="page-wrap scenario-page-wrap">
        <ScenarioConsole initialModel={scenarios} />
      </div>
    </>
  );
}
