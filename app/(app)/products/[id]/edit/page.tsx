import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { prisma } from "@/lib/db";
import { requireTenant } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { PERMISSIONS } from "@/lib/constants";
import { canSeeCost } from "@/lib/productList";

import { PageHeader } from "@/components/ui/PageHeader";
import { NoAccess } from "@/components/ui/NoAccess";
import { ProductForm } from "../../ProductForm";

/**
 * Edit a product.
 *
 * The product is read here and handed to the form already fully populated, so
 * the fields are right on first paint rather than filling in after a fetch.
 *
 * Cost is loaded only when the viewer may see it. A user without
 * PRODUCTS_COST_VIEW gets a form with no cost field, and — because the form only
 * sends cost when it has it — a save from that form cannot blank the price the
 * main admin set. The value is simply never in their page.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireTenant();
  const product = await prisma.product.findFirst({
    where: { id, organizationId: session.org.id },
    select: { name: true },
  });
  return { title: product ? `Edit ${product.name}` : "Edit product" };
}

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireTenant();
  const { org, user } = session;

  if (!hasPermission(user, PERMISSIONS.PRODUCTS_EDIT)) {
    return <NoAccess what="editing products" />;
  }
  // Shown only when the shop runs a supermarket and a pharmacy side by side.
  const departmentsOn = Boolean(
    (await prisma.orgSettings.findUnique({
      where: { organizationId: org.id },
      select: { departmentsEnabled: true },
    }))?.departmentsEnabled,
  );

  const { id } = await params;
  const showCost = canSeeCost(user);

  const [product, categories, suppliers] = await Promise.all([
    prisma.product.findFirst({
      where: {
        id,
        organizationId: org.id,
        ...(user.department ? { department: user.department } : {}),
      },
      select: {
        id: true,
        name: true,
        sku: true,
        barcode: true,
        unit: true,
        packSize: true,
        description: true,
        costPriceKobo: true,
        sellingPriceKobo: true,
        wholesalePriceKobo: true,
        wholesaleMinQty: true,
        minStock: true,
        trackExpiry: true,
        expiryDate: true,
        imageThumb: true,
        categoryId: true,
        supplierId: true,
        department: true,
      },
    }),
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

  if (!product) notFound();

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
        title={product.name}
        subtitle="Changes take effect at the till the moment you save."
      />
      <ProductForm
        mode="edit"
        canCost={showCost}
        departments={departmentsOn ? { locked: user.department } : undefined}
        categories={categories}
        suppliers={suppliers}
        product={{
          id: product.id,
          department: product.department,
          name: product.name,
          sku: product.sku,
          barcode: product.barcode,
          unit: product.unit,
          packSize: product.packSize,
          description: product.description,
          costPriceKobo: showCost ? product.costPriceKobo : 0,
          sellingPriceKobo: product.sellingPriceKobo,
          wholesalePriceKobo: product.wholesalePriceKobo,
          wholesaleMinQty: product.wholesaleMinQty,
          minStock: product.minStock,
          trackExpiry: product.trackExpiry,
          expiryDate: product.expiryDate ? product.expiryDate.toISOString() : null,
          imageThumb: product.imageThumb,
          categoryId: product.categoryId,
          supplierId: product.supplierId,
        }}
      />
    </>
  );
}
