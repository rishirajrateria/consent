import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser, parseProfileContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { profilesOf } from "@/lib/profiles";
import { getSettings } from "@/lib/settings";
import { membershipOk } from "@/lib/membership";
import { activeCurrencies } from "@/lib/currencies";
import { PageHeader, Card, Field, Input, Textarea, StatusBadge, Alert, KV, VerifiedBadge, SectionTitle, ButtonLink } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { ErrorNote, SuccessNote } from "@/components/error-note";
import { compactCount } from "@/lib/channels";
import { COUNTRIES } from "@/lib/countries";
import { fmtDateTime } from "@/lib/utils";
import { mockOauthConnectAction, replyToReviewAction } from "./actions";
import { ApplicationForm } from "./application-form";
import { EMPTY_VALUES, creatorLabel, entityLabel, type ApplicationValues } from "./application";
import { Link2, CalendarClock, ArrowRight, Plus } from "lucide-react";

export const metadata = { title: "Get verified" };

const FILE_INPUT =
  "file:mr-3 file:rounded-lg file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const countryName = (code: string) => COUNTRIES.find(([c]) => c === code)?.[1] ?? code;

/** A stored receive limit as the form's one choice: the first limit set, or Unlimited. */
function storedLimit(c: {
  dailyRequestLimit: number | null;
  weeklyRequestLimit: number | null;
  monthlyRequestLimit: number | null;
}): { limitKind: string; limitCount: string } {
  if (c.dailyRequestLimit != null) return { limitKind: "day", limitCount: String(c.dailyRequestLimit) };
  if (c.weeklyRequestLimit != null) return { limitKind: "week", limitCount: String(c.weeklyRequestLimit) };
  if (c.monthlyRequestLimit != null) return { limitKind: "month", limitCount: String(c.monthlyRequestLimit) };
  return { limitKind: "unlimited", limitCount: "" };
}

const STATUS_NOTE: Record<string, string> = {
  DRAFT: "Not sent yet.",
  SUBMITTED: "We're checking your ID. We'll tell you here and by email. We may ask for a short video call.",
  UNDER_REVIEW: "We're checking your ID. We'll tell you here and by email. We may ask for a short video call.",
  MORE_INFO_NEEDED: "The review team needs something more from you. Reply below.",
  APPROVED: "You're verified. Ask anyone for consent, and decide who can use yours.",
  REJECTED: "Your ID check wasn't approved.",
};

/**
 * The one ID check. Without a profile (or with ?new=1) it is the onboarding
 * form; afterwards it shows that profile's status. ?again=<id> sends a
 * rejected profile again; ?profile=<id> picks which of your profiles to show.
 */
export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  const sp = await searchParams;
  const session = await requireUser();
  // Email and phone are proven at sign-up; every account answers requests, so 2FA comes before the ID check.
  if (!session.user.phoneVerified) redirect("/verify-phone?next=%2Fonboarding");
  if (!session.user.totpEnabled) redirect("/settings/security?next=%2Fonboarding");

  const profiles = await profilesOf(session.userId);
  const owned = profiles.filter((m) => m.role === "OWNER");
  const again = owned.find((m) => m.consenterId === one(sp.again) && m.consenter.status === "REJECTED");

  // ── The form ──
  if (again || sp.new || owned.length === 0) {
    const adding = !again && owned.length > 0;
    const helping = owned.length === 0 ? profiles.map((m) => m.consenter.displayName) : [];
    const currencies = await activeCurrencies();
    let initial: ApplicationValues = EMPTY_VALUES;
    if (again) {
      const c = again.consenter;
      const channels = await db.socialAccount.findMany({ where: { consenterId: c.id }, orderBy: { createdAt: "asc" } });
      initial = {
        entityType: c.entityType,
        creatorType: c.asker?.type ?? "",
        country: c.country,
        legalName: c.legalName,
        displayName: c.displayName,
        aliases: c.aliases.join(", "),
        category: c.category ?? "",
        bio: c.bio ?? "",
        documentType: "",
        documentNumber: "",
        channels: channels.map((s) => ({ platform: s.platformName, url: s.url ?? "", followers: String(s.followers ?? "") })),
        // The fee and receive limit they chose last time.
        feeMode: c.consentPrice != null && Number(c.consentPrice.toString()) > 0 ? "paid" : "free",
        consentPrice: c.consentPrice != null && Number(c.consentPrice.toString()) > 0 ? c.consentPrice.toString() : "",
        consentPriceCurrency: c.consentPriceCurrency,
        ...storedLimit(c),
      };
    }
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <PageHeader
          kicker="ID check"
          title={again ? "Apply again" : adding ? "Add a brand or show profile" : "Get verified"}
          desc={
            again
              ? "Fix what the review team pointed out, add your photo and ID document again, and send it."
              : adding
                ? "Each profile has its own ID check, team and terms. Fill in everything about the brand, show or team you represent."
                : "One ID check for everyone. Once it's approved you can ask anyone for consent, and decide who can use yours. Every field is needed except “Also known as”."
          }
        />
        {again?.consenter.adminNotes && (
          <Alert tone="warn">
            <strong>Why it wasn&apos;t approved:</strong> {again.consenter.adminNotes}
          </Alert>
        )}
        {helping.length > 0 && (
          <Alert>
            You help run {helping.join(", ")}. This form is for a profile of your own.
          </Alert>
        )}
        <ApplicationForm initial={initial} reapplyId={again?.consenterId} currencies={currencies} />
      </div>
    );
  }

  // ── Status of one of your profiles ──
  const ctx = parseProfileContext(session.activeProfile);
  const pick =
    owned.find((m) => m.consenterId === one(sp.profile)) ??
    owned.find((m) => ctx?.kind === "consenter" && m.consenterId === ctx.id) ??
    [...owned].reverse().find((m) => m.consenter.status !== "APPROVED") ??
    owned[0];
  const c = pick.consenter;
  const [socials, meetings, settings] = await Promise.all([
    db.socialAccount.findMany({ where: { consenterId: c.id }, orderBy: { createdAt: "asc" } }),
    db.verificationMeeting.findMany({ where: { consenterId: c.id }, orderBy: { scheduledAt: "desc" } }),
    getSettings(),
  ]);
  const needsMembership =
    c.status === "APPROVED" && !!c.asker && !membershipOk(c.asker, settings.membershipFeeOn);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader kicker="ID check" title={c.displayName} desc={STATUS_NOTE[c.status]} />
      <ErrorNote error={sp.error} />
      {sp.submitted && (
        <SuccessNote msg="Sent for ID check. We'll tell you here and by email when it's done." />
      )}
      {sp.replied && <SuccessNote msg="Sent. The review team will look at your profile again." />}

      <Card className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">Status</span>
          {c.status === "APPROVED" ? <VerifiedBadge /> : <StatusBadge status={c.status} />}
        </div>
        {c.status === "MORE_INFO_NEEDED" && c.adminNotes && (
          <Alert tone="warn">
            <strong>Message from the review team:</strong> {c.adminNotes}
          </Alert>
        )}
        {c.status === "REJECTED" && c.adminNotes && (
          <Alert tone="warn">
            <strong>Reason:</strong> {c.adminNotes}
          </Alert>
        )}
        <KV k="Legal name" v={c.legalName} />
        <KV k="Kind of profile" v={entityLabel(c.entityType)} />
        {c.asker && <KV k="Creator type" v={creatorLabel(c.asker.type)} />}
        <KV k="Country" v={countryName(c.country)} />
        {c.category && <KV k="What you do" v={c.category} />}
      </Card>

      {c.status === "APPROVED" && (
        <Card className="space-y-3">
          {needsMembership ? (
            <>
              <p className="text-sm text-ink-soft">
                To send requests, pay the yearly membership. People can already ask you.
              </p>
              <div className="flex flex-wrap gap-2">
                <ButtonLink href="/c-panel/matrix" variant="secondary">Set your terms</ButtonLink>
                <ButtonLink href="/r-panel/billing">
                  Pay membership <ArrowRight className="size-4" aria-hidden />
                </ButtonLink>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-ink-soft">
                Your profile is live. Set your terms so people know what they can ask for.
              </p>
              <div className="flex flex-wrap gap-2">
                <ButtonLink href="/c-panel/matrix" variant="secondary">Set your terms</ButtonLink>
                <ButtonLink href="/c-panel">
                  Go to Home <ArrowRight className="size-4" aria-hidden />
                </ButtonLink>
              </div>
            </>
          )}
        </Card>
      )}

      {c.status === "MORE_INFO_NEEDED" && (
        <Card strong className="space-y-4">
          <SectionTitle
            title="Reply to the review team"
            desc="Answer their message and add a new document if they asked for one. Your profile then goes back for review."
          />
          <form action={replyToReviewAction} className="space-y-4">
            <input type="hidden" name="profileId" value={c.id} />
            <Field label="Your reply">
              <Textarea name="reply" maxLength={2000} placeholder="Here is the clearer ID you asked for." />
            </Field>
            <Field label="Upload a new document" hint="Optional. A PDF or an image.">
              <Input name="document" type="file" accept="image/*,.pdf" className={FILE_INPUT} />
            </Field>
            <SubmitButton className="w-full">Send to the review team</SubmitButton>
          </form>
        </Card>
      )}

      {c.status === "REJECTED" && (
        <Card className="space-y-3">
          <SectionTitle
            title="What you can do next"
            desc="Fix what the review team pointed out and apply again, or contact support if you think this is a mistake."
          />
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/contact" variant="secondary">Contact support</ButtonLink>
            <ButtonLink href={`/onboarding?again=${c.id}`}>Apply again</ButtonLink>
          </div>
        </Card>
      )}

      {meetings.length > 0 && (
        <Card className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <CalendarClock className="size-4" aria-hidden /> ID check call
          </h2>
          {meetings.map((m) => (
            <div key={m.id} className="glass-subtle space-y-1 px-4 py-3 text-sm">
              <div className="font-medium">
                {fmtDateTime(m.scheduledAt)} · {m.mode === "VIDEO" ? "Video call" : "In person"}
              </div>
              {m.link && (
                <a href={m.link} className="text-ink underline underline-offset-4" target="_blank" rel="noreferrer">
                  Join the call
                </a>
              )}
              {m.location && <div className="text-ink-soft">{m.location}</div>}
            </div>
          ))}
        </Card>
      )}

      {socials.length > 0 && (
        <Card className="space-y-3">
          <h2 className="text-sm font-semibold">Your channels</h2>
          {socials.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="min-w-0 break-all">
                {s.platformName} · {s.handle}
                {s.followers ? <span className="text-ink-faint"> · {compactCount(s.followers)} followers</span> : null}
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

      {owned.length > 1 && (
        <Card className="space-y-2">
          <h2 className="text-sm font-semibold">Your profiles</h2>
          {owned.map((m) => (
            <Link
              key={m.consenterId}
              href={`/onboarding?profile=${m.consenterId}`}
              aria-current={m.consenterId === c.id ? "page" : undefined}
              className="flex min-h-10 items-center justify-between gap-3 rounded-lg px-2 text-sm hover:bg-ink/5 aria-[current=page]:font-medium"
            >
              <span className="min-w-0 truncate">{m.consenter.displayName}</span>
              {m.consenter.status === "APPROVED" ? <VerifiedBadge /> : <StatusBadge status={m.consenter.status} />}
            </Link>
          ))}
        </Card>
      )}

      <Card className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-soft">Run a brand or a show? Give it its own profile.</p>
        <ButtonLink href="/onboarding?new=1" variant="secondary">
          <Plus className="size-4" aria-hidden /> Add a brand or show profile
        </ButtonLink>
      </Card>
    </div>
  );
}
