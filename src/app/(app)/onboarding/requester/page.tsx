import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, Field, Input, Textarea, Select, StatusBadge, Alert, KV, SectionTitle, ButtonLink } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { ErrorNote, SuccessNote } from "@/components/error-note";
import {
  submitRequesterApplicationAction,
  payOnboardingAction,
  mockOauthConnectAction,
  replyToRequesterReviewAction,
} from "../actions";
import { COUNTRIES } from "@/lib/countries";
import { priceFor } from "@/lib/payments";
import { fmtMoney, titleCase } from "@/lib/utils";
import { Link2, ArrowRight } from "lucide-react";

export const metadata = { title: "Requester application" };

const TYPES = ["INDIVIDUAL_CREATOR", "NEWS_CHANNEL", "PODCAST", "MEME_PAGE", "MEDIA_HOUSE", "AGENCY", "OTHER"];

const FILE_INPUT =
  "file:mr-3 file:rounded-lg file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white";

type Channel = { platform: string; url: string; followers: number };

export default async function RequesterOnboarding({ searchParams }: PageProps<"/onboarding/requester">) {
  const sp = await searchParams;
  const session = await requireUser();
  const member = await db.requesterMember.findFirst({
    where: { userId: session.userId },
    include: { requester: { include: { socialAccounts: true } } },
  });

  // After a rejection the owner can open the form again, filled in with what they sent before.
  const reapplying = !!sp.new && member?.role === "OWNER" && member.requester.status === "REJECTED";

  // Existing application → status view
  if (member && !reapplying) {
    const r = member.requester;
    const isOwner = member.role === "OWNER";
    const price = await priceFor(r.country);
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <PageHeader kicker="Requester onboarding" title={r.displayName} desc="Application status" />
        <ErrorNote error={sp.error as string | undefined} />
        {sp.submitted && <SuccessNote msg="Application submitted. Our verification team will review it shortly." />}
        {sp.replied && <SuccessNote msg="Sent. The review team will look at your application again." />}
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
            <h2 className="text-lg font-semibold">
              {member.role === "VIEWER" ? "Approved — waiting for activation" : <>You&apos;re approved — activate your account</>}
            </h2>
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
            {/* Viewer seats are read-only, so they can't pay. */}
            {member.role === "VIEWER" ? (
              <p className="text-sm text-ink-soft">Viewers can&apos;t pay. Ask the account owner to activate the account.</p>
            ) : (
              <form action={payOnboardingAction} className="flex flex-wrap items-end gap-2">
                <div className="w-44">
                  <Field label="Coupon code" hint="Optional.">
                    <Input name="coupon" placeholder="CODE" className="uppercase" />
                  </Field>
                </div>
                <SubmitButton>Pay and activate</SubmitButton>
              </form>
            )}
          </Card>
        )}
        {r.status === "APPROVED" && r.onboardingFeePaidAt && (
          <Card className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">Your requester account is active.</p>
            <ButtonLink href="/r-panel">
              Open requester panel <ArrowRight className="size-4" aria-hidden />
            </ButtonLink>
          </Card>
        )}

        {r.status === "MORE_INFO_NEEDED" && (
          <Card strong className="space-y-4">
            <SectionTitle
              title="Reply to the review team"
              desc="Answer the review team and add a new document if they asked for one. Your application then goes back for review."
            />
            {isOwner ? (
              <form action={replyToRequesterReviewAction} className="space-y-4">
                <Field label="Your reply">
                  <Textarea name="reply" maxLength={2000} placeholder="Here is the clearer registration document you asked for." />
                </Field>
                <Field label="Upload a new document" hint="Optional. A PDF or an image.">
                  <Input name="document" type="file" accept="image/*,.pdf" className={FILE_INPUT} />
                </Field>
                <SubmitButton className="w-full">Send to the review team</SubmitButton>
              </form>
            ) : (
              <p className="text-sm text-ink-soft">Only the account owner can reply.</p>
            )}
          </Card>
        )}

        {r.status === "REJECTED" && (
          <Card className="space-y-3">
            <SectionTitle
              title="What you can do next"
              desc={
                isOwner
                  ? "Fix what the review team pointed out and apply again, or contact support if you think this is a mistake."
                  : "Contact support if you think this is a mistake."
              }
            />
            <div className="flex flex-wrap gap-2">
              <ButtonLink href="/contact" variant="secondary">Contact support</ButtonLink>
              {isOwner && <ButtonLink href="/onboarding/requester?new=1">Apply again</ButtonLink>}
            </div>
          </Card>
        )}
      </div>
    );
  }

  // Applying again after a rejection: start from what was sent before.
  const prev = member && reapplying ? member.requester : null;
  const prevChannels = (prev?.channels ?? []) as Channel[];

  // New application form
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        kicker="Requester onboarding"
        title={prev ? "Apply again" : "Create with permission"}
        desc={
          prev
            ? "Fix what the review team pointed out, add your document again and send it."
            : "Tell us who you are. Applications are reviewed manually, and you pay only after approval."
        }
      />
      <ErrorNote error={sp.error as string | undefined} />
      {prev?.adminNotes && (
        <Alert tone="warn">
          <strong>Why it was turned down:</strong> {prev.adminNotes}
        </Alert>
      )}
      <form action={submitRequesterApplicationAction} className="space-y-5">
        <Card className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-soft">Identity</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Legal / organisation name" required>
              <Input name="legalName" required minLength={2} placeholder="Acme Media Pvt Ltd" defaultValue={prev?.legalName} />
            </Field>
            <Field label="Public display name" required>
              <Input name="displayName" required minLength={2} placeholder="Acme Clips" defaultValue={prev?.displayName} />
            </Field>
            <Field label="Type" required>
              <Select name="type" required defaultValue={prev?.type ?? "INDIVIDUAL_CREATOR"}>
                {TYPES.map((t) => (
                  <option key={t} value={t}>{titleCase(t)}</option>
                ))}
              </Select>
            </Field>
            <Field label="Country" required>
              <Select name="country" required defaultValue={prev?.country ?? "US"}>
                {COUNTRIES.map(([code, name]) => (
                  <option key={code} value={code}>{name}</option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Content categories" hint="Comma separated, e.g. news, comedy, gaming">
            <Input name="categories" placeholder="news, commentary" defaultValue={prev?.categories.join(", ")} />
          </Field>
          <Field label="What do you make?" required hint="A short description of your content (min 20 characters).">
            <Textarea
              name="description"
              required
              minLength={20}
              placeholder="We run a daily news commentary channel covering…"
              defaultValue={prev?.description ?? undefined}
            />
          </Field>
          <Field label="Authorised signatory" hint="For organisations: who signs agreements.">
            <Input name="signatoryName" placeholder="Jane Doe, Director" defaultValue={prev?.signatoryName ?? undefined} />
          </Field>
        </Card>

        <Card className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-soft">Your channels</h2>
          <p className="text-xs text-ink-faint">
            At least one. Paste the full link to each channel, like https://youtube.com/@yourchannel. Owners
            tap these to see who&apos;s asking. You can prove ownership via OAuth after submitting.
          </p>
          {[0, 1, 2].map((i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[1fr_2fr_90px]">
              <Input name="channelPlatform" placeholder="YouTube" aria-label={`Channel ${i + 1} platform`} defaultValue={prevChannels[i]?.platform} />
              <Input name="channelUrl" placeholder="https://youtube.com/@acme" aria-label={`Channel ${i + 1} link`} defaultValue={prevChannels[i]?.url} />
              <Input
                name="channelFollowers"
                type="number"
                min={0}
                placeholder="Followers"
                aria-label={`Channel ${i + 1} followers`}
                defaultValue={prevChannels[i]?.followers}
              />
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
            <Input name="document" type="file" required accept="image/*,.pdf" className={FILE_INPUT} />
          </Field>
        </Card>

        <SubmitButton className="w-full">Submit application</SubmitButton>
      </form>
    </div>
  );
}
