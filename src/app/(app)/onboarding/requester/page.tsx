import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, Field, Input, Textarea, Select, StatusBadge, Alert, KV } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { ErrorNote, SuccessNote } from "@/components/error-note";
import { submitRequesterApplicationAction, payOnboardingAction, mockOauthConnectAction } from "../actions";
import { COUNTRIES } from "@/lib/countries";
import { priceFor } from "@/lib/payments";
import { fmtMoney, titleCase } from "@/lib/utils";
import { Link2 } from "lucide-react";

export const metadata = { title: "Requester application" };

const TYPES = ["INDIVIDUAL_CREATOR", "NEWS_CHANNEL", "PODCAST", "MEME_PAGE", "MEDIA_HOUSE", "AGENCY", "OTHER"];

export default async function RequesterOnboarding({ searchParams }: PageProps<"/onboarding/requester">) {
  const sp = await searchParams;
  const session = await requireUser();
  const member = await db.requesterMember.findFirst({
    where: { userId: session.userId },
    include: { requester: { include: { socialAccounts: true } } },
  });

  // Existing application → status view
  if (member) {
    const r = member.requester;
    const price = await priceFor(r.country);
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <PageHeader kicker="Requester onboarding" title={r.displayName} desc="Application status" />
        {sp.submitted && <SuccessNote msg="Application submitted. Our verification team will review it shortly." />}
        <Card className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Status</span>
            <StatusBadge status={r.status} />
          </div>
          {r.status === "MORE_INFO_NEEDED" && r.adminNotes && (
            <Alert tone="warn">
              <strong>Message from the review team:</strong> {r.adminNotes}
            </Alert>
          )}
          {r.status === "REJECTED" && (
            <Alert tone="warn">Your application was rejected.{r.adminNotes ? ` Reason: ${r.adminNotes}` : ""}</Alert>
          )}
          <KV k="Legal name" v={r.legalName} />
          <KV k="Type" v={titleCase(r.type)} />
          <KV k="Country" v={r.country} />
        </Card>

        {r.socialAccounts.length > 0 && (
          <Card className="space-y-3">
            <h2 className="text-sm font-semibold">Social ownership proof</h2>
            {r.socialAccounts.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2 text-sm">
                <span>
                  {s.platformName} — {s.handle}
                </span>
                {s.verifiedAt ? (
                  <StatusBadge status="VERIFIED" />
                ) : (
                  <form action={mockOauthConnectAction}>
                    <input type="hidden" name="accountId" value={s.id} />
                    <SubmitButton variant="secondary" size="sm">
                      <Link2 className="size-3.5" aria-hidden /> Connect via OAuth
                    </SubmitButton>
                  </form>
                )}
              </div>
            ))}
          </Card>
        )}

        {r.status === "APPROVED" && !r.onboardingFeePaidAt && (
          <Card strong className="space-y-3">
            <h2 className="text-lg font-semibold">You&apos;re approved — activate your account</h2>
            <p className="text-sm text-ink-soft">
              Pay the one-time onboarding fee plus your first yearly subscription to start sending
              requests.
            </p>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold">
                {fmtMoney(Number(price.onboardingFee) + Number(price.yearlyFee), price.currency)}
              </span>
              <span className="text-xs text-ink-faint">
                = {fmtMoney(price.onboardingFee.toString(), price.currency)} onboarding +{" "}
                {fmtMoney(price.yearlyFee.toString(), price.currency)} / year
                {price.taxRate && Number(price.taxRate) > 0 ? ` (+ ${price.taxLabel} ${price.taxRate}%)` : ""}
              </span>
            </div>
            <form action={payOnboardingAction}>
              <SubmitButton>Pay and activate</SubmitButton>
            </form>
          </Card>
        )}
        {r.status === "APPROVED" && r.onboardingFeePaidAt && (
          <SuccessNote msg="Your requester account is active. Open the requester panel from the profile switcher." />
        )}
      </div>
    );
  }

  // New application form
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        kicker="Requester onboarding"
        title="Apply as a requester"
        desc="Tell us who you are. Applications are manually reviewed; you pay only after approval."
      />
      <ErrorNote error={sp.error as string | undefined} />
      <form action={submitRequesterApplicationAction} className="space-y-5">
        <Card className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-soft">Identity</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Legal / organisation name" required>
              <Input name="legalName" required minLength={2} placeholder="Acme Media Pvt Ltd" />
            </Field>
            <Field label="Public display name" required>
              <Input name="displayName" required minLength={2} placeholder="Acme Clips" />
            </Field>
            <Field label="Type" required>
              <Select name="type" required defaultValue="INDIVIDUAL_CREATOR">
                {TYPES.map((t) => (
                  <option key={t} value={t}>{titleCase(t)}</option>
                ))}
              </Select>
            </Field>
            <Field label="Country" required>
              <Select name="country" required defaultValue="US">
                {COUNTRIES.map(([code, name]) => (
                  <option key={code} value={code}>{name}</option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Content categories" hint="Comma separated, e.g. news, comedy, gaming">
            <Input name="categories" placeholder="news, commentary" />
          </Field>
          <Field label="What do you make?" required hint="A short description of your content (min 20 characters).">
            <Textarea name="description" required minLength={20} placeholder="We run a daily news commentary channel covering…" />
          </Field>
          <Field label="Authorised signatory" hint="For organisations: who signs agreements.">
            <Input name="signatoryName" placeholder="Jane Doe, Director" />
          </Field>
        </Card>

        <Card className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-soft">Channels & handles</h2>
          <p className="text-xs text-ink-faint">At least one. You can prove ownership via OAuth after submitting.</p>
          {[0, 1, 2].map((i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[1fr_2fr_90px]">
              <Input name="channelPlatform" placeholder="YouTube" aria-label={`Channel ${i + 1} platform`} />
              <Input name="channelUrl" placeholder="https://youtube.com/@acme" aria-label={`Channel ${i + 1} URL`} />
              <Input name="channelFollowers" type="number" min={0} placeholder="Followers" aria-label={`Channel ${i + 1} followers`} />
            </div>
          ))}
        </Card>

        <Card className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-soft">Verification documents</h2>
          <Field
            label="Government ID or business registration"
            required
            hint="Individuals: government ID. Organisations: registration documents. Stored privately, encrypted at rest."
          >
            <Input name="document" type="file" required accept="image/*,.pdf" className="file:mr-3 file:rounded-lg file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white" />
          </Field>
        </Card>

        <SubmitButton className="w-full">Submit application</SubmitButton>
      </form>
    </div>
  );
}
