-- Receipt design choices (style, lettering, extra lines), set by admins and managers.
ALTER TABLE "OrgSettings" ADD COLUMN "receiptDesign" JSONB;
