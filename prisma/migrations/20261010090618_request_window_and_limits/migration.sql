-- AlterTable
ALTER TABLE "ConsentRequest" ADD COLUMN     "remindedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ConsenterProfile" ADD COLUMN     "dailyRequestLimit" INTEGER,
ADD COLUMN     "maxOpenRequests" INTEGER,
ADD COLUMN     "monthlyRequestLimit" INTEGER,
ADD COLUMN     "weeklyRequestLimit" INTEGER;
