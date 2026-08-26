import { connection } from "next/server";

import { AuditTrailPage } from "@/components/audit/audit-trail-page";
import { demoRuntime } from "@/orchestration/runtime";

export const metadata = { title: "Tamper-Evident Audit Trail" };

export default async function AuditPage() {
  await connection();
  return <AuditTrailPage model={demoRuntime().dashboard.audit()} />;
}
