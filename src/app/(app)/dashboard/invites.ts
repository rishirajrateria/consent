import "server-only";
import { db } from "@/lib/db";

/**
 * Open team invitations sent to this person's email, one per profile (the
 * newest), leaving out profiles they already belong to. Old invitations
 * name a profile's sending half; they count as that profile. Invitations to
 * a profile that no longer exists are left out.
 */
export async function openTeamInvites(user: { email: string }, joinedProfileIds: string[]) {
  const invites = await db.teamInvite.findMany({
    where: {
      email: { equals: user.email, mode: "insensitive" },
      acceptedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
    select: { token: true, profileKind: true, profileId: true },
  });
  if (invites.length === 0) return [];

  const ids = (kind: string) => invites.filter((i) => i.profileKind === kind).map((i) => i.profileId);
  const [profiles, askers] = await Promise.all([
    db.consenterProfile.findMany({ where: { id: { in: ids("consenter") } }, select: { id: true, displayName: true } }),
    db.requesterProfile.findMany({
      where: { id: { in: ids("requester") } },
      select: { id: true, displayName: true, consenterId: true },
    }),
  ]);
  const byKey = new Map<string, { profileId: string; name: string }>([
    ...profiles.map((c) => [`consenter:${c.id}`, { profileId: c.id, name: c.displayName }] as const),
    ...askers.map((r) => [`requester:${r.id}`, { profileId: r.consenterId ?? r.id, name: r.displayName }] as const),
  ]);

  // invites are newest first: a profile that re-invited the same email shows once.
  const seen = new Set(joinedProfileIds);
  return invites.flatMap((i) => {
    const profile = byKey.get(`${i.profileKind}:${i.profileId}`);
    if (!profile || seen.has(profile.profileId)) return [];
    seen.add(profile.profileId);
    return [{ token: i.token, profileId: profile.profileId, profileName: profile.name }];
  });
}
