-- Supermarket / Pharmacy departments.
ALTER TABLE "Product" ADD COLUMN "department" TEXT NOT NULL DEFAULT 'SUPERMARKET';
ALTER TABLE "User" ADD COLUMN "department" TEXT;
ALTER TABLE "OrgSettings" ADD COLUMN "departmentsEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Product_organizationId_department_idx" ON "Product"("organizationId", "department");

-- Shops that already sell pharmacy products: mark everything as pharmacy so
-- the defaults match what they are.
UPDATE "Product" p SET "department" = 'PHARMACY'
FROM "Organization" o
WHERE p."organizationId" = o.id AND o."businessType" = 'PHARMACY';

-- Every till holds a copy of the catalogue that predates the new field. Move
-- each shop's catalogue version on by one and stamp every product with it, so
-- each till downloads the products again (now with their department) on its
-- next sync instead of keeping copies that don't say which department they are.
UPDATE "Organization" SET "catalogVersion" = "catalogVersion" + 1;
UPDATE "Product" p SET "version" = o."catalogVersion"
FROM "Organization" o
WHERE p."organizationId" = o.id;
