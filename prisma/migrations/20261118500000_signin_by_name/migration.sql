-- Staff can sign in with their name instead of an email, and email becomes
-- optional (many cashiers don't have one).

ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "User" ADD COLUMN "loginName" TEXT;

UPDATE "User" SET "loginName" = lower(regexp_replace(trim("name"), '\s+', ' ', 'g'));

CREATE INDEX "User_loginName_idx" ON "User"("loginName");
