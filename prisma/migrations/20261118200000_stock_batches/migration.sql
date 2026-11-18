-- Batches with expiry dates, so stock can be sold oldest-expiry first.

CREATE TABLE "StockBatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "batchNo" TEXT,
    "expiryDate" TIMESTAMP(3),
    "quantityReceived" DOUBLE PRECISION NOT NULL,
    "quantityLeft" DOUBLE PRECISION NOT NULL,
    "unitCostKobo" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'PURCHASE',
    "referenceId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "writtenOffAt" TIMESTAMP(3),
    CONSTRAINT "StockBatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StockBatch_organizationId_expiryDate_idx" ON "StockBatch"("organizationId", "expiryDate");
CREATE INDEX "StockBatch_productId_branchId_idx" ON "StockBatch"("productId", "branchId");

ALTER TABLE "StockBatch" ADD CONSTRAINT "StockBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockBatch" ADD CONSTRAINT "StockBatch_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockBatch" ADD CONSTRAINT "StockBatch_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Stock already on the shelf for products with an expiry date becomes one
-- opening batch per branch, so nothing on hand is lost from the expiry view.
INSERT INTO "StockBatch" ("id", "organizationId", "productId", "branchId", "expiryDate",
                          "quantityReceived", "quantityLeft", "unitCostKobo", "source")
SELECT 'ob_' || md5(sl."productId" || sl."branchId"), sl."organizationId", sl."productId", sl."branchId",
       p."expiryDate", sl."quantity", sl."quantity", p."costPriceKobo", 'OPENING'
FROM "StockLevel" sl
JOIN "Product" p ON p."id" = sl."productId"
WHERE p."expiryDate" IS NOT NULL AND sl."quantity" > 0;

-- The daily summary now waits for the owner to switch it on. Existing shops
-- keep whatever they had.
ALTER TABLE "OrgSettings" ALTER COLUMN "dailyReportEnabled" SET DEFAULT false;
