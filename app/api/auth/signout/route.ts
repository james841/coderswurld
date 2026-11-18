import { NextResponse } from "next/server";

import { handle } from "@/lib/api";
import { endTenantSession } from "@/lib/auth";

/**
 * POST /api/auth/signout
 *
 * POST, not GET: a GET sign-out can be triggered by any image tag or link
 * prefetch on the page, which logs people out at random.
 */
export async function POST() {
  return handle(async () => {
    await endTenantSession();
    return NextResponse.json({ ok: true });
  });
}
