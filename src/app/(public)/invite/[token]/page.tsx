import { notFound, redirect } from "next/navigation";
import { getSession, requireUser, setActiveProfile } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, PageHeader, Alert, ButtonLink } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { audit } from "@/lib/audit";
import { titleCase } from "@/lib/utils";
import { logoutAction } from "@/app/(auth)/actions";

export const metadata = { title: "Team invitation" };

// Public route (not under the app shell) so a signed-out invitee sees the
// invite and keeps it through sign-in or signup via ?next=.
export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const session = await getSession();
  const invite = await db.teamInvite.findUnique({ where: { token } });
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) notFound();

  const profileName =
    invite.profileKind === "consenter"
      ? (await db.consenterProfile.findUnique({ where: { id: invite.profileId } }))?.displayName
      : (await db.requesterProfile.findUnique({ where: { id: invite.profileId } }))?.displayName;
  if (!profileName) notFound();

  const back = encodeURIComponent(`/invite/${token}`);
  const emailMatches = !!session && invite.email.toLowerCase() === session.user.email.toLowerCase();

  async function acceptAction() {
    "use server";
    const s = await requireUser();
    const inv = await db.teamInvite.findUnique({ where: { token } });
    if (!inv || inv.acceptedAt || inv.expiresAt < new Date()) redirect("/dashboard");
    if (inv.email.toLowerCase() !== s.user.email.toLowerCase()) redirect("/dashboard");
    if (inv.profileKind === "consenter") {
      await db.consenterMember.upsert({
        where: { consenterId_userId: { consenterId: inv.profileId, userId: s.userId } },
        update: {},
        create: {
          consenterId: inv.profileId,
          userId: s.userId,
          role: inv.role,
          canApprove: inv.canApprove,
          canNegotiate: inv.canNegotiate,
          canEditRules: inv.canEditRules,
          canExport: inv.canExport,
          canManageTeam: inv.canManageTeam,
        },
      });
    } else {
      await db.requesterMember.upsert({
        where: { requesterId_userId: { requesterId: inv.profileId, userId: s.userId } },
        update: {},
        create: { requesterId: inv.profileId, userId: s.userId, role: inv.role },
      });
    }
    await db.teamInvite.update({ where: { token }, data: { acceptedAt: new Date() } });
    await audit({
      actorId: s.userId,
      actorName: s.user.name,
      action: "team_invite_accepted",
      module: "teams",
      targetId: inv.profileId,
      detail: { role: inv.role, kind: inv.profileKind },
    });
    // Land in the team just joined, not on a generic dashboard.
    if (inv.profileKind === "consenter") {
      await setActiveProfile({ kind: "consenter", id: inv.profileId });
      redirect("/c-panel");
    }
    await setActiveProfile({ kind: "requester", id: inv.profileId });
    redirect("/r-panel");
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <PageHeader kicker="Team invitation" title={profileName} />
      <Card strong className="space-y-4">
        <p className="text-sm text-ink-soft">
          You&apos;ve been invited to join <strong>{profileName}</strong> as{" "}
          <strong>{titleCase(invite.role)}</strong> ({invite.profileKind} team).
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
