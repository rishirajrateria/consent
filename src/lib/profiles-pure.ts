/* Pure mappings between a profile's two halves (see src/lib/profiles.ts).
   Safe to import anywhere, including tests and client components. */

import type { ConsenterEntityType, RequesterType, TeamRole } from "@prisma/client";

/** The sending half's type, from the profile's kind (used by standing rules). */
export function requesterTypeFor(entityType: ConsenterEntityType): RequesterType {
  switch (entityType) {
    case "PERSON":
    case "FICTIONAL_CHARACTER":
      return "INDIVIDUAL_CREATOR";
    case "TV_SHOW":
    case "MOVIE":
    case "WEB_SERIES":
    case "BAND_GROUP":
    case "SPORTS_TEAM":
      return "MEDIA_HOUSE";
    case "BRAND":
      return "AGENCY";
    default:
      return "OTHER";
  }
}

/** The profile's kind for an old sending-only profile that gets its receiving half. */
export function entityTypeFor(type: RequesterType): ConsenterEntityType {
  return type === "INDIVIDUAL_CREATOR" ? "PERSON" : "OTHER";
}

/**
 * A team role on the profile, as stored on the sending half. Managers can
 * send; viewers can only look. EDITOR exists only on the sending half.
 */
export function senderRole(role: TeamRole): TeamRole {
  if (role === "OWNER") return "OWNER";
  if (role === "VIEWER") return "VIEWER";
  return "EDITOR";
}

/** A sending-half role as a profile role (old sending-only teams). Never grants approval rights. */
export function profileRole(role: TeamRole): TeamRole {
  if (role === "OWNER") return "OWNER";
  if (role === "VIEWER") return "VIEWER";
  return "MANAGER";
}


/**
 * The one Consent Score shown for a profile. Each profile keeps two scores
 * underneath: how it answers requests (receiving half) and how it asks
 * (sending half; used by score gates and standing rules). People see one
 * number: the average of the two.
 */
export function profileScore(receiveScore: number, sendScore: number | null | undefined): number {
  return sendScore == null ? receiveScore : Math.round((receiveScore + sendScore) / 2);
}
