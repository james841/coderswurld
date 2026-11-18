import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";

import { AuthError } from "./auth";
import { PermissionError } from "./permissions";
import { StockError } from "./stock";

/**
 * One place that turns a thrown error into a JSON response.
 *
 * The point is that route handlers can be written as a straight line of
 * `requireTenantApi()` → `requirePermission()` → validate → do the work, with
 * no error plumbing in between. A guard that throws cannot be accidentally
 * ignored, which is the failure mode of guards that return booleans.
 */

export interface ApiErrorBody {
  error: string;
  /** Field-level messages, keyed by field name — drives inline form errors. */
  fields?: Record<string, string>;
  /** Present on 403 so the UI can name the missing permission. */
  permission?: string;
}

/** A deliberate, user-facing failure: "not enough stock", "receipt already used". */
export class AppError extends Error {
  readonly status: number;
  readonly fields?: Record<string, string>;

  constructor(
    message: string,
    options?: { status?: number; fields?: Record<string, string> },
  ) {
    super(message);
    this.name = "AppError";
    this.status = options?.status ?? 400;
    this.fields = options?.fields;
  }
}

function flattenZod(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "_";
    // First message per field wins — showing three errors on one input is noise.
    if (!(key in fields)) fields[key] = issue.message;
  }
  return fields;
}

export function toErrorResponse(error: unknown): NextResponse<ApiErrorBody> {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }

  if (error instanceof PermissionError) {
    return NextResponse.json(
      {
        error: "You don't have access to do that. Ask a main admin to grant it.",
        permission: error.permission,
      },
      { status: 403 },
    );
  }

  if (error instanceof ZodError) {
    const fields = flattenZod(error);
    return NextResponse.json(
      { error: "Please check the highlighted fields.", fields },
      { status: 422 },
    );
  }

  if (error instanceof AppError) {
    return NextResponse.json(
      { error: error.message, ...(error.fields ? { fields: error.fields } : {}) },
      { status: error.status },
    );
  }

  // "Not enough stock to sell 4 — only 2 on hand." A real, user-facing failure
  // that happens at the till under queue pressure; it must reach the cashier as
  // its own sentence, never as the generic 500 below.
  if (error instanceof StockError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // P2002: unique constraint. The raw message names the database column,
    // which is meaningless to a shopkeeper — translate the ones we cause.
    if (error.code === "P2002") {
      const target = error.meta?.target;
      const columns = Array.isArray(target) ? target.map(String) : [String(target ?? "")];
      const joined = columns.join(",");
      if (joined.includes("barcode")) {
        return NextResponse.json(
          {
            error: "Another product already uses that barcode.",
            fields: { barcode: "Already in use" },
          },
          { status: 409 },
        );
      }
      if (joined.includes("sku")) {
        return NextResponse.json(
          { error: "Another product already uses that code.", fields: { sku: "Already in use" } },
          { status: 409 },
        );
      }
      if (joined.includes("email")) {
        return NextResponse.json(
          { error: "That email address is already registered.", fields: { email: "Already in use" } },
          { status: 409 },
        );
      }
      if (joined.includes("localId") || joined.includes("receiptNo")) {
        // A replayed offline sale. Not an error the cashier should ever see —
        // the sync engine treats 409 here as "already recorded, move on".
        return NextResponse.json(
          { error: "This sale has already been recorded." },
          { status: 409 },
        );
      }
      return NextResponse.json(
        { error: "That value is already in use." },
        { status: 409 },
      );
    }
    if (error.code === "P2025") {
      return NextResponse.json({ error: "That record no longer exists." }, { status: 404 });
    }
    if (error.code === "P2003") {
      return NextResponse.json(
        { error: "That record is still referenced elsewhere and can't be removed." },
        { status: 409 },
      );
    }
  }

  if (
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientRustPanicError
  ) {
    console.error("[db] connection failure:", error);
    return NextResponse.json(
      { error: "Can't reach the database right now. Please try again." },
      { status: 503 },
    );
  }

  // Anything left is a bug. Log the detail, return something safe.
  console.error("[api] unhandled error:", error);
  return NextResponse.json(
    { error: "Something went wrong on our side. Please try again." },
    { status: 500 },
  );
}

/**
 * Wrap a route handler body. Usage:
 *
 *   export async function POST(request: Request) {
 *     return handle(async () => {
 *       const session = await requireTenantApi();
 *       ...
 *       return NextResponse.json({ ok: true });
 *     });
 *   }
 *
 * Generic over the *response* type rather than the payload, so a handler with
 * several `return NextResponse.json(...)` branches of different shapes infers
 * the union instead of locking onto whichever branch appears first.
 */
export async function handle<R extends NextResponse<unknown>>(
  fn: () => Promise<R>,
): Promise<R | NextResponse<ApiErrorBody>> {
  try {
    return await fn();
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Parse a JSON body, turning malformed input into a clean 400. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AppError("Expected a JSON body.", { status: 400 });
  }
}
