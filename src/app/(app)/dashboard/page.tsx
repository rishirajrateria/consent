import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { profilesOf } from "@/lib/profiles";
import { Card, PageHeader, ButtonLink } from "@/components/ui";
import { openTeamInvites } from "./invites";
import { ShieldCheck, ArrowRight, Users } from "lucide-react";

export const metadata = { title: "Home" };

/**
 * Home for someone without a profile yet: one way forward, the ID check.
 * Anyone with a profile goes to its Home.
 */
export default async function DashboardPage() {
  const session = await requireUser();
  const profiles = await profilesOf(session.userId);
  if (profiles.length > 0) redirect("/c-panel");

  // Someone invited to a team can join it without a profile of their own.
  const invites = await openTeamInvites(session.user, []);

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Welcome"
        title={`Hello, ${session.user.name.split(" ")[0]}`}
        desc="Get verified once. Then you can ask people for permission, and people can ask you."
      />

      {invites.map((inv) => (
        <Card key={inv.token} strong className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <Users className="mt-0.5 size-5 shrink-0 text-ink" strokeWidth={1.5} aria-hidden />
            <div className="min-w-0">
              <h2 className="font-semibold">You&apos;ve been invited to join {inv.profileName}</h2>
              <p className="text-sm text-ink-soft">Open the invitation to see your role and accept it.</p>
            </div>
          </div>
          <ButtonLink href={`/invite/${inv.token}`}>
            Open invitation <ArrowRight className="size-4" aria-hidden />
          </ButtonLink>
        </Card>
      ))}

      <Card className="max-w-xl space-y-3">
        <ShieldCheck className="size-6 text-ink" strokeWidth={1.5} aria-hidden />
        <h2 className="text-lg font-semibold">Get verified</h2>
        <p className="text-sm text-ink-soft">
          One ID check, the same for everyone. Once it&apos;s approved you can ask anyone for
          permission, set your own terms, and people can ask you.
        </p>
        <ButtonLink href="/onboarding">
          Get verified <ArrowRight className="size-4" aria-hidden />
        </ButtonLink>
      </Card>
    </div>
  );
}
