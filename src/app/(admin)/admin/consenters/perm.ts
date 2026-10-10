/* Who may work the ID-check queue. "consenters" is the one ID-check module
   (labelled "Profiles"). Roles saved before every account became the same
   may still carry the retired "requesters" key, and it still counts. */

import { redirect } from "next/navigation";
import { requireAdmin, hasAdminPerm } from "@/lib/auth";

/** The admin module key for ID checks (shown as "Profiles"). */
export const ID_CHECK_MODULE = "consenters";
const RETIRED_MODULE = "requesters";

/** The role has this permission on ID checks (under the current or the retired key). */
export function hasIdCheckPerm(role: { isSuperAdmin: boolean; permissions: unknown } | null | undefined, perm: string) {
  return hasAdminPerm(role, ID_CHECK_MODULE, perm) || hasAdminPerm(role, RETIRED_MODULE, perm);
}

/** Like requireAdmin(module, perm), for ID checks: without the permission, back to the overview. */
export async function requireIdCheck(perm: string) {
  const session = await requireAdmin();
  if (!hasIdCheckPerm(session.user.adminRole, perm)) redirect("/admin?denied=1");
  return session;
}
