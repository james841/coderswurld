-- Supplier receipts: the supplier is now a typed name. A saved supplier is
-- still linked when the name matches; any other name is kept as typed.
ALTER TABLE "SupplierReceipt" ALTER COLUMN "supplierId" DROP NOT NULL;
