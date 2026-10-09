-- CreateEnum
CREATE TYPE "EarningStatus" AS ENUM ('PENDING', 'SETTLED', 'REVERSED');

-- AlterEnum
ALTER TYPE "PaymentPurpose" ADD VALUE 'CONSENT_PRICE';

-- DropIndex
DROP INDEX "Payment_requestId_key";

-- AlterTable
ALTER TABLE "ConsenterProfile" ADD COLUMN     "consentPrice" DECIMAL(14,2),
ADD COLUMN     "consentPriceCurrency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN     "payoutDetails" TEXT;

-- CreateTable
CREATE TABLE "EarningEntry" (
    "id" TEXT NOT NULL,
    "consenterId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "EarningStatus" NOT NULL DEFAULT 'PENDING',
    "reversedReason" TEXT,
    "settlementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EarningEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL,
    "consenterId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "reference" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EarningEntry_requestId_key" ON "EarningEntry"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "EarningEntry_paymentId_key" ON "EarningEntry"("paymentId");

-- CreateIndex
CREATE INDEX "EarningEntry_consenterId_status_idx" ON "EarningEntry"("consenterId", "status");

-- CreateIndex
CREATE INDEX "Settlement_consenterId_idx" ON "Settlement"("consenterId");

-- CreateIndex
CREATE INDEX "Payment_requestId_idx" ON "Payment"("requestId");

-- AddForeignKey
ALTER TABLE "EarningEntry" ADD CONSTRAINT "EarningEntry_consenterId_fkey" FOREIGN KEY ("consenterId") REFERENCES "ConsenterProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EarningEntry" ADD CONSTRAINT "EarningEntry_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ConsentRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EarningEntry" ADD CONSTRAINT "EarningEntry_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EarningEntry" ADD CONSTRAINT "EarningEntry_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_consenterId_fkey" FOREIGN KEY ("consenterId") REFERENCES "ConsenterProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
