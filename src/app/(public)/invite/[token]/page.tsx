import { notFound, redirect } from "next/navigation";
import { getSession, requireUser, setActiveProfile } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureProfileFor, mirrorMember, profileRole } from "@/lib/profiles";
import { Card, PageHeader, Alert, ButtonLink } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { audit } from "@/lib/audit";
import { logoutAction } from "@/app/(auth)/actions";
import { ROLE_LABEL } from "@/app/(app)/c-panel/team/roles";

export const metadata = { title: "Team invitation" };

/** The profile an invite is for: old invites to a sending-only team resolve to its profile. */
async function inviteProfileId(invite: { profileKind: string; profileId: string }) {
  if (invite.profileKind !== "requester") return invite.profileId;
  const r = await db.requesterProfile.findUnique({ where: { id: invite.profileId }, select: { id: true } });
  return r ? ensureProfileFor(r.id) : null;
}

// Public route (not under the app shell) so a signed-out invitee sees the
// invite and keeps it through sign-in or signup via ?next=.
export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const session = await getSession();
  const invite = await db.teamInvite.findUnique({ where: { token } });
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) notFound();

  // Read-only here; an old sending-only team gets its profile when the invite is accepted.
  const profile =
    invite.profileKind === "requester"
      ? await db.requesterProfile.findUnique({ where: { id: invite.profileId }, select: { displayName: true } })
      : await db.consenterProfile.findUnique({ where: { id: invite.profileId }, select: { displayName: true } });
  if (!profile) notFound();
  const profileName = profile.displayName;
  // Old sending-only invites (Editor) join as managers without any extra permission.
  const role = invite.profileKind === "requester" ? profileRole(invite.role) : invite.role;

  const back = encodeURIComponent(`/invite/${token}`);
  const emailMatches = !!session && invite.email.toLowerCase() === session.user.email.toLowerCase();

  async function acceptAction() {
    "use server";
    const s = await requireUser();
    const inv = await db.teamInvite.findUnique({ where: { token } });
    if (!inv || inv.acceptedAt || inv.expiresAt < new Date()) redirect("/dashboard");
    if (inv.email.toLowerCase() !== s.user.email.toLowerCase()) redirect("/dashboard");
    const consenterId = await inviteProfileId(inv);
    if (!consenterId) redirect("/dashboard");
    const legacy = inv.profileKind === "requester";
    const joinAs = legacy ? profileRole(inv.role) : inv.role;
    // Both halves: the profile seat and its mirror on the sending half.
    await db.$transaction(async (tx) => {
      const seat = await tx.consenterMember.upsert({
        where: { consenterId_userId: { consenterId, userId: s.userId } },
        update: {},
        create: {
          consenterId,
          userId: s.userId,
          role: joinAs,
          ...(legacy || joinAs === "VIEWER"
            ? {}
            : {
                canApprove: inv.canApprove,
                canEditRules: inv.canEditRules,
                canExport: inv.canExport,
                canManageTeam: inv.canManageTeam,
              }),
        },
      });
      await mirrorMember(seat, tx);
      await tx.teamInvite.update({ where: { token }, data: { acceptedAt: new Date() } });
    });
    await audit({
      actorId: s.userId,
      actorName: s.user.name,
      action: "team_invite_accepted",
      module: "teams",
      targetId: consenterId,
      detail: { role: joinAs, kind: inv.profileKind },
    });
    // Land in the profile just joined.
    await setActiveProfile({ kind: "consenter", id: consenterId });
    if (!s.user.totpEnabled) redirect("/settings/security?next=%2Fc-panel");
    redirect("/c-panel");
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <PageHeader kicker="Team invitation" title={profileName} />
      <Card strong className="space-y-4">
        <p className="text-sm text-ink-soft">
          You&apos;re invited to help run <strong>{profileName}</strong> as <strong>{ROLE_LABEL[role]}</strong>.
          {role === "MANAGER" ? " Managers can also send requests as this profile." : ""}
        </p>
        {!session ? (
          <>
            <p className="text-sm text-ink-soft">
              Sign in with <strong className="text-ink">{invite.email}</strong> to accept. No account yet? Create one with that email.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <ButtonLink href={`/signup?next=${back}`} variant="secondary" className="w-full sm:flex-1">
                Create an account
              </ButtonLink>
              <ButtonLink href={`/login?next=${back}`} className="w-full sm:flex-1">Sign in to accept</ButtonLink>
            </div>
          </>
        ) : !emailMatches ? (
          <>
            <Alert tone="warn">
              This invite was sent to <strong>{invite.email}</strong>, but you are signed in as{" "}
              {session.user.email}. Sign in with the invited email to accept.
            </Alert>
            <form action={logoutAction}>
              <input type="hidden" name="next" value={`/invite/${token}`} />
              <SubmitButton variant="secondary" className="w-full">Sign out and switch account</SubmitButton>
            </form>
          </>
        ) : session.user.totpEnabled && !session.totpPassed ? (
          <ButtonLink href={`/2fa?next=${back}`} className="w-full">Finish signing in to accept</ButtonLink>
        ) : !session.user.emailVerified ? (
          <ButtonLink href={`/verify-email?next=${back}`} className="w-full">Verify your email to accept</ButtonLink>
        ) : (
          <form action={acceptAction}>
            <SubmitButton className="w-full">Accept invitation</SubmitButton>
          </form>
        )}
      </Card>
    </div>
  );
}
