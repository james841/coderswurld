-- Every plan now includes unlimited cashiers (-1 means unlimited).
-- Shops that signed up before this change keep the old number on their
-- subscription row, so lift it for them too.
UPDATE "Subscription" SET "seatsCashier" = -1 WHERE "seatsCashier" <> -1;
