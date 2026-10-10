import "server-only";

import { db } from "@/lib/db";
import { normalizeLegalName } from "@/lib/utils";

/*
 * Server-only on purpose: this is NOT a Server Action. It takes any profile id
 * and name and notifies inviters, so it must never be reachable by a POST.
 * Callers (onboarding, the admin ID check) check the session first.
 */

/**
 * Claim loop: when a profile is created (or verified), match open invites by
 * normalized name or the owner's login email, mark them claimed and tell
 * every inviter their person has arrived. consenterId is the profile's id.
 */
export async function claimInvitesForConsenter(opts: {
  consenterId: string;
  displayName: string;
  normalizedLegalName: string;
  ownerEmail: string;
  stage: "joined" | "verified";
}) {
  const { notifyUser } = await import("@/lib/notify");
  const where =
    opts.stage === "joined"
      ? {
          claimedAt: null,
          OR: [
            { normalizedName: opts.normalizedLegalName },
            { normalizedName: normalizeLegalName(opts.displayName) },
            { email: { equals: opts.ownerEmail, mode: "insensitive" as const } },
          ],
        }
      : { claimedByConsenterId: opts.consenterId };
  const invites = await db.appInvite.findMany({ where });
  if (invites.length === 0) return;

  if (opts.stage === "joined") {
    await db.appInvite.updateMany({
      where: { id: { in: invites.map((i) => i.id) } },
      data: { claimedAt: new Date(), claimedByConsenterId: opts.consenterId },
    });
  }
  const message =
    opts.stage === "joined"
      ? {
          title: `${opts.displayName} just joined Consent`,
          body: "The person you invited has claimed their identity. You'll be able to send requests once they're verified.",
        }
      : {
          title: `${opts.displayName} is now verified`,
          body: "The person you asked for is live. You can ask them for permission now.",
        };
  await Promise.all(
    [...new Set(invites.map((i) => i.invitedById))].map((userId) =>
      notifyUser({ userId, ...message, href: opts.stage === "verified" ? `/find?q=${encodeURIComponent(opts.displayName)}` : "/notifications" })
    )
  );
}
