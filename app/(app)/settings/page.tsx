import { requireTenant } from "@/lib/auth";
import { PERMISSIONS, getPlan } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { isEmailConfigured } from "@/lib/mail";
import { hasPermission } from "@/lib/permissions";
import { getSeatSummary } from "@/lib/staff";
import { isWhatsAppConfigured } from "@/lib/whatsapp";

import { NoAccess } from "@/components/ui/NoAccess";
import { PageHeader } from "@/components/ui/PageHeader";
import { SettingsClient, type SettingsValues } from "./SettingsClient";

/**
 * Settings — the business's own details and how the product behaves for it.
 *
 * Everything on this page was already in the database and already obeyed by the
 * till, the receipt and the nightly report; until now only Coderswurld could
 * change it. This page hands those switches to the owner.
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const session = await requireTenant();
  const { org, user } = session;

  if (!hasPermission(user, PERMISSIONS.SETTINGS_VIEW)) {
    return <NoAccess what="settings" />;
  }

  const [business, settings, branches, seats] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      where: { id: org.id },
      select: {
        name: true,
        businessType: true,
        email: true,
        phone: true,
        whatsapp: true,
        address: true,
        city: true,
        state: true,
      },
    }),
    prisma.orgSettings.findUnique({ where: { organizationId: org.id } }),
    prisma.branch.findMany({
      where: { organizationId: org.id },
      orderBy: [{ isMain: "desc" }, { isActive: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        code: true,
        address: true,
        phone: true,
        isMain: true,
        isActive: true,
        _count: { select: { users: { where: { isActive: true } } } },
      },
    }),
    getSeatSummary(prisma, org.id, org.plan),
  ]);

  // The same defaults the database would apply, for a business whose settings
  // row is missing. Saving any section creates the row.
  const values: SettingsValues = {
    ...business,
    departmentsEnabled: settings?.departmentsEnabled ?? false,
    receiptWidth: settings?.receiptWidth === "58mm" ? "58mm" : "80mm",
    receiptHeader: settings?.receiptHeader ?? null,
    receiptFooter: settings?.receiptFooter ?? "Thank you for your patronage!",
    receiptShowCashier: settings?.receiptShowCashier ?? true,
    receiptAutoPrint: settings?.receiptAutoPrint ?? false,
    allowNegativeStock: settings?.allowNegativeStock ?? false,
    autoWholesale: settings?.autoWholesale ?? true,
    defaultPriceMode: settings?.defaultPriceMode === "WHOLESALE" ? "WHOLESALE" : "RETAIL",
    requireCustomerForCredit: settings?.requireCustomerForCredit ?? true,
    expiryWarningDays: settings?.expiryWarningDays ?? 90,
    dailyReportEnabled: settings?.dailyReportEnabled ?? true,
    reportChannel: (["NONE", "EMAIL", "WHATSAPP", "BOTH"] as const).includes(
      settings?.reportChannel as "NONE",
    )
      ? (settings!.reportChannel as SettingsValues["reportChannel"])
      : "EMAIL",
    reportEmail: settings?.reportEmail ?? null,
    reportWhatsapp: settings?.reportWhatsapp ?? null,
    reportTime: settings?.reportTime ?? "21:00",
    reportToAllAdmins: settings?.reportToAllAdmins ?? false,
    vatEnabled: settings?.vatEnabled ?? false,
    vatPercent: (settings?.vatBasisPoints ?? 750) / 100,
    vatInclusive: settings?.vatInclusive ?? true,
  };

  return (
    <>
      <PageHeader title="Settings" subtitle="Your business details and how the system works for you" />
      <SettingsClient
        initial={values}
        initialBranches={branches.map(({ _count, ...b }) => ({ ...b, staffCount: _count.users }))}
        branchSeats={seats.branches}
        seats={seats}
        canManage={hasPermission(user, PERMISSIONS.SETTINGS_MANAGE)}
        plan={{
          name: getPlan(org.plan).name,
          expiresOn: session.expiresAt ? formatDate(session.expiresAt, org.timezone) : null,
        }}
        delivery={{ email: isEmailConfigured(), whatsapp: isWhatsAppConfigured() }}
      />
    </>
  );
}
