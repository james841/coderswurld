import { NextResponse } from "next/server";

import { handle } from "@/lib/api";
import { endPlatformSession } from "@/lib/auth";

export async function POST() {
  return handle(async () => {
    await endPlatformSession();
    return NextResponse.json({ ok: true });
  });
}
