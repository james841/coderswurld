import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Prisma client singleton.
 *
 * Two things here are Prisma 7 specific and not optional:
 *
 * 1. THE DRIVER ADAPTER. Prisma 7 removed `url` from the datasource block and
 *    talks to Postgres through a real node-postgres pool passed in as an
 *    adapter. `schema.prisma` therefore declares only the provider.
 *
 * 2. THE globalThis CACHE. Next.js Fast Refresh re-evaluates modules on every
 *    save. Without this, each edit constructs a fresh client *and a fresh pool*;
 *    Postgres runs out of connections within a few minutes of editing and every
 *    query starts failing with "Timed out fetching a new connection".
 *
 * Never call `new PrismaClient()` anywhere else in this codebase — import
 * `prisma` from here.
 */

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and point it at your " +
        "local Postgres (the database must exist: CREATE DATABASE coderswurld;).",
    );
  }

  // Hosted Postgres (Supabase, Neon, RDS...) needs TLS; a local one doesn't.
  // The sslmode in the URL is taken out and TLS is set here instead, because
  // node-postgres reads "sslmode=require" as "verify against the system's
  // certificate list", which Supabase's own certificate is not on. The link is
  // still encrypted; set DATABASE_SSL=verify with DATABASE_CA_CERT to also pin
  // the certificate, or DATABASE_SSL=off for a database on the same machine.
  const url = new URL(connectionString);
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname) || url.hostname.startsWith("/");
  const sslMode = process.env.DATABASE_SSL?.trim() || (local || url.searchParams.get("sslmode") === "disable" ? "off" : "on");
  url.searchParams.delete("sslmode");
  url.searchParams.delete("pgbouncer"); // a Prisma hint, not something Postgres understands

  // Serverless (Vercel) runs many small copies of the app at once, each with
  // its own pool. Keep each pool tiny so they add up to less than the
  // database's connection limit; the pooler (port 6543) shares them out.
  const serverless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

  const adapter = new PrismaPg({
    connectionString: url.toString(),
    max: Number(process.env.DATABASE_POOL_SIZE) || (serverless ? 3 : 10),
    // Drop idle connections rather than holding them across a quiet afternoon.
    idleTimeoutMillis: serverless ? 10_000 : 30_000,
    // Fail fast and surface a real error instead of a hung checkout screen.
    connectionTimeoutMillis: 10_000,
    ssl:
      sslMode === "off"
        ? undefined
        : sslMode === "verify"
          ? { rejectUnauthorized: true, ca: process.env.DATABASE_CA_CERT }
          : { rejectUnauthorized: false },
  });

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
