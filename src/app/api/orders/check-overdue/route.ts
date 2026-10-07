import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { checkOverdueOrderAlerts } from "@/lib/email/notifications/overdue-order";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorizedCron(request: NextRequest): boolean {
  const header = request.headers.get("authorization") ?? "";
  const secrets = [process.env.CRON_SECRET, process.env.OVERDUE_CHECK_SECRET, process.env.PRINT_AGENT_TOKEN]
    .map((value) => value?.trim())
    .filter(Boolean) as string[];
  if (secrets.some((secret) => header === `Bearer ${secret}`)) return true;
  const agent = request.headers.get("user-agent") ?? "";
  return agent.toLowerCase().includes("vercel-cron");
}

async function run(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    const auth = await requireAdminOnly(request);
    if (auth instanceof Response) return auth;
  }
  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
  const result = await checkOverdueOrderAlerts({ dryRun });
  return Response.json({ ok: true, ...result });
}

export async function GET(request: NextRequest) {
  return run(request);
}

export async function POST(request: NextRequest) {
  return run(request);
}
