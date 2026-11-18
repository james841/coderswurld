import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { requireTenant } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { PERMISSIONS } from "@/lib/constants";

import { PageHeader } from "@/components/ui/PageHeader";
import { NoAccess } from "@/components/ui/NoAccess";
import { ImportClient } from "./ImportClient";

/**
 * Bulk import.
 *
 * This page is only the gate and the frame. The real work — reading a
 * shopkeeper's existing spreadsheet, matching its columns to our fields, and
 * sending the rows up in safe-sized batches — happens in the browser, so a
 * 4,000-line price list is never uploaded as a file and the person watches a
 * progress bar instead of a spinner that might mean anything.
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Import products" };

export default async function ImportProductsPage() {
  const { user } = await requireTenant();

  if (!hasPermission(user, PERMISSIONS.PRODUCTS_IMPORT)) {
    return <NoAccess what="importing products" />;
  }

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
        title="Import from Excel"
        subtitle="Already have a price list? Bring it in as it is — we'll match the columns for you."
      />
      <ImportClient />
    </>
  );
}
