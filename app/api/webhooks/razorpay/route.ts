import { env } from "@/lib/env";
import { applicationRuntime } from "@/orchestration/runtime";
import { handleRazorpayWebhookRequest } from "@/webhooks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleRazorpayWebhookRequest(request, {
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
    getIngestor: () => applicationRuntime().webhookIngestor,
  });
}
