import { cookies } from "next/headers";
import { parseReceiptDesign, toReceiptWidth } from "@/lib/receiptDesign";
import { redirect } from "next/navigation";
import Link from "next/link";

import { requireTenant } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hasPermission } from "@/lib/permissions";
import { PERMISSIONS } from "@/lib/constants";

import { OfflineReady } from "@/components/OfflineReady";
import Till, { type PosBootstrap } from "./Till";

/**
 * /pos — the till. A full-screen route that lives OUTSIDE the (app) route group
 * on purpose: no sidebar, no top bar, no back-office chrome. A cashier on a
 * tablet by the door should see the sell screen and nothing else.
 *
 * Because it is outside (app), it inherits none of that group's auth gate, so
 * it runs its own here: a real tenant session, a password that isn't pending a
 * forced change, and the one permission that means "may operate a till".
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Till",
};

export default async function PosPage() {
  const session = await requireTenant();

  if (session.user.mustChangePassword) {
    redirect("/change-password");
  }
  if (!hasPermission(session.user, PERMISSIONS.POS_SELL)) {
    // Someone with a back-office login but no till permission — send them home
    // rather than show an empty sell screen they can't use.
    redirect("/dashboard");
  }

  // A till sells from a branch's stock. No branch, nothing to sell — say so
  // plainly instead of booting into a till that would 400 on its first sync.
  if (!session.branch) {
    return <NoBranch orgName={session.org.name} />;
  }

  const [settings, categories, orgContact] = await Promise.all([
    prisma.orgSettings.findUnique({
      where: { organizationId: session.org.id },
      select: {
        autoWholesale: true,
        allowNegativeStock: true,
        defaultPriceMode: true,
        requireCustomerForCredit: true,
        vatEnabled: true,
        vatBasisPoints: true,
        vatInclusive: true,
        receiptWidth: true,
        receiptHeader: true,
        receiptFooter: true,
        receiptShowLogo: true,
        receiptShowCashier: true,
        receiptAutoPrint: true,
        receiptDesign: true,
      },
    }),
    prisma.category.findMany({
      where: { organizationId: session.org.id, isActive: true },
      select: { id: true, name: true, color: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.organization.findUnique({
      where: { id: session.org.id },
      select: { phone: true, address: true, city: true },
    }),
  ]);

  const bootstrap: PosBootstrap = {
    org: {
      id: session.org.id,
      name: session.org.name,
      currency: session.org.currency,
      timezone: session.org.timezone,
      catalogVersion: session.org.catalogVersion,
      logoUrl: session.org.logoUrl ?? null,
      phone: orgContact?.phone ?? null,
      address: [orgContact?.address, orgContact?.city].filter(Boolean).join(", ") || null,
    },
    branch: {
      id: session.branch.id,
      name: session.branch.name,
      code: session.branch.code,
    },
    cashier: {
      id: session.user.id,
      name: session.user.name,
      department: session.user.department,
    },
    permissions: {
      discount: hasPermission(session.user, PERMISSIONS.POS_DISCOUNT),
      creditSale: hasPermission(session.user, PERMISSIONS.POS_CREDIT_SALE),
      priceOverride: hasPermission(session.user, PERMISSIONS.POS_PRICE_OVERRIDE),
      reprint: hasPermission(session.user, PERMISSIONS.POS_REPRINT),
    },
    categories: categories.map((c) => ({ id: c.id, name: c.name, color: c.color })),
    settings: {
      autoWholesale: settings?.autoWholesale ?? true,
      allowNegativeStock: settings?.allowNegativeStock ?? false,
      defaultPriceMode: (settings?.defaultPriceMode === "WHOLESALE" ? "WHOLESALE" : "RETAIL"),
      requireCustomerForCredit: settings?.requireCustomerForCredit ?? true,
      vatEnabled: settings?.vatEnabled ?? false,
      vatBasisPoints: settings?.vatBasisPoints ?? 750,
      vatInclusive: settings?.vatInclusive ?? true,
      receiptWidth: toReceiptWidth(settings?.receiptWidth),
      receiptHeader: settings?.receiptHeader ?? null,
      receiptFooter: settings?.receiptFooter ?? "Thank you for your patronage!",
      receiptShowLogo: settings?.receiptShowLogo ?? false,
      receiptShowCashier: settings?.receiptShowCashier ?? true,
      receiptAutoPrint: settings?.receiptAutoPrint ?? false,
      receiptDesign: parseReceiptDesign(settings?.receiptDesign),
    },
  };

  return (
    <>
      {/*
        Keeps a copy of this page on the device so it opens with no internet.
        `warmTill` matters for cashiers: /pos is the first and only page they
        ever load, so nothing else would get the chance to save it for them.
      */}
      <OfflineReady warmTill />
      <Till
        bootstrap={bootstrap}
        // Same switch and same saved choice as the admin side.
        initialTheme={(await cookies()).get("cw-theme")?.value === "dark" ? "dark" : "light"}
      />
    </>
  );
}

/** Shown when the signed-in user has no branch — a dead end, said kindly. */
function NoBranch({ orgName }: { orgName: string }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-ink-950 px-6 text-center text-white">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-700 text-2xl font-bold">
        {orgName.charAt(0).toUpperCase()}
      </div>
      <div className="max-w-sm space-y-2">
        <h1 className="text-xl font-semibold">No till assigned</h1>
        <p className="text-sm text-white/70">
          Your account isn&rsquo;t attached to a shop branch yet, so there&rsquo;s no stock to
          sell from. Ask a main admin to assign you to a branch, then open the till again.
        </p>
      </div>
      <Link
        href="/dashboard"
        className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/15"
      >
        Back to dashboard
      </Link>
    </main>
  );
}
