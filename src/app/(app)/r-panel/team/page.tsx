import { requireRequester } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, Field, Input, Select, SectionTitle } from "@/components/ui";
import { SubmitButton, ConfirmSubmit } from "@/components/form";
import { ErrorNote, SuccessNote } from "@/components/error-note";
import { inviteRequesterMemberAction, removeRequesterMemberAction } from "@/app/(app)/c-panel/team/actions";
import { titleCase, fmtDate } from "@/lib/utils";

export const metadata = { title: "Team" };

export default async function RequesterTeamPage({ searchParams }: PageProps<"/r-panel/team">) {
  const sp = await searchParams;
  const { requester, member } = await requireRequester();
  const [members, invites] = await Promise.all([
    db.requesterMember.findMany({
      where: { requesterId: requester.id },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    }),
    db.teamInvite.findMany({
      where: { profileKind: "requester", profileId: requester.id, acceptedAt: null, expiresAt: { gt: new Date() } },
    }),
  ]);
  const isOwner = member.role === "OWNER";

  return (
    <div className="space-y-6">
      <PageHeader kicker={requester.displayName} title="Team seats" desc="Owner, editors and viewers." />
      <ErrorNote error={sp.error as string | undefined} />
      {sp.invited && <SuccessNote msg="Invite sent by email." />}
      {sp.removed && <SuccessNote msg="Member removed." />}

      <Card className="space-y-3">
        <SectionTitle title="Members" />
        {members.map((m) => (
          <div key={m.id} className="flex items-center gap-3 border-t hairline py-3 first:border-t-0">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{m.user.name}</div>
              <div className="text-xs text-ink-faint">{m.user.email} · joined {fmtDate(m.createdAt)}</div>
            </div>
            <span className="rounded-full bg-ink px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
              {titleCase(m.role)}
            </span>
            {isOwner && m.role !== "OWNER" && (
              <form action={removeRequesterMemberAction}>
                <input type="hidden" name="memberId" value={m.id} />
                <ConfirmSubmit confirm={`Remove ${m.user.name}?`} size="sm">Remove</ConfirmSubmit>
              </form>
            )}
          </div>
        ))}
        {invites.length > 0 && (
          <div className="border-t hairline pt-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Pending invites</div>
            {invites.map((i) => (
              <div key={i.id} className="mt-1 text-sm text-ink-soft">
                {i.email} — {titleCase(i.role)} (expires {fmtDate(i.expiresAt)})
              </div>
            ))}
          </div>
        )}
      </Card>

      {isOwner && (
        <Card className="space-y-4">
          <SectionTitle title="Invite a member" />
          <form action={inviteRequesterMemberAction} className="flex flex-wrap items-end gap-3">
            <Field label="Email" required>
              <Input name="email" type="email" required placeholder="editor@acme.com" />
            </Field>
            <Field label="Role" required>
              <Select name="role" defaultValue="EDITOR">
                <option value="EDITOR">Editor</option>
                <option value="VIEWER">Viewer</option>
              </Select>
            </Field>
            <SubmitButton variant="secondary">Send invite</SubmitButton>
          </form>
        </Card>
      )}
    </div>
  );
}
