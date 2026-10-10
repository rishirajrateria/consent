/* Team roles on a profile, and the invite form as the server reads it.
   Pure, so it can be unit-tested and shared with the page. */

import type { TeamRole } from "@prisma/client";

export const PERMS = [
  ["canApprove", "Approve or decline requests"],
  ["canEditRules", "Edit terms and rules"],
  ["canExport", "Export history"],
  ["canManageTeam", "Manage the team"],
] as const;

export type PermKey = (typeof PERMS)[number][0];

/** A permission's name as the team page shows it, for "Editing needs …" notes. */
export function permLabel(k: PermKey): string {
  return PERMS.find(([key]) => key === k)![1];
}
export type Perms = Record<PermKey, boolean>;

export const NO_PERMS: Perms = { canApprove: false, canEditRules: false, canExport: false, canManageTeam: false };

/** How a role reads on screen. EDITOR is the sending half's copy of a manager. */
export const ROLE_LABEL: Record<TeamRole, string> = {
  OWNER: "Owner",
  MANAGER: "Manager",
  EDITOR: "Manager",
  VIEWER: "Viewer",
};

/** Roles someone can be invited as. */
export const INVITE_ROLES = ["MANAGER", "VIEWER"] as const;

/** True when this seat can send requests as the profile. */
export function canSendAs(role: TeamRole): boolean {
  return role === "OWNER" || role === "MANAGER" || role === "EDITOR";
}

/**
 * What a seat can really do. Viewers never act, even if an old invite stored
 * permissions for them; the owner can do everything.
 */
export function seatPerms(m: { role: TeamRole } & Perms): Perms {
  if (m.role === "OWNER") return { canApprove: true, canEditRules: true, canExport: true, canManageTeam: true };
  if (m.role === "VIEWER") return { ...NO_PERMS };
  return Object.fromEntries(PERMS.map(([k]) => [k, m[k]])) as Perms;
}

/** True when this seat can invite and remove people. */
export function canManageTeam(m: { role: TeamRole } & Perms): boolean {
  return seatPerms(m).canManageTeam;
}

/**
 * Why this seat can't give these permissions, or null when it can. Only the
 * owner gives what they like; a manager gives only what they have.
 */
export function grantProblem(inviter: { role: TeamRole } & Perms, flags: Perms): string | null {
  const own = seatPerms(inviter);
  return PERMS.some(([k]) => flags[k] && !own[k]) ? "You can only give permissions you have." : null;
}

/**
 * The invite form: an email, a role and (for managers) what else they can
 * do. Viewers only look, so they never get a permission.
 */
export function readInvite(
  fd: FormData,
): { ok: true; invite: { to: string; role: (typeof INVITE_ROLES)[number]; flags: Perms } } | { ok: false; error: string } {
  const to = String(fd.get("email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || to.length > 254) return { ok: false, error: "Enter their email address." };
  const role = String(fd.get("role") ?? "");
  if (!(INVITE_ROLES as readonly string[]).includes(role)) return { ok: false, error: "Choose a role: Manager or Viewer." };
  const flags: Perms =
    role === "VIEWER"
      ? { ...NO_PERMS }
      : (Object.fromEntries(PERMS.map(([k]) => [k, fd.get(k) === "on"])) as Perms);
  return { ok: true, invite: { to, role: role as (typeof INVITE_ROLES)[number], flags } };
}
