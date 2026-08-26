import { EvaluationPageView } from "@/components/evaluation/evaluation-page";
import { loadValidatedGoldenReport } from "@/dashboard/golden-report";

export const metadata = { title: "Digital Twin Evaluation" };

export default function EvaluationPage() {
  return <EvaluationPageView report={loadValidatedGoldenReport()} />;
}
