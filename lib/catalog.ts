import type { Prisma } from "@prisma/client";

import { prisma } from "./db";

/**
 * The catalog revision.
 *
 * WHY A COUNTER AND NOT A TIMESTAMP
 * ---------------------------------
 * The POS holds its entire catalog in IndexedDB so a cashier never waits for a
 * product list. Keeping that copy fresh needs one question answered cheaply:
 * "has anything changed since I last synced?" A timestamp can't answer it. Two
 * edits in the same millisecond are indistinguishable, a device whose clock is
 * wrong would ask the wrong question, and an edit that lands while a client is
 * mid-sync can be skipped entirely by a `>=` comparison.
 *
 * A monotonic integer read from a single column has none of those problems: a
 * client sends the version it holds, the server sends back everything above it,
 * and the comparison is exact. That is why `Organization.catalogVersion` exists
 * and why this file is the only thing allowed to touch it.
 *
 * WHEN TO BUMP
 * ------------
 * Anything that changes what the till shows: a product edited or deactivated, a
 * category renamed, a price changed in bulk, an import. NOT for a sale — sales
 * move stock, and stock reaches the POS through the level rows, not the catalog.
 * Bumping on every sale would make every till resync its whole catalog all day,
 * which is exactly the traffic this design exists to avoid.
 */

/**
 * Bump the catalog revision. Pass the transaction client when the bump must land
 * with the change that caused it.
 *
 * Deliberately swallows nothing: if this fails, the edit it belongs to should
 * fail with it. A catalog that changed without the version moving is a change no
 * till will ever see, and the symptom — "the price is right in the back office
 * and wrong at the till" — is close to impossible to diagnose from a support
 * call.
 */
export async function bumpCatalogVersion(
  organizationId: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<number> {
  const org = await tx.organization.update({
    where: { id: organizationId },
    data: { catalogVersion: { increment: 1 } },
    select: { catalogVersion: true },
  });
  return org.catalogVersion;
}

/** Bump once for a change that touched many products. Same guarantee, one write. */
export const bumpCatalogVersionMany = bumpCatalogVersion;

/** The version a POS client should hold after a full download. */
export async function currentCatalogVersion(organizationId: string): Promise<number> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { catalogVersion: true },
  });
  return org?.catalogVersion ?? 1;
}
