import path from "node:path";
import { defineConfig } from "prisma/config";

/**
 * Prisma 7 configuration.
 *
 * In Prisma 7 the datasource URL is no longer allowed in schema.prisma, and the
 * CLI no longer loads `.env` on its own. Both of those are handled here:
 * `process.loadEnvFile` is Node's built-in dotenv reader (22.x), so this needs
 * no extra dependency.
 *
 * The runtime client does NOT read this file — it gets its connection through
 * the pg driver adapter in lib/db.ts. This config is only for the CLI:
 * `prisma migrate`, `prisma db push`, `prisma studio`, `prisma db seed`.
 */

try {
  process.loadEnvFile(path.join(process.cwd(), ".env"));
} catch {
  // No .env yet (fresh clone, or CI supplying real environment variables).
  // Falling through means DATABASE_URL just has to be set some other way.
}

const databaseUrl =
  process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim() || "";

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),

  // Migrations need a direct (session) connection; the app itself uses the
  // pooled DATABASE_URL. On Supabase: DIRECT_URL is the "Session pooler"
  // (port 5432) string, DATABASE_URL the "Transaction pooler" (port 6543) one.
  // Locally, leave DIRECT_URL unset and DATABASE_URL is used for both.
  //
  // `prisma generate` (run on every Vercel install) does not need a database,
  // so a missing URL must not stop the build. Commands that do need one
  // (migrate, db push, studio) will still say clearly that it is missing.
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {}),

  migrations: {
    path: path.join("prisma", "migrations"),
    seed: "tsx prisma/seed.ts",
  },
});
