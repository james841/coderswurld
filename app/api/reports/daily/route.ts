import { NextResponse } from "next/server";

import { handle } from "@/lib/api";
import { requireTenantApi } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { PERMISSIONS } from "@/lib/constants";
import { sendDailyReport } from "@/lib/reports";

/**
 * POST /api/reports/daily — "Send now".
 *
 * The button on the Reports screen. It forces the send: the owner asked for the
 * figures this instant, so it ignores both the nightly on/off switch and the
 * once-a-day guard. Pulling the report twice — once, then again after fixing a
 * mis-rung sale — is a thing people genuinely want to do.
 *
 * It goes to whatever channel and address the shop has configured, not to the
 * person who clicked. The clicker is asking the shop to send its own report to
 * its own owner, so viewing reports is permission enough.
 */

export const dynamic = "force-dynamic";

export async function POST() {
  return handle(async () => {
    const session = await requireTenantApi();
    requirePermission(session.user, PERMISSIONS.REPORTS_VIEW);

    const result = await sendDailyReport(session.org.id, { force: true });
    return NextResponse.json(result);
  });
}
