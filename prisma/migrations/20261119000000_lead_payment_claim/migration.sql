-- Plan requests: what the customer reports when they press "I've paid".
ALTER TABLE "Lead" ADD COLUMN "paymentClaimedAt" TIMESTAMP(3);
ALTER TABLE "Lead" ADD COLUMN "paymentSenderName" TEXT;
ALTER TABLE "Lead" ADD COLUMN "paymentAmountKobo" INTEGER;
ALTER TABLE "Lead" ADD COLUMN "paymentPaidOn" TIMESTAMP(3);
ALTER TABLE "Lead" ADD COLUMN "paymentBank" TEXT;
ALTER TABLE "Lead" ADD COLUMN "paymentNote" TEXT;
