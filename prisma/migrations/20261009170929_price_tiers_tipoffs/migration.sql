-- CreateEnum
CREATE TYPE "TipOffStatus" AS ENUM ('OPEN', 'REVIEWED', 'DISMISSED');

-- CreateTable
CREATE TABLE "ConsentPriceTier" (
    "id" TEXT NOT NULL,
    "consenterId" TEXT NOT NULL,
    "intentCategoryId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "ConsentPriceTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicTipOff" (
    "id" TEXT NOT NULL,
    "consenterId" TEXT NOT NULL,
    "links" TEXT[],
    "description" TEXT NOT NULL,
    "reporterName" TEXT,
    "reporterEmail" TEXT,
    "status" "TipOffStatus" NOT NULL DEFAULT 'OPEN',
    "adminNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicTipOff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConsentPriceTier_consenterId_intentCategoryId_key" ON "ConsentPriceTier"("consenterId", "intentCategoryId");

-- CreateIndex
CREATE INDEX "PublicTipOff_consenterId_status_idx" ON "PublicTipOff"("consenterId", "status");

-- CreateIndex
CREATE INDEX "PublicTipOff_status_idx" ON "PublicTipOff"("status");

-- AddForeignKey
ALTER TABLE "ConsentPriceTier" ADD CONSTRAINT "ConsentPriceTier_consenterId_fkey" FOREIGN KEY ("consenterId") REFERENCES "ConsenterProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentPriceTier" ADD CONSTRAINT "ConsentPriceTier_intentCategoryId_fkey" FOREIGN KEY ("intentCategoryId") REFERENCES "IntentCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicTipOff" ADD CONSTRAINT "PublicTipOff_consenterId_fkey" FOREIGN KEY ("consenterId") REFERENCES "ConsenterProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
