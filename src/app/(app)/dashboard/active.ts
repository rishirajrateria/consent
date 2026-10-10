import { parseProfileContext } from "@/lib/auth";

type Seat = { consenterId: string; role: string; consenter: { asker: { id: string } | null } };

/**
 * The active profile among this person's profiles (from profilesOf), resolved
 * the way requireConsenter does: the one in the session if they still belong
 * to it (an old "requester:<id>" counts as its profile), else the first they
 * own, else their first. Null without a profile. Reads only; never switches.
 */
export function activeSeat<T extends Seat>(profiles: T[], activeProfile: string | null): T | null {
  const ctx = parseProfileContext(activeProfile);
  return (
    (ctx?.kind === "consenter" ? profiles.find((m) => m.consenterId === ctx.id) : undefined) ??
    (ctx?.kind === "requester" ? profiles.find((m) => m.consenter.asker?.id === ctx.id) : undefined) ??
    profiles.find((m) => m.role === "OWNER") ??
    profiles[0] ??
    null
  );
}
