import "server-only";

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * File storage for things too big for a database row: supplier receipts today,
 * full-size product photos next.
 *
 * WHY THIS IS ITS OWN MODULE
 * --------------------------
 * Every caller speaks in *keys* ("orgId/receipts/2026/11/ab12….webp") and never
 * in paths. Today the bytes land on the server's own disk. When this goes live
 * on a host with no permanent disk (Vercel, most containers), only this file
 * changes — swap the three functions for S3 / Cloudflare R2 calls and nothing
 * else in the codebase notices.
 *
 * WHY THE FOLDER IS NOT `public/`
 * -------------------------------
 * A supplier's invoice shows what a business pays for its stock. That is exactly
 * the number a competitor wants. Anything under `public/` is served to anyone who
 * can guess the URL, so these files live outside it and are only ever read back
 * through a route that checks the session and the tenant first.
 */

// The `turbopackIgnore` comments tell the bundler this folder is runtime data,
// not source — without them it tries to bundle the whole project "just in case".
const ROOT = path.resolve(
  /* turbopackIgnore: true */ process.env.STORAGE_DIR ||
    path.join(/* turbopackIgnore: true */ process.cwd(), "storage"),
);

/**
 * Keys are built by our own code, never from user input — but a storage layer
 * that trusts its callers is one refactor away from a path-traversal bug, so it
 * checks anyway.
 */
function resolveKey(key: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/.test(key) || key.includes("..")) {
    throw new Error(`Invalid storage key: ${key}`);
  }
  const full = path.resolve(/* turbopackIgnore: true */ ROOT, key);
  if (!full.startsWith(ROOT + path.sep)) {
    throw new Error(`Storage key escapes the storage root: ${key}`);
  }
  return full;
}

// ── Where files go ──────────────────────────────────────────────────────────
// Supabase Storage when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set
// (Vercel has no permanent disk), otherwise the local folder above (your PC,
// or a VPS with a real disk). Same keys either way, so moving later is a copy.

const SUPABASE_URL = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET?.trim() || "receipts";
const useSupabase = Boolean(SUPABASE_URL && SUPABASE_KEY);

function objectUrl(key: string): string {
  resolveKeyName(key);
  return `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

/** Same key rules as the disk store, without touching the disk. */
function resolveKeyName(key: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/.test(key) || key.includes("..")) {
    throw new Error(`Invalid storage key: ${key}`);
  }
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY!, ...extra };
}

function contentTypeFor(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase();
  return ext === "pdf"
    ? "application/pdf"
    : ext === "png"
      ? "image/png"
      : ext === "webp"
        ? "image/webp"
        : ext === "jpg" || ext === "jpeg"
          ? "image/jpeg"
          : "application/octet-stream";
}

export async function putObject(key: string, bytes: Uint8Array): Promise<void> {
  if (useSupabase) {
    const res = await fetch(objectUrl(key), {
      method: "POST",
      // Keys are content hashes, so the same key always means the same bytes.
      headers: authHeaders({ "Content-Type": contentTypeFor(key), "x-upsert": "true", "cache-control": "31536000" }),
      body: Buffer.from(bytes),
    });
    if (!res.ok) throw new Error(`Supabase Storage upload failed (${res.status}): ${await res.text().catch(() => "")}`);
    return;
  }
  return putLocal(key, bytes);
}

export async function getObject(key: string): Promise<Buffer | null> {
  if (useSupabase) {
    const res = await fetch(objectUrl(key), { headers: authHeaders(), cache: "no-store" });
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw new Error(`Supabase Storage download failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
  return getLocal(key);
}

export async function deleteObject(key: string): Promise<void> {
  if (useSupabase) {
    resolveKeyName(key);
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
      method: "DELETE",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ prefixes: [key] }),
    });
    if (!res.ok && res.status !== 404) throw new Error(`Supabase Storage delete failed (${res.status})`);
    return;
  }
  return deleteLocal(key);
}

// ── Local disk ──────────────────────────────────────────────────────────────

async function putLocal(key: string, bytes: Uint8Array): Promise<void> {
  const full = resolveKey(key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, bytes);
}

async function getLocal(key: string): Promise<Buffer | null> {
  try {
    return await readFile(resolveKey(key));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function deleteLocal(key: string): Promise<void> {
  await rm(resolveKey(key), { force: true });
}
