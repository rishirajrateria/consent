-- One account type, and no deal-making after a yes.
-- Every profile can now both receive and send: a ConsenterProfile and its
-- sending half (RequesterProfile.consenterId) form one profile. Removed:
-- fee negotiation, legal agreements, contact sharing and request meetings.
-- The consent request fee (80/20) and the platform fee stay; the requester
-- onboarding fee + yearly plan become one yearly membership.

-- Requests in removed steps move to the nearest step that still exists:
-- a fee being negotiated goes back to waiting for an answer; an agreed deal
-- or an agreement in progress was already a yes.
UPDATE "ConsentRequest" SET "status" = 'PENDING' WHERE "status" = 'IN_NEGOTIATION';
UPDATE "ConsentRequest" SET "status" = 'APPROVED_IN_PRINCIPLE'
  WHERE "status" IN ('DEAL_AGREED', 'AGREEMENT_MODE_PENDING', 'LEGAL_AGREEMENT_PENDING');

-- Signed agreement uploads and signature codes have nothing left to belong to.
DELETE FROM "StoredFile" WHERE "kind" = 'AGREEMENT';
DELETE FROM "OtpCode" WHERE "purpose" = 'SIGNATURE';

-- The onboarding fee and the yearly plan become one membership payment.
ALTER TYPE "PaymentPurpose" RENAME VALUE 'SUBSCRIPTION' TO 'MEMBERSHIP';
UPDATE "Payment" SET "purpose" = 'MEMBERSHIP' WHERE "purpose" = 'ONBOARDING';

-- The Legal team role is retired.
UPDATE "ConsenterMember" SET "role" = 'MANAGER' WHERE "role" = 'LEGAL';
UPDATE "RequesterMember" SET "role" = 'EDITOR' WHERE "role" = 'LEGAL';
UPDATE "TeamInvite" SET "role" = 'MANAGER' WHERE "role" = 'LEGAL';

-- AlterEnum
BEGIN;
CREATE TYPE "FileKind_new" AS ENUM ('DOCUMENT', 'ASSET', 'RAW_CONTENT', 'THUMBNAIL', 'ATTACHMENT', 'EVIDENCE', 'PROFILE_PHOTO');
ALTER TABLE "StoredFile" ALTER COLUMN "kind" TYPE "FileKind_new" USING ("kind"::text::"FileKind_new");
ALTER TYPE "FileKind" RENAME TO "FileKind_old";
ALTER TYPE "FileKind_new" RENAME TO "FileKind";
DROP TYPE "public"."FileKind_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "OtpPurpose_new" AS ENUM ('EMAIL_VERIFY', 'PHONE_VERIFY', 'LOGIN');
ALTER TABLE "OtpCode" ALTER COLUMN "purpose" TYPE "OtpPurpose_new" USING ("purpose"::text::"OtpPurpose_new");
ALTER TYPE "OtpPurpose" RENAME TO "OtpPurpose_old";
ALTER TYPE "OtpPurpose_new" RENAME TO "OtpPurpose";
DROP TYPE "public"."OtpPurpose_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "PaymentPurpose_new" AS ENUM ('MEMBERSHIP', 'PER_REQUEST', 'CONSENT_PRICE');
ALTER TABLE "Payment" ALTER COLUMN "purpose" TYPE "PaymentPurpose_new" USING ("purpose"::text::"PaymentPurpose_new");
ALTER TYPE "PaymentPurpose" RENAME TO "PaymentPurpose_old";
ALTER TYPE "PaymentPurpose_new" RENAME TO "PaymentPurpose";
DROP TYPE "public"."PaymentPurpose_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "RequestStatus_new" AS ENUM ('DRAFT', 'SUBMITTED', 'PENDING', 'CHANGES_REQUESTED', 'APPROVED_IN_PRINCIPLE', 'APPROVED', 'DENIED', 'CLOSED', 'EXPIRED_NO_RESPONSE', 'WITHDRAWN');
ALTER TABLE "public"."ConsentRequest" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "ConsentRequest" ALTER COLUMN "status" TYPE "RequestStatus_new" USING ("status"::text::"RequestStatus_new");
ALTER TYPE "RequestStatus" RENAME TO "RequestStatus_old";
ALTER TYPE "RequestStatus_new" RENAME TO "RequestStatus";
DROP TYPE "public"."RequestStatus_old";
ALTER TABLE "ConsentRequest" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "TeamRole_new" AS ENUM ('OWNER', 'MANAGER', 'EDITOR', 'VIEWER');
ALTER TABLE "ConsenterMember" ALTER COLUMN "role" TYPE "TeamRole_new" USING ("role"::text::"TeamRole_new");
ALTER TABLE "RequesterMember" ALTER COLUMN "role" TYPE "TeamRole_new" USING ("role"::text::"TeamRole_new");
ALTER TABLE "TeamInvite" ALTER COLUMN "role" TYPE "TeamRole_new" USING ("role"::text::"TeamRole_new");
ALTER TYPE "TeamRole" RENAME TO "TeamRole_old";
ALTER TYPE "TeamRole_new" RENAME TO "TeamRole";
DROP TYPE "public"."TeamRole_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "Agreement" DROP CONSTRAINT "Agreement_requestId_fkey";

-- DropForeignKey
ALTER TABLE "Agreement" DROP CONSTRAINT "Agreement_templateId_fkey";

-- DropForeignKey
ALTER TABLE "AgreementSignature" DROP CONSTRAINT "AgreementSignature_agreementId_fkey";

-- DropForeignKey
ALTER TABLE "AgreementSignature" DROP CONSTRAINT "AgreementSignature_userId_fkey";

-- DropForeignKey
ALTER TABLE "NegotiationOffer" DROP CONSTRAINT "NegotiationOffer_byUserId_fkey";

-- DropForeignKey
ALTER TABLE "NegotiationOffer" DROP CONSTRAINT "NegotiationOffer_requestId_fkey";

-- DropForeignKey
ALTER TABLE "RequestMeeting" DROP CONSTRAINT "RequestMeeting_createdById_fkey";

-- DropForeignKey
ALTER TABLE "RequestMeeting" DROP CONSTRAINT "RequestMeeting_requestId_fkey";

-- AlterTable
ALTER TABLE "ConsentMatrixEntry" DROP COLUMN "paidDefault";

-- AlterTable
ALTER TABLE "ConsentRequest" DROP COLUMN "agreedAmount",
DROP COLUMN "agreedCurrency",
DROP COLUMN "agreementMode",
DROP COLUMN "agreementModeProposedBy",
DROP COLUMN "contactsRevealed",
DROP COLUMN "contactsSnapshot",
DROP COLUMN "isPaid",
DROP COLUMN "lastOfferAt";

-- AlterTable
ALTER TABLE "ConsenterMember" DROP COLUMN "canNegotiate";

-- AlterTable
ALTER TABLE "ConsenterProfile" DROP COLUMN "contactAddress",
DROP COLUMN "contactEmail",
DROP COLUMN "contactPhone",
DROP COLUMN "defaultRequireLegalAgreementForPaid",
DROP COLUMN "managerContact",
DROP COLUMN "shareAddress",
DROP COLUMN "shareEmail",
DROP COLUMN "shareManager",
DROP COLUMN "sharePhone",
ALTER COLUMN "consentPriceCurrency" SET DEFAULT 'INR';

-- AlterTable
ALTER TABLE "PriceConfig" DROP COLUMN "onboardingFee",
DROP COLUMN "perRequestFee";
ALTER TABLE "PriceConfig" RENAME COLUMN "yearlyFee" TO "membershipFee";
-- One yearly membership: ₹1,000 in India (switched off for now).
UPDATE "PriceConfig" SET "membershipFee" = 1000 WHERE "country" = 'IN';

-- AlterTable
ALTER TABLE "RequesterProfile" DROP COLUMN "contactAddress",
DROP COLUMN "contactEmail",
DROP COLUMN "contactPhone",
DROP COLUMN "managerContact",
DROP COLUMN "onboardingFeePaidAt",
DROP COLUMN "shareAddress",
DROP COLUMN "shareEmail",
DROP COLUMN "shareManager",
DROP COLUMN "sharePhone",
DROP COLUMN "signatoryName",
ADD COLUMN     "consenterId" TEXT;
ALTER TABLE "RequesterProfile" RENAME COLUMN "subscriptionEndsAt" TO "membershipEndsAt";

-- AlterTable
ALTER TABLE "TeamInvite" DROP COLUMN "canNegotiate";

-- DropTable
DROP TABLE "Agreement";

-- DropTable
DROP TABLE "AgreementSignature";

-- DropTable
DROP TABLE "AgreementTemplate";

-- DropTable
DROP TABLE "NegotiationOffer";

-- DropTable
DROP TABLE "RequestMeeting";

-- DropEnum
DROP TYPE "AgreementKind";

-- DropEnum
DROP TYPE "AgreementMode";

-- DropEnum
DROP TYPE "AgreementStatus";

-- DropEnum
DROP TYPE "CallMode";

-- DropEnum
DROP TYPE "OfferStatus";

-- DropEnum
DROP TYPE "RequestMeetingStatus";

-- CreateTable
CREATE TABLE "Currency" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minConsentFee" DECIMAL(14,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Currency_pkey" PRIMARY KEY ("code")
);

-- Pair what clearly belongs together: someone who owns exactly one profile of
-- each kind gets them joined into one. Every other profile gets its missing
-- half created by the app the first time it is used (src/lib/profiles.ts).
WITH owners AS (
  SELECT cm."userId", MIN(cm."consenterId") AS cid, MIN(rm."requesterId") AS rid
  FROM "ConsenterMember" cm
  JOIN "RequesterMember" rm ON rm."userId" = cm."userId" AND rm."role" = 'OWNER'
  WHERE cm."role" = 'OWNER'
  GROUP BY cm."userId"
  HAVING COUNT(DISTINCT cm."consenterId") = 1 AND COUNT(DISTINCT rm."requesterId") = 1
), unique_pairs AS (
  SELECT o.* FROM owners o
  WHERE NOT EXISTS (SELECT 1 FROM owners o2 WHERE o2.cid = o.cid AND o2.rid <> o.rid)
    AND NOT EXISTS (SELECT 1 FROM owners o3 WHERE o3.rid = o.rid AND o3.cid <> o.cid)
)
UPDATE "RequesterProfile" r SET "consenterId" = p.cid FROM unique_pairs p WHERE r."id" = p.rid;

-- CreateIndex
CREATE UNIQUE INDEX "RequesterProfile_consenterId_key" ON "RequesterProfile"("consenterId");

-- AddForeignKey
ALTER TABLE "RequesterProfile" ADD CONSTRAINT "RequesterProfile_consenterId_fkey" FOREIGN KEY ("consenterId") REFERENCES "ConsenterProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

