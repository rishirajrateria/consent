import Link from "next/link";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { normalizeLegalName } from "@/lib/utils";
import { searchConsenters } from "@/lib/search";
import { Card, SectionTitle, Field, Input, ButtonLink } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { sendAppInviteAction } from "@/app/(app)/invites/actions";
import { UserPlus, Users } from "lucide-react";

/**
 * "Not here yet? Summon them." — shown under directory / new-request search.
 * Records demand per name and (optionally) emails the person an invite.
 * When the search found profiles, the form folds away so opening a found
 * profile stays the obvious next step.
 */
export async function InvitePanel({
  query,
  returnTo,
  hasResults,
}: {
  query: string;
  returnTo: string;
  /** Did the search above show any profiles? Looked up when not passed. */
  hasResults?: boolean;
}) {
  const session = await getSession();
  const normalized = query ? normalizeLegalName(query) : "";
  const [demand, found] = await Promise.all([
    normalized ? db.appInvite.count({ where: { normalizedName: normalized, claimedAt: null } }) : 0,
    hasResults ?? (query ? searchConsenters(query, 1).then((r) => r.length > 0) : false),
  ]);
  const back = encodeURIComponent(returnTo);

  // Search found profiles: don't claim the person is missing, and keep the
  // invite folded so opening a found profile stays the obvious next step.
  const folded = !!query && found;

  const body = (
    <>
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
          <p className="text-xs text-ink-faint">
            You&apos;ll be notified when they join and again when they&apos;re verified.
          </p>
          <SubmitButton variant="secondary">
            <UserPlus className="size-4" aria-hidden /> Send Consent invite
          </SubmitButton>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-ink-faint">
            Inviting is free. New here?{" "}
            <Link href={`/signup?next=${back}`} className="underline underline-offset-4">Create an account</Link>
          </span>
          <ButtonLink href={`/login?next=${back}`} variant="secondary">
            <UserPlus className="size-4" aria-hidden /> Sign in to invite them
          </ButtonLink>
        </div>
      )}
    </>
  );

  return (
    <Card className="space-y-4" id="invite">
      <SectionTitle
        title={folded ? "Not who you meant?" : query ? `${query} isn't on Consent yet` : "Someone missing?"}
        desc={
          folded
            ? `If ${query} isn't one of the profiles above, invite them to claim their identity.`
            : "Invite them to claim their identity. Every invite counts — they'll see how many people are waiting to ask them properly."
        }
      />
      {folded ? (
        <details>
          <summary className="flex min-h-10 cursor-pointer items-center text-sm text-ink-soft hover:text-ink">
            Invite someone else
          </summary>
          <div className="mt-3 space-y-4">{body}</div>
        </details>
      ) : (
        body
      )}
    </Card>
  );
}
