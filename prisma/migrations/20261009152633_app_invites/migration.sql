-- CreateTable
CREATE TABLE "AppInvite" (
    "id" TEXT NOT NULL,
    "targetName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "email" TEXT,
    "handle" TEXT,
    "note" TEXT,
    "invitedById" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "claimedByConsenterId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AppInvite_normalizedName_idx" ON "AppInvite"("normalizedName");

-- CreateIndex
CREATE INDEX "AppInvite_email_idx" ON "AppInvite"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AppInvite_invitedById_normalizedName_key" ON "AppInvite"("invitedById", "normalizedName");

-- AddForeignKey
ALTER TABLE "AppInvite" ADD CONSTRAINT "AppInvite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
