-- A deleted product no longer holds its barcode.
ALTER TABLE "Product" ADD COLUMN "retiredBarcode" TEXT;

-- Free the barcodes of products that were deleted before this change.
UPDATE "Product"
SET "retiredBarcode" = "barcode", "barcode" = NULL
WHERE "isActive" = false AND "barcode" IS NOT NULL;
