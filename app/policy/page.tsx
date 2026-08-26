import { connection } from "next/server";

import { PolicyFirewallPage } from "@/components/policy/policy-firewall-page";
import { demoRuntime } from "@/orchestration/runtime";

export const metadata = { title: "Policy Firewall" };

export default async function PolicyPage() {
  await connection();
  return <PolicyFirewallPage model={demoRuntime().dashboard.policy()} />;
}
