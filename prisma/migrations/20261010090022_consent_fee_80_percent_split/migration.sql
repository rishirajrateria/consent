-- AlterTable
ALTER TABLE "EarningEntry" ADD COLUMN     "grossAmount" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "refundedAmount" DECIMAL(14,2);

-- Every consent request fee keeps its full amount in grossAmount; earnings
-- not yet paid out become the owner's 80% share.
UPDATE "EarningEntry" SET "grossAmount" = amount WHERE "grossAmount" IS NULL;
UPDATE "EarningEntry" SET amount = ROUND(amount * 0.80, 2) WHERE status IN ('HELD', 'PENDING');
-- Refunds made before the split returned the whole fee.
UPDATE "Payment" SET "refundedAmount" = amount WHERE status = 'REFUNDED' AND "refundedAmount" IS NULL;
