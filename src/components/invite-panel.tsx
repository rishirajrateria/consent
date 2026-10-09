import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { normalizeLegalName } from "@/lib/utils";
import { Card, SectionTitle, Field, Input, ButtonLink } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { sendAppInviteAction } from "@/app/(app)/invites/actions";
import { UserPlus, Users } from "lucide-react";

/**
 * "Not here yet? Summon them." — shown under directory / new-request search.
 * Records demand per name and (optionally) emails the person an invite.
 */
export async function InvitePanel({ query, returnTo }: { query: string; returnTo: string }) {
  const session = await getSession();
  const normalized = query ? normalizeLegalName(query) : "";
  const demand = normalized
    ? await db.appInvite.count({ where: { normalizedName: normalized, claimedAt: null } })
    : 0;

  return (
    <Card className="space-y-4" id="invite">
      <SectionTitle
        title={query ? `${query} isn't on Consent yet` : "Someone missing?"}
        desc="Invite them to claim their identity. Every invite counts — they'll see how many people are waiting to ask them properly."
      />
      {demand > 0 && (
        <div className="glass-subtle flex items-center gap-2 px-4 py-2.5 text-sm">
          <Users className="size-4 shrink-0" aria-hidden />
          <span>
            <strong>{demand}</strong> {demand === 1 ? "person is" : "people are"} already waiting for{" "}
            <strong>{query}</strong> to join.
          </span>
        </div>
      )}
      {session ? (
        <form action={sendAppInviteAction} className="space-y-3">
          <input type="hidden" name="returnTo" value={returnTo} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Who are you looking for?" required>
              <Input name="targetName" required minLength={2} defaultValue={query} placeholder="Name of the person, show or brand" />
            </Field>
            <Field label="Their email" hint="If you have it, they get the invitation directly. Otherwise we just record the demand.">
              <Input name="email" type="email" placeholder="optional" />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Their handle" hint="Helps us recognise them when they arrive.">
              <Input name="handle" placeholder="@handle (optional)" />
            </Field>
            <Field label="Note to them">
              <Input name="note" maxLength={500} placeholder="What do you want to ask them? (optional)" />
            </Field>
          </div>
          <SubmitButton variant="secondary">
            <UserPlus className="size-4" aria-hidden /> Send Consent invite
          </SubmitButton>
          <p className="text-xs text-ink-faint">
            You&apos;ll be notified when they join and again when they&apos;re verified.
          </p>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <ButtonLink href="/signup" variant="secondary">
            <UserPlus className="size-4" aria-hidden /> Sign in to invite them
          </ButtonLink>
          <span className="text-xs text-ink-faint">Takes a minute. Inviting is free.</span>
        </div>
      )}
    </Card>
  );
}
