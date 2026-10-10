-- CreateEnum
CREATE TYPE "CallMode" AS ENUM ('VIDEO', 'PHONE', 'IN_PERSON');

-- CreateEnum
CREATE TYPE "RequestMeetingStatus" AS ENUM ('SCHEDULED', 'CANCELLED');

-- AlterTable
ALTER TABLE "ConsenterProfile" ADD COLUMN     "contactAddress" TEXT,
ADD COLUMN     "shareAddress" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "RequesterProfile" ADD COLUMN     "contactAddress" TEXT,
ADD COLUMN     "shareAddress" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "RequestMeeting" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "timeZone" TEXT NOT NULL,
    "mode" "CallMode" NOT NULL,
    "link" TEXT,
    "location" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdBySide" TEXT NOT NULL,
    "status" "RequestMeetingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "calendarRef" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequestMeeting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RequestMeeting_requestId_idx" ON "RequestMeeting"("requestId");

-- AddForeignKey
ALTER TABLE "RequestMeeting" ADD CONSTRAINT "RequestMeeting_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ConsentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestMeeting" ADD CONSTRAINT "RequestMeeting_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
