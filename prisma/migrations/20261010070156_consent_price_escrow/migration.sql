-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EarningStatus" ADD VALUE 'HELD';
ALTER TYPE "EarningStatus" ADD VALUE 'REFUNDED';

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'REFUNDED';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "refundRef" TEXT,
ADD COLUMN     "refundedAt" TIMESTAMP(3);
