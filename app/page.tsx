import { OverviewPage } from "@/components/overview/overview-page";
import { loadValidatedGoldenReport } from "@/dashboard/golden-report";

export default function HomePage() {
  return <OverviewPage report={loadValidatedGoldenReport()} />;
}
