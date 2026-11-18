/**
 * Seed.
 *
 *   npx prisma db seed
 *
 * Idempotent by design — it upserts, never blindly inserts, so it is safe to run
 * against a database that already has data. Running a seed twice should not be a
 * thing you have to be careful about.
 *
 * It does two jobs:
 *
 *   1. Creates the platform (universal) admin. Nothing else in the system can
 *      create this account, so without it nobody can sign into /platform and no
 *      customer can ever be provisioned. This is the bootstrap.
 *
 *   2. With SEED_DEMO=1, provisions a demo shop with real products, stock and a
 *      few days of sales, so the dashboard and reports can be driven without
 *      typing a hundred rows in by hand.
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set — copy .env.example to .env first.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function main() {
  console.log("");

  // ── 1. Platform admin ──────────────────────────────────────────────────────
  const email = (process.env.PLATFORM_ADMIN_EMAIL || "admin@coderswurld.com")
    .trim()
    .toLowerCase();
  const name = process.env.PLATFORM_ADMIN_NAME || "Coderswurld Admin";
  const password = process.env.PLATFORM_ADMIN_PASSWORD;

  if (!password) {
    throw new Error(
      "PLATFORM_ADMIN_PASSWORD is not set in .env.\n" +
        "This is the password for your own universal dashboard at /platform — " +
        "pick a strong one, it grants access to every customer's data.",
    );
  }
  if (password.length < 10) {
    throw new Error("PLATFORM_ADMIN_PASSWORD must be at least 10 characters.");
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const admin = await prisma.platformAdmin.upsert({
    where: { email },
    // Re-running the seed rotates the password to whatever is in .env now. That
    // is the intended recovery path when you lock yourself out.
    update: { name, passwordHash, isActive: true },
    create: { email, name, passwordHash },
    select: { id: true, email: true },
  });

  console.log("  ✓ Platform admin ready");
  console.log(`    ${admin.email}  →  sign in at /platform/signin`);

  // ── 2. Optional demo tenant ────────────────────────────────────────────────
  if (process.env.SEED_DEMO === "1") {
    await seedDemo(admin.id);
  } else {
    console.log("");
    console.log("  Tip: SEED_DEMO=1 npx prisma db seed  → adds a demo shop with");
    console.log("       products, stock and sales to click around in.");
  }

  console.log("");
}

// ─────────────────────────────────────────────────────────────────────────────

async function seedDemo(platformAdminId: string) {
  const slug = "demo-mart";

  const existing = await prisma.organization.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (existing) {
    console.log("  • Demo shop already exists — skipping");
    return;
  }

  // Imported lazily so a production seed never even loads the provisioning code.
  const { provisionOrganization } = await import("../lib/provision");

  const result = await provisionOrganization({
    organizationName: "Demo Mart",
    businessType: "SUPERMARKET",
    email: "owner@demomart.ng",
    phone: "08030000000",
    city: "Ikeja",
    state: "Lagos",
    address: "12 Allen Avenue, Ikeja",
    plan: "BUSINESS",
    adminName: "Chinedu Okafor",
    adminEmail: "owner@demomart.ng",
    branchName: "Ikeja Main",
    recordedByAdminId: platformAdminId,
    paymentReference: "SEED-DEMO",
  });

  console.log("");
  console.log("  ✓ Demo shop provisioned");
  console.log(`    ${result.adminEmail}  /  ${result.tempPassword}`);
}

main()
  .catch((error) => {
    console.error("");
    console.error("  Seed failed:", error instanceof Error ? error.message : error);
    console.error("");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
