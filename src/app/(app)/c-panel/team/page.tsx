import { requireConsenter } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, Field, Input, SectionTitle } from "@/components/ui";
import { SubmitButton, ConfirmSubmit } from "@/components/form";
import { ErrorNote, SuccessNote } from "@/components/error-note";
import { cancelInviteAction, inviteMemberAction, removeMemberAction } from "./actions";
import { PERMS, ROLE_LABEL, canManageTeam, canSendAs, seatPerms } from "./roles";
import { fmtDate } from "@/lib/utils";

export const metadata = { title: "Team" };

const CHIP = "rounded-full border border-ink/15 px-2 py-0.5 text-[10px] text-ink-soft";

/** The one team page for a profile: the same people receive and send as it. */
export default async function TeamPage({ searchParams }: PageProps<"/c-panel/team">) {
  const sp = await searchParams;
  const { consenter, member } = await requireConsenter();
  const asker = await db.requesterProfile.findUnique({ where: { consenterId: consenter.id }, select: { id: true } });
  const [members, invites] = await Promise.all([
    db.consenterMember.findMany({
      where: { consenterId: consenter.id },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    }),
    db.teamInvite.findMany({
      where: {
        acceptedAt: null,
        expiresAt: { gt: new Date() },
        OR: [
          { profileKind: "consenter", profileId: consenter.id },
          // Invites sent from the old sending-only team page.
          ...(asker ? [{ profileKind: "requester", profileId: asker.id }] : []),
        ],
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  // Viewers never act, even if an old invite stored permissions for them.
  const canManage = canManageTeam(member);
  const own = seatPerms(member);
  const isOwner = member.role === "OWNER";

  return (
    <div className="space-y-6">
      <PageHeader
        kicker={consenter.displayName}
        title="Team"
        desc="People who help run this profile. Every action is logged with the name of the person who took it, and that name appears on certificates."
      />
      <ErrorNote error={sp.error} />
      {sp.invited && <SuccessNote msg="Invite sent by email." />}
      {sp.cancelled && <SuccessNote msg="Invite withdrawn." />}
      {sp.removed && <SuccessNote msg="Removed from the team." />}

      <Card className="space-y-3">
        <SectionTitle title="Members" />
        {members.map((m) => (
          <div key={m.id} className="flex flex-wrap items-center gap-3 border-t hairline py-3 first:border-t-0">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{m.user.name}</div>
              <div className="break-all text-xs text-ink-faint">
                {m.user.email} · joined {fmtDate(m.createdAt)}
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                <span className="rounded-full bg-ink px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                  {ROLE_LABEL[m.role]}
                </span>
                {m.role === "OWNER" ? (
                  <span className={CHIP}>Everything</span>
                ) : (
                  <>
                    {canSendAs(m.role) && <span className={CHIP}>Send requests</span>}
                    {PERMS.filter(([k]) => seatPerms(m)[k]).map(([k, label]) => (
                      <span key={k} className={CHIP}>
                        {label}
                      </span>
                    ))}
                  </>
                )}
              </div>
            </div>
            {canManage && m.role !== "OWNER" && m.id !== member.id && (
              <form action={removeMemberAction}>
                <input type="hidden" name="memberId" value={m.id} />
                <ConfirmSubmit confirm={`Remove ${m.user.name} from the team?`} size="sm">
                  Remove
                </ConfirmSubmit>
              </form>
            )}
          </div>
        ))}
        {invites.length > 0 && (
          <div className="space-y-1 border-t hairline pt-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Waiting to accept</div>
            {invites.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
                <span className="min-w-0 flex-1 break-all">
                  {i.email} · {ROLE_LABEL[i.role]} · expires {fmtDate(i.expiresAt)}
                </span>
                {canManage && (
                  <form action={cancelInviteAction}>
                    <input type="hidden" name="inviteId" value={i.id} />
                    <ConfirmSubmit confirm={`Withdraw the invite to ${i.email}?`} variant="ghost" size="sm">
                      Withdraw
                    </ConfirmSubmit>
                  </form>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {canManage && (
        <Card className="space-y-4">
          <SectionTitle
            title="Invite someone"
            desc="We email them a link. They sign in or create an account with that email, then accept. Everyone on Consent uses two-factor authentication."
          />
          <form action={inviteMemberAction} className="group space-y-4">
            <Field label="Email" required>
              <Input name="email" type="email" required autoComplete="off" placeholder="manager@agency.com" />
            </Field>
            <fieldset className="space-y-2">
              <legend className="text-xs font-medium uppercase tracking-wider text-ink-soft">
                Role<span className="ml-0.5 text-ink">*</span>
              </legend>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["MANAGER", "Manager"],
                    ["VIEWER", "Viewer"],
                  ] as const
                ).map(([value, label]) => (
                  <label
                    key={value}
                    className="relative inline-flex min-h-10 cursor-pointer items-center rounded-xl border border-ink/10 bg-white/60 px-3.5 py-2 text-sm font-medium text-ink-soft transition-all hover:bg-white hover:text-ink has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-white has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-ink/10"
                  >
                    <input type="radio" name="role" value={value} required defaultChecked={value === "MANAGER"} className="sr-only" />
                    {label}
                  </label>
                ))}
              </div>
              <p className="text-xs text-ink-faint">
                Managers can also send requests as {consenter.displayName}. Viewers can look, but can&apos;t act.
              </p>
            </fieldset>
            <fieldset className="space-y-2 group-has-[input[value=VIEWER]:checked]:hidden">
              <legend className="text-xs font-medium uppercase tracking-wider text-ink-soft">The manager can also</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {PERMS.map(([k, label]) =>
                  isOwner || own[k] ? (
                    <label key={k} className="flex min-h-10 items-center gap-2 text-sm">
                      <input type="checkbox" name={k} className="size-4 accent-black" /> {label}
                    </label>
                  ) : (
                    // A manager gives only what they have.
                    <label key={k} className="flex min-h-10 items-start gap-2 text-sm text-ink-faint">
                      <input type="checkbox" name={k} disabled className="mt-0.5 size-4 accent-black" />
                      <span>
                        {label}
                        <span className="block text-xs">Only the owner can give this.</span>
                      </span>
                    </label>
                  ),
                )}
              </div>
            </fieldset>
            <SubmitButton>Send invite</SubmitButton>
          </form>
        </Card>
      )}
    </div>
  );
}
