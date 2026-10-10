import { requireConsenter } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, Field, Input, Select, SectionTitle } from "@/components/ui";
import { SubmitButton, ConfirmSubmit } from "@/components/form";
import { ErrorNote, SuccessNote } from "@/components/error-note";
import { inviteConsenterMemberAction, removeConsenterMemberAction } from "./actions";
import { titleCase, fmtDate } from "@/lib/utils";

export const metadata = { title: "Team" };

export default async function ConsenterTeamPage({ searchParams }: PageProps<"/c-panel/team">) {
  const sp = await searchParams;
  const { consenter, member } = await requireConsenter();
  const [members, invites] = await Promise.all([
    db.consenterMember.findMany({
      where: { consenterId: consenter.id },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    }),
    db.teamInvite.findMany({
      where: { profileKind: "consenter", profileId: consenter.id, acceptedAt: null, expiresAt: { gt: new Date() } },
    }),
  ]);
  const canManage = member.role === "OWNER" || member.canManageTeam;

  const PERMS = [
    ["canApprove", "Approve / deny requests"],
    ["canNegotiate", "Negotiate fees"],
    ["canEditRules", "Edit matrix & rules"],
    ["canExport", "Export history"],
    ["canManageTeam", "Manage team"],
  ] as const;

  return (
    <div className="space-y-6">
      <PageHeader
        kicker={consenter.displayName}
        title="Team access"
        desc="Managers, agency, PR and legal. Every action is logged with the individual who performed it, and that name appears on certificates."
      />
      <ErrorNote error={sp.error as string | undefined} />
      {sp.invited && <SuccessNote msg="Invite sent by email." />}
      {sp.removed && <SuccessNote msg="Member removed." />}

      <Card className="space-y-3">
        <SectionTitle title="Members" />
        {members.map((m) => (
          <div key={m.id} className="flex flex-wrap items-center gap-3 border-t hairline py-3 first:border-t-0">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{m.user.name}</div>
              <div className="text-xs text-ink-faint">{m.user.email} · joined {fmtDate(m.createdAt)}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                <span className="rounded-full bg-ink px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                  {titleCase(m.role)}
                </span>
                {PERMS.filter(([k]) => m[k]).map(([k, label]) => (
                  <span key={k} className="rounded-full border border-ink/15 px-2 py-0.5 text-[10px] text-ink-soft">
                    {label}
                  </span>
                ))}
              </div>
            </div>
            {canManage && m.role !== "OWNER" && (
              <form action={removeConsenterMemberAction}>
                <input type="hidden" name="memberId" value={m.id} />
                <ConfirmSubmit confirm={`Remove ${m.user.name} from the team?`} size="sm">Remove</ConfirmSubmit>
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

      {canManage && (
        <Card className="space-y-4">
          <SectionTitle title="Invite a member" desc="We email them a link. They sign in or create an account with this email, then accept. 2FA is mandatory for consenter teams." />
          <form action={inviteConsenterMemberAction} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Email" required>
                <Input name="email" type="email" required placeholder="legal@agency.com" />
              </Field>
              <Field label="Role" required>
                <Select name="role" defaultValue="MANAGER">
                  <option value="MANAGER">Manager</option>
                  <option value="LEGAL">Legal</option>
                  <option value="VIEWER">Viewer</option>
                </Select>
              </Field>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {PERMS.map(([k, label]) => (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name={k} className="size-4 accent-black" /> {label}
                </label>
              ))}
            </div>
            <SubmitButton variant="secondary">Send invite</SubmitButton>
          </form>
        </Card>
      )}
    </div>
  );
}
