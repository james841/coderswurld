import { requireTenant } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canDesignReceipt, parseReceiptDesign, toReceiptWidth } from "@/lib/receiptDesign";
import { NoAccess } from "@/components/ui/NoAccess";
import { PageHeader } from "@/components/ui/PageHeader";

import { ReceiptDesigner } from "./ReceiptDesigner";

export const dynamic = "force-dynamic";
export const metadata = { title: "Receipt design" };

export default async function ReceiptDesignPage() {
  const { org, user, branch } = await requireTenant();
  if (!canDesignReceipt(user)) return <NoAccess what="the receipt design" />;

  const [organization, settings, firstBranch] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: org.id },
      select: { name: true, phone: true, whatsapp: true, address: true, city: true, logoUrl: true },
    }),
    prisma.orgSettings.findUnique({
      where: { organizationId: org.id },
      select: {
        receiptWidth: true,
        receiptHeader: true,
        receiptFooter: true,
        receiptShowCashier: true,
        receiptShowLogo: true,
        receiptAutoPrint: true,
        receiptDesign: true,
        vatEnabled: true,
      },
    }),
    branch ? Promise.resolve(branch) : prisma.branch.findFirst({ where: { organizationId: org.id, isMain: true }, select: { name: true } }),
  ]);

  return (
    <>
      <PageHeader
        title="Receipt design"
        subtitle="Choose how your receipt looks. The preview shows exactly what prints, and every till uses it from the next sale."
      />
      <ReceiptDesigner
        org={{
          name: organization?.name ?? org.name,
          phone: organization?.phone ?? null,
          whatsapp: organization?.whatsapp ?? null,
          address: [organization?.address, organization?.city].filter(Boolean).join(", ") || null,
          logoUrl: organization?.logoUrl ?? null,
          timezone: org.timezone,
        }}
        branchName={firstBranch?.name ?? "Main branch"}
        cashierName={user.name}
        initial={{
          receiptWidth: toReceiptWidth(settings?.receiptWidth),
          receiptHeader: settings?.receiptHeader ?? null,
          receiptFooter: settings?.receiptFooter ?? "Thank you for your patronage!",
          receiptShowCashier: settings?.receiptShowCashier ?? true,
          receiptShowLogo: settings?.receiptShowLogo ?? false,
          receiptAutoPrint: settings?.receiptAutoPrint ?? false,
          design: parseReceiptDesign(settings?.receiptDesign),
        }}
        vatEnabled={settings?.vatEnabled ?? false}
        stamp={new Intl.DateTimeFormat("en-NG", { timeZone: org.timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date())}
      />
    </>
  );
}
