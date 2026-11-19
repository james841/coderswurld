-- CreateTable
CREATE TABLE "PurchaseChange" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseChange_purchaseId_createdAt_idx" ON "PurchaseChange"("purchaseId", "createdAt");

-- CreateIndex
CREATE INDEX "PurchaseChange_organizationId_createdAt_idx" ON "PurchaseChange"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "PurchaseChange" ADD CONSTRAINT "PurchaseChange_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
