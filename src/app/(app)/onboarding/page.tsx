import { PageHeader, Card, ButtonLink } from "@/components/ui";
import { ShieldCheck, Inbox, ArrowRight } from "lucide-react";

export const metadata = { title: "Add a profile" };

export default function OnboardingChooser() {
  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Onboarding"
        title="Add a profile"
        desc="One question first. Owners write the terms for their own identity. Requesters create with someone else's — with permission, in writing. Which are you today?"
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="space-y-3">
          <ShieldCheck className="size-6" strokeWidth={1.5} aria-hidden />
          <h2 className="text-lg font-semibold">Consenter</h2>
          <p className="text-sm text-ink-soft">
            A person, TV show, movie, brand, character, band or team that writes the terms for its
            own name, image, voice and story. Verified manually — real documents, a real meeting —
            and you never pay anything.
          </p>
          <ButtonLink href="/onboarding/consenter" variant="secondary">
            Start consenter onboarding <ArrowRight className="size-4" aria-hidden />
          </ButtonLink>
        </Card>
        <Card className="space-y-3">
          <Inbox className="size-6" strokeWidth={1.5} aria-hidden />
          <h2 className="text-lg font-semibold">Requester</h2>
          <p className="text-sm text-ink-soft">
            A creator, news channel, podcast, meme page, media house or agency that creates with
            someone else&apos;s identity — with permission, in writing. Approval-gated, then a
            one-time onboarding fee + yearly subscription.
          </p>
          <ButtonLink href="/onboarding/requester" variant="secondary">
            Start requester application <ArrowRight className="size-4" aria-hidden />
          </ButtonLink>
        </Card>
      </div>
    </div>
  );
}
