import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { prisma } from "@/lib/db";
import { requireTenant } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { PERMISSIONS } from "@/lib/constants";
import { canSeeCost } from "@/lib/productList";

import { PageHeader } from "@/components/ui/PageHeader";
import { NoAccess } from "@/components/ui/NoAccess";
import { ProductForm } from "../ProductForm";

/**
 * Add a product.
 *
 * A Server Component that loads the two short lists the form needs — categories
 * and suppliers — so the dropdowns are populated on first paint and the form can
 * be used the instant it appears. Everything the form needs that can be known
 * before the person types is fetched here, not in a client effect.
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Add product" };

export default async function AddProductPage() {
  const session = await requireTenant();
  const { org, user } = session;

  if (!hasPermission(user, PERMISSIONS.PRODUCTS_CREATE)) {
    return <NoAccess what="adding products" />;
  }
  // Shown only when the shop runs a supermarket and a pharmacy side by side.
  const departmentsOn = Boolean(
    (await prisma.orgSettings.findUnique({
      where: { organizationId: org.id },
      select: { departmentsEnabled: true },
    }))?.departmentsEnabled,
  );


  const [categories, suppliers] = await Promise.all([
    prisma.category.findMany({
      where: { organizationId: org.id, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    prisma.supplier.findMany({
      where: { organizationId: org.id, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <>
      <Link
        href="/products"
        className="mb-2 inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-ink-800"
      >
        <ArrowLeft className="size-4" />
        Products
      </Link>
      <PageHeader
        title="Add product"
        subtitle="Stock the shelves — you can add pictures and barcodes later."
      />
      <ProductForm
        mode="create"
        categories={categories}
        suppliers={suppliers}
        canCost={canSeeCost(user)}
        departments={departmentsOn ? { locked: user.department } : undefined}
      />
    </>
  );
}
