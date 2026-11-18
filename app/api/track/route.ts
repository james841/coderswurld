import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { classifySource, isBot, parseUserAgent, resolveCountry } from "@/lib/traffic";

/**
 * POST /api/track: page views from the public site.
 *
 * Public and unauthenticated, so it is strict about size and rate, ignores
 * bots, and never throws back at the browser: tracking must never break the
 * page. Two kinds of beacon:
 *   - "view"  when a page opens
 *   - "leave" when it closes, with time spent and scroll depth
 */

const id = z.string().regex(/^[a-zA-Z0-9_-]{8,64}$/);
const short = (n: number) => z.string().trim().max(n).optional().nullable();

const ViewSchema = z.object({
  type: z.literal("view"),
  id,
  visitorId: id,
  sessionId: id,
  path: z.string().max(300).startsWith("/"),
  referrer: short(1000),
  utmSource: short(100),
  utmMedium: short(100),
  utmCampaign: short(150),
  timezone: short(64),
  isNewVisitor: z.boolean().optional(),
});

const LeaveSchema = z.object({
  type: z.literal("leave"),
  id,
  durationMs: z.number().int().min(0).max(6 * 60 * 60 * 1000),
  scrollDepth: z.number().int().min(0).max(100),
});

const Schema = z.discriminatedUnion("type", [ViewSchema, LeaveSchema]);

const OK = () => new NextResponse(null, { status: 204 });

export async function POST(request: Request) {
  try {
    const ua = request.headers.get("user-agent") ?? "";
    if (isBot(ua)) return OK();
    if (!rateLimit(`track:${clientIp(request)}`, { limit: 120, windowMs: 60_000 }).ok) return OK();

    const text = await request.text();
    if (text.length > 4000) return OK();
    const parsed = Schema.safeParse(JSON.parse(text));
    if (!parsed.success) return OK();
    const body = parsed.data;

    if (body.type === "leave") {
      // Only a recent view can be closed, so an old id can't be rewritten later.
      await prisma.pageView.updateMany({
        where: { id: body.id, createdAt: { gte: new Date(Date.now() - 6 * 60 * 60 * 1000) } },
        data: { durationMs: body.durationMs, scrollDepth: body.scrollDepth },
      });
      return OK();
    }

    let referrerHost: string | null = null;
    if (body.referrer) {
      try {
        const host = new URL(body.referrer).hostname.replace(/^www\./, "").toLowerCase();
        const own = new URL(request.url).hostname.replace(/^www\./, "").toLowerCase();
        // Moving between our own pages is not a new source.
        referrerHost = host && host !== own ? host : null;
      } catch {
        referrerHost = null;
      }
    }
    const { source, channel } = classifySource({
      referrerHost,
      utmSource: body.utmSource || null,
      utmMedium: body.utmMedium || null,
    });
    const { device, browser, os } = parseUserAgent(ua);

    await prisma.pageView.create({
      data: {
        id: body.id,
        visitorId: body.visitorId,
        sessionId: body.sessionId,
        path: body.path.split("?")[0],
        referrerHost,
        source,
        channel,
        utmSource: body.utmSource || null,
        utmMedium: body.utmMedium || null,
        utmCampaign: body.utmCampaign || null,
        country: resolveCountry(request.headers, body.timezone || null),
        timezone: body.timezone || null,
        device,
        browser,
        os,
        isNewVisitor: body.isNewVisitor ?? true,
      },
    });
    return OK();
  } catch {
    // Duplicate id, bad JSON, database blip: none of it is the visitor's problem.
    return OK();
  }
}
