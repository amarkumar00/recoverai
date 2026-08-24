import { ComingSoon } from "@/components/coming-soon";

export const metadata = { title: "Live Event Stream" };

export default function EventsPage() {
  return (
    <ComingSoon
      description="A future operational view for verified, deduplicated, and reconciled payment events."
      eyebrow="Operational visibility"
      milestone="Milestones 10–14"
      title="Live Event Stream"
    />
  );
}
