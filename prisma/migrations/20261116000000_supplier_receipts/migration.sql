-- CreateTable
CREATE TABLE "SupplierReceipt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "receiptNo" TEXT,
    "receiptDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amountKobo" INTEGER,
    "note" TEXT,
    "purchaseId" TEXT,
    "fileKey" TEXT NOT NULL,
    "fileMime" TEXT NOT NULL,
    "fileBytes" INTEGER NOT NULL,
    "originalBytes" INTEGER NOT NULL DEFAULT 0,
    "thumbKey" TEXT,
    "sha256" TEXT NOT NULL,
    "uploadedById" TEXT,
    "uploadedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierReceipt_organizationId_receiptDate_idx" ON "SupplierReceipt"("organizationId", "receiptDate");

-- CreateIndex
CREATE INDEX "SupplierReceipt_organizationId_supplierId_receiptDate_idx" ON "SupplierReceipt"("organizationId", "supplierId", "receiptDate");

-- CreateIndex
CREATE INDEX "SupplierReceipt_organizationId_receiptNo_idx" ON "SupplierReceipt"("organizationId", "receiptNo");

-- CreateIndex
CREATE INDEX "SupplierReceipt_organizationId_purchaseId_idx" ON "SupplierReceipt"("organizationId", "purchaseId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierReceipt_organizationId_reference_key" ON "SupplierReceipt"("organizationId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierReceipt_organizationId_sha256_key" ON "SupplierReceipt"("organizationId", "sha256");

-- AddForeignKey
ALTER TABLE "SupplierReceipt" ADD CONSTRAINT "SupplierReceipt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierReceipt" ADD CONSTRAINT "SupplierReceipt_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierReceipt" ADD CONSTRAINT "SupplierReceipt_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierReceipt" ADD CONSTRAINT "SupplierReceipt_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
