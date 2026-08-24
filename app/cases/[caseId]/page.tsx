import { notFound } from "next/navigation";
import { connection } from "next/server";

import { CaseDetail } from "@/components/cases/case-detail";
import { demoRuntime } from "@/orchestration/runtime";

type PageProps = { params: Promise<{ caseId: string }> };

export async function generateMetadata({ params }: PageProps) {
  const { caseId } = await params;
  return { title: caseId.startsWith("case_demo_") ? "Demo case" : "Cases" };
}

export default async function CaseDetailPage({ params }: PageProps) {
  await connection();
  const { caseId } = await params;
  const model = await demoRuntime().readModel.caseById(caseId);
  if (model === null) notFound();
  return <CaseDetail initialModel={model} />;
}
