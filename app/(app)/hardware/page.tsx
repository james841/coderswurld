import { requireTenant } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { hasPermission } from "@/lib/permissions";
import { parseReceiptDesign, toReceiptWidth } from "@/lib/receiptDesign";
import { NoAccess } from "@/components/ui/NoAccess";
import { PageHeader } from "@/components/ui/PageHeader";

import { HardwareClient } from "./HardwareClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Printer and scanner" };

export default async function HardwarePage() {
  const { org, user, branch } = await requireTenant();
  if (!hasPermission(user, PERMISSIONS.POS_SELL) && !hasPermission(user, PERMISSIONS.SETTINGS_VIEW)) {
    return <NoAccess what="printer and scanner setup" />;
  }

  const [organization, settings, mainBranch] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: org.id },
      select: { name: true, phone: true, address: true, city: true, logoUrl: true },
    }),
    prisma.orgSettings.findUnique({
      where: { organizationId: org.id },
      select: {
        receiptWidth: true,
        receiptHeader: true,
        receiptFooter: true,
        receiptShowLogo: true,
        receiptShowCashier: true,
        receiptDesign: true,
      },
    }),
    branch ? Promise.resolve(branch) : prisma.branch.findFirst({ where: { organizationId: org.id, isMain: true }, select: { name: true } }),
  ]);

  return (
    <>
      <PageHeader
        title="Printer and scanner"
        subtitle="Connect a receipt printer and a barcode scanner, then test both here before the first customer."
      />
      <HardwareClient
        org={{
          name: organization?.name ?? org.name,
          phone: organization?.phone ?? null,
          address: [organization?.address, organization?.city].filter(Boolean).join(", ") || null,
          logoUrl: organization?.logoUrl ?? null,
        }}
        branchName={mainBranch?.name ?? "Main branch"}
        cashierName={user.name}
        settings={{
          receiptWidth: toReceiptWidth(settings?.receiptWidth),
          receiptHeader: settings?.receiptHeader ?? null,
          receiptFooter: settings?.receiptFooter ?? "Thank you for your patronage!",
          receiptShowLogo: settings?.receiptShowLogo ?? false,
          receiptShowCashier: settings?.receiptShowCashier ?? true,
        }}
        design={parseReceiptDesign(settings?.receiptDesign)}
        stamp={new Intl.DateTimeFormat("en-NG", { timeZone: org.timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date())}
        canLookUpProducts={hasPermission(user, PERMISSIONS.PRODUCTS_VIEW)}
      />
    </>
  );
}
