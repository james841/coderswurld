import { NextResponse } from "next/server";

/**
 * The server's clock. The till compares it with the computer's clock and warns
 * the cashier when the computer's date or time is wrong (receipts printed
 * offline use the computer's clock).
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ now: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
}
