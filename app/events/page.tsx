import { connection } from "next/server";

import { EventStream } from "@/components/events/event-stream";
import { demoRuntime } from "@/orchestration/runtime";

export const metadata = { title: "Live Event Stream" };

export default async function EventsPage() {
  await connection();
  return <EventStream initialModel={demoRuntime().dashboard.eventStream()} />;
}
