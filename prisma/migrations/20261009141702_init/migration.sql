-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('EMAIL_VERIFY', 'PHONE_VERIFY', 'LOGIN', 'SIGNATURE');

-- CreateEnum
CREATE TYPE "ConsenterEntityType" AS ENUM ('PERSON', 'TV_SHOW', 'MOVIE', 'WEB_SERIES', 'BRAND', 'FICTIONAL_CHARACTER', 'BAND_GROUP', 'SPORTS_TEAM', 'OTHER');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'MORE_INFO_NEEDED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RequesterType" AS ENUM ('INDIVIDUAL_CREATOR', 'NEWS_CHANNEL', 'PODCAST', 'MEME_PAGE', 'MEDIA_HOUSE', 'AGENCY', 'OTHER');

-- CreateEnum
CREATE TYPE "TeamRole" AS ENUM ('OWNER', 'MANAGER', 'LEGAL', 'EDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "MeetingMode" AS ENUM ('VIDEO', 'IN_PERSON');

-- CreateEnum
CREATE TYPE "MatrixPolicy" AS ENUM ('AUTO_APPROVE', 'ASK', 'AUTO_DENY');

-- CreateEnum
CREATE TYPE "RuleAction" AS ENUM ('AUTO_APPROVE', 'AUTO_DENY', 'ROUTE_TO_MEMBER');

-- CreateEnum
CREATE TYPE "ListKind" AS ENUM ('BLACKLIST', 'WHITELIST');

-- CreateEnum
CREATE TYPE "FileKind" AS ENUM ('DOCUMENT', 'ASSET', 'RAW_CONTENT', 'THUMBNAIL', 'ATTACHMENT', 'AGREEMENT', 'EVIDENCE', 'PROFILE_PHOTO');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'PENDING', 'IN_NEGOTIATION', 'DEAL_AGREED', 'CHANGES_REQUESTED', 'APPROVED_IN_PRINCIPLE', 'AGREEMENT_MODE_PENDING', 'LEGAL_AGREEMENT_PENDING', 'APPROVED', 'DENIED', 'CLOSED', 'EXPIRED_NO_RESPONSE', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ValidityKind" AS ENUM ('SINGLE_PUBLICATION', 'DATE_RANGE', 'PERPETUAL');

-- CreateEnum
CREATE TYPE "AgreementMode" AS ENUM ('APP_RECORD', 'LEGALLY_BINDING');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('OPEN', 'ACCEPTED', 'SUPERSEDED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "AgreementStatus" AS ENUM ('PROPOSED', 'DECLINED', 'DRAFTING', 'AWAITING_SIGNATURES', 'UPLOAD_PENDING_CONFIRMATION', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AgreementKind" AS ENUM ('PLATFORM_GENERATED', 'UPLOADED');

-- CreateEnum
CREATE TYPE "GrantStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "TakedownStatus" AS ENUM ('RAISED', 'MARKED_DOWN', 'DECLINED', 'CONFIRMED', 'REJECTED_CLAIM', 'IGNORED');

-- CreateEnum
CREATE TYPE "PaymentPurpose" AS ENUM ('ONBOARDING', 'SUBSCRIPTION', 'PER_REQUEST');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'FORFEITED');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'UPHELD', 'DISMISSED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "phone" TEXT,
    "phoneVerified" TIMESTAMP(3),
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "totpSecret" TEXT,
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "isSuspended" BOOLEAN NOT NULL DEFAULT false,
    "isBanned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "adminRoleId" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "totpPassed" BOOLEAN NOT NULL DEFAULT false,
    "activeProfile" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "target" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminRole" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false,
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsenterProfile" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "normalizedLegalName" TEXT NOT NULL,
    "entityType" "ConsenterEntityType" NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bio" TEXT,
    "photoFileId" TEXT,
    "country" TEXT NOT NULL,
    "category" TEXT,
    "status" "VerificationStatus" NOT NULL DEFAULT 'DRAFT',
    "verifiedAt" TIMESTAMP(3),
    "documentNumberHash" TEXT,
    "duplicateFlag" BOOLEAN NOT NULL DEFAULT false,
    "adminNotes" TEXT,
    "shareEmail" BOOLEAN NOT NULL DEFAULT true,
    "sharePhone" BOOLEAN NOT NULL DEFAULT false,
    "shareManager" BOOLEAN NOT NULL DEFAULT false,
    "managerContact" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "defaultRequireLegalAgreementForPaid" BOOLEAN NOT NULL DEFAULT false,
    "score" INTEGER NOT NULL DEFAULT 500,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsenterProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequesterProfile" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "type" "RequesterType" NOT NULL,
    "country" TEXT NOT NULL,
    "description" TEXT,
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "channels" JSONB NOT NULL DEFAULT '[]',
    "signatoryName" TEXT,
    "status" "VerificationStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedAt" TIMESTAMP(3),
    "adminNotes" TEXT,
    "shareEmail" BOOLEAN NOT NULL DEFAULT true,
    "sharePhone" BOOLEAN NOT NULL DEFAULT false,
    "shareManager" BOOLEAN NOT NULL DEFAULT false,
    "managerContact" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "score" INTEGER NOT NULL DEFAULT 500,
    "onboardingFeePaidAt" TIMESTAMP(3),
    "subscriptionEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequesterProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsenterMember" (
    "id" TEXT NOT NULL,
    "consenterId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "TeamRole" NOT NULL,
    "canApprove" BOOLEAN NOT NULL DEFAULT false,
    "canNegotiate" BOOLEAN NOT NULL DEFAULT false,
    "canEditRules" BOOLEAN NOT NULL DEFAULT false,
    "canExport" BOOLEAN NOT NULL DEFAULT false,
    "canManageTeam" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsenterMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequesterMember" (
    "id" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "TeamRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequesterMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamInvite" (
    "id" TEXT NOT NULL,
    "profileKind" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "TeamRole" NOT NULL,
    "canApprove" BOOLEAN NOT NULL DEFAULT false,
    "canNegotiate" BOOLEAN NOT NULL DEFAULT false,
    "canEditRules" BOOLEAN NOT NULL DEFAULT false,
    "canExport" BOOLEAN NOT NULL DEFAULT false,
    "canManageTeam" BOOLEAN NOT NULL DEFAULT false,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialAccount" (
    "id" TEXT NOT NULL,
    "platformName" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "url" TEXT,
    "followers" INTEGER,
    "verifiedVia" TEXT NOT NULL,
    "proofFileId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "consenterId" TEXT,
    "requesterId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationMeeting" (
    "id" TEXT NOT NULL,
    "consenterId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "mode" "MeetingMode" NOT NULL,
    "link" TEXT,
    "location" TEXT,
    "officerId" TEXT,
    "outcome" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationMeeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Platform" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Platform_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Format" (
    "id" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isTimed" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Format_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AssetType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntentCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "IntentCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DenialReason" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "DenialReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentMatrixEntry" (
    "id" TEXT NOT NULL,
    "consenterId" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,
    "formatId" TEXT NOT NULL,
    "assetTypeId" TEXT NOT NULL,
    "policy" "MatrixPolicy" NOT NULL DEFAULT 'ASK',
    "maxDurationSec" INTEGER,
    "thumbnailAllowed" BOOLEAN NOT NULL DEFAULT true,
    "paidDefault" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ConsentMatrixEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StandingRule" (
    "id" TEXT NOT NULL,
    "consenterId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "conditions" JSONB NOT NULL,
    "action" "RuleAction" NOT NULL,
    "routeToUserId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StandingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListEntry" (
    "id" TEXT NOT NULL,
    "kind" "ListKind" NOT NULL,
    "consenterId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoredFile" (
    "id" TEXT NOT NULL,
    "kind" "FileKind" NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "uploadedById" TEXT,
    "requestId" TEXT,
    "replacesId" TEXT,
    "approvedInGrant" BOOLEAN NOT NULL DEFAULT false,
    "consenterDocOf" TEXT,
    "requesterDocOf" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRequest" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "requesterId" TEXT NOT NULL,
    "consenterId" TEXT NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'DRAFT',
    "selections" JSONB NOT NULL,
    "assetTypeIds" TEXT[],
    "assetTypeNames" TEXT[],
    "thumbnailUsed" BOOLEAN NOT NULL DEFAULT false,
    "context" TEXT NOT NULL,
    "creativePlan" TEXT NOT NULL,
    "intentCategoryId" TEXT,
    "intentCategoryName" TEXT,
    "validityKind" "ValidityKind" NOT NULL,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "plannedPublishAt" TIMESTAMP(3),
    "conditionsNote" TEXT,
    "approvedSelections" JSONB,
    "approvedThumbnail" BOOLEAN,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "agreedAmount" DECIMAL(14,2),
    "agreedCurrency" TEXT,
    "agreementMode" "AgreementMode",
    "agreementModeProposedBy" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decidedByRuleId" TEXT,
    "decidedByRuleName" TEXT,
    "denialReason" TEXT,
    "slaExpiresAt" TIMESTAMP(3),
    "reminder50Sent" BOOLEAN NOT NULL DEFAULT false,
    "reminder90Sent" BOOLEAN NOT NULL DEFAULT false,
    "closedReason" TEXT,
    "contactsRevealed" BOOLEAN NOT NULL DEFAULT false,
    "contactsSnapshot" JSONB,
    "lastOfferAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestEvent" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorName" TEXT,
    "actorSide" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestMessage" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "senderSide" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attachmentFileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NegotiationOffer" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "bySide" TEXT NOT NULL,
    "byUserId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "scopeNote" TEXT,
    "status" "OfferStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NegotiationOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agreement" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "kind" "AgreementKind",
    "status" "AgreementStatus" NOT NULL DEFAULT 'PROPOSED',
    "proposedBySide" TEXT NOT NULL,
    "templateId" TEXT,
    "body" TEXT,
    "bodyVersion" INTEGER NOT NULL DEFAULT 1,
    "uploadedFileId" TEXT,
    "uploadConfirmedBySide" TEXT,
    "sha256" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgreementSignature" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "typedName" TEXT NOT NULL,
    "otpVerified" BOOLEAN NOT NULL DEFAULT false,
    "ip" TEXT,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgreementSignature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgreementTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "optionalClauses" JSONB NOT NULL DEFAULT '[]',
    "disclaimer" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgreementTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Grant" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "status" "GrantStatus" NOT NULL DEFAULT 'ACTIVE',
    "validityKind" "ValidityKind" NOT NULL,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "expiryNotified" BOOLEAN NOT NULL DEFAULT false,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,
    "certificateId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "signature" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Grant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TakedownRequest" (
    "id" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "liveLinks" TEXT[],
    "status" "TakedownStatus" NOT NULL DEFAULT 'RAISED',
    "requesterNote" TEXT,
    "requesterEvidenceFileId" TEXT,
    "declineReason" TEXT,
    "respondBy" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TakedownRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "purpose" "PaymentPurpose" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerRef" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "couponCode" TEXT,
    "discount" DECIMAL(14,2),
    "tax" DECIMAL(14,2),
    "taxLabel" TEXT,
    "requestId" TEXT,
    "invoiceNumber" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceConfig" (
    "id" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "onboardingFee" DECIMAL(14,2) NOT NULL,
    "yearlyFee" DECIMAL(14,2) NOT NULL,
    "perRequestFee" DECIMAL(14,2) NOT NULL,
    "taxLabel" TEXT,
    "taxRate" DECIMAL(5,2),

    CONSTRAINT "PriceConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Coupon" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "percentOff" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "bySide" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "evidenceLinks" TEXT[],
    "evidenceFileIds" TEXT[],
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "response" TEXT,
    "adminNotes" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreLog" (
    "id" TEXT NOT NULL,
    "consenterId" TEXT,
    "requesterId" TEXT,
    "oldScore" INTEGER NOT NULL,
    "newScore" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "adjustedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoreLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "targetId" TEXT,
    "detail" JSONB,
    "reason" TEXT,
    "ip" TEXT,
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "runAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPref" (
    "userId" TEXT NOT NULL,
    "emailStateChanges" BOOLEAN NOT NULL DEFAULT true,
    "smsCritical" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "NotificationPref_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "OutboxMessage" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CmsPage" (
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CmsPage_pkey" PRIMARY KEY ("slug")
);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "key" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ExportLog" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "byUserId" TEXT,
    "byName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExportLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "AdminRole_name_key" ON "AdminRole"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ConsenterProfile_slug_key" ON "ConsenterProfile"("slug");

-- CreateIndex
CREATE INDEX "ConsenterProfile_normalizedLegalName_idx" ON "ConsenterProfile"("normalizedLegalName");

-- CreateIndex
CREATE INDEX "ConsenterProfile_status_idx" ON "ConsenterProfile"("status");

-- CreateIndex
CREATE UNIQUE INDEX "RequesterProfile_slug_key" ON "RequesterProfile"("slug");

-- CreateIndex
CREATE INDEX "RequesterProfile_status_idx" ON "RequesterProfile"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ConsenterMember_consenterId_userId_key" ON "ConsenterMember"("consenterId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "RequesterMember_requesterId_userId_key" ON "RequesterMember"("requesterId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamInvite_token_key" ON "TeamInvite"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Platform_name_key" ON "Platform"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Format_platformId_name_key" ON "Format"("platformId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "AssetType_name_key" ON "AssetType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "IntentCategory_name_key" ON "IntentCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "DenialReason_label_key" ON "DenialReason"("label");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentMatrixEntry_consenterId_platformId_formatId_assetTyp_key" ON "ConsentMatrixEntry"("consenterId", "platformId", "formatId", "assetTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "ListEntry_kind_consenterId_requesterId_key" ON "ListEntry"("kind", "consenterId", "requesterId");

-- CreateIndex
CREATE INDEX "StoredFile_requestId_idx" ON "StoredFile"("requestId");

-- CreateIndex
CREATE INDEX "StoredFile_sha256_idx" ON "StoredFile"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentRequest_number_key" ON "ConsentRequest"("number");

-- CreateIndex
CREATE INDEX "ConsentRequest_consenterId_status_idx" ON "ConsentRequest"("consenterId", "status");

-- CreateIndex
CREATE INDEX "ConsentRequest_requesterId_status_idx" ON "ConsentRequest"("requesterId", "status");

-- CreateIndex
CREATE INDEX "RequestEvent_requestId_idx" ON "RequestEvent"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "NegotiationOffer_requestId_version_key" ON "NegotiationOffer"("requestId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Agreement_requestId_key" ON "Agreement"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "AgreementSignature_agreementId_side_key" ON "AgreementSignature"("agreementId", "side");

-- CreateIndex
CREATE UNIQUE INDEX "Grant_publicId_key" ON "Grant"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "Grant_requestId_key" ON "Grant"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "Grant_certificateId_key" ON "Grant"("certificateId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_requestId_key" ON "Payment"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_invoiceNumber_key" ON "Payment"("invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PriceConfig_country_key" ON "PriceConfig"("country");

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code");

-- CreateIndex
CREATE INDEX "AuditLog_module_idx" ON "AuditLog"("module");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "Job_runAt_doneAt_idx" ON "Job"("runAt", "doneAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_adminRoleId_fkey" FOREIGN KEY ("adminRoleId") REFERENCES "AdminRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtpCode" ADD CONSTRAINT "OtpCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsenterMember" ADD CONSTRAINT "ConsenterMember_consenterId_fkey" FOREIGN KEY ("consenterId") REFERENCES "ConsenterProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsenterMember" ADD CONSTRAINT "ConsenterMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequesterMember" ADD CONSTRAINT "RequesterMember_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "RequesterProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequesterMember" ADD CONSTRAINT "RequesterMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_consenterId_fkey" FOREIGN KEY ("consenterId") REFERENCES "ConsenterProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "RequesterProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationMeeting" ADD CONSTRAINT "VerificationMeeting_consenterId_fkey" FOREIGN KEY ("consenterId") REFERENCES "ConsenterProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationMeeting" ADD CONSTRAINT "VerificationMeeting_officerId_fkey" FOREIGN KEY ("officerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Format" ADD CONSTRAINT "Format_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "Platform"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentMatrixEntry" ADD CONSTRAINT "ConsentMatrixEntry_consenterId_fkey" FOREIGN KEY ("consenterId") REFERENCES "ConsenterProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandingRule" ADD CONSTRAINT "StandingRule_consenterId_fkey" FOREIGN KEY ("consenterId") REFERENCES "ConsenterProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListEntry" ADD CONSTRAINT "ListEntry_consenterId_fkey" FOREIGN KEY ("consenterId") REFERENCES "ConsenterProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListEntry" ADD CONSTRAINT "ListEntry_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "RequesterProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ConsentRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_consenterDocOf_fkey" FOREIGN KEY ("consenterDocOf") REFERENCES "ConsenterProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_requesterDocOf_fkey" FOREIGN KEY ("requesterDocOf") REFERENCES "RequesterProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRequest" ADD CONSTRAINT "ConsentRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "RequesterProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRequest" ADD CONSTRAINT "ConsentRequest_consenterId_fkey" FOREIGN KEY ("consenterId") REFERENCES "ConsenterProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRequest" ADD CONSTRAINT "ConsentRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestEvent" ADD CONSTRAINT "RequestEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ConsentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestMessage" ADD CONSTRAINT "RequestMessage_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ConsentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestMessage" ADD CONSTRAINT "RequestMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NegotiationOffer" ADD CONSTRAINT "NegotiationOffer_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ConsentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NegotiationOffer" ADD CONSTRAINT "NegotiationOffer_byUserId_fkey" FOREIGN KEY ("byUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agreement" ADD CONSTRAINT "Agreement_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ConsentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agreement" ADD CONSTRAINT "Agreement_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "AgreementTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgreementSignature" ADD CONSTRAINT "AgreementSignature_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "Agreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgreementSignature" ADD CONSTRAINT "AgreementSignature_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Grant" ADD CONSTRAINT "Grant_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ConsentRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TakedownRequest" ADD CONSTRAINT "TakedownRequest_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "Grant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "RequesterProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ConsentRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ConsentRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreLog" ADD CONSTRAINT "ScoreLog_consenterId_fkey" FOREIGN KEY ("consenterId") REFERENCES "ConsenterProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreLog" ADD CONSTRAINT "ScoreLog_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "RequesterProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreLog" ADD CONSTRAINT "ScoreLog_adjustedById_fkey" FOREIGN KEY ("adjustedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPref" ADD CONSTRAINT "NotificationPref_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
