import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, Field, Input, Textarea, Select, StatusBadge, Alert, KV, VerifiedBadge, SectionTitle, ButtonLink } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { ErrorNote, SuccessNote } from "@/components/error-note";
import { submitConsenterApplicationAction, mockOauthConnectAction, replyToConsenterReviewAction } from "../actions";
import { COUNTRIES } from "@/lib/countries";
import { fmtDateTime, titleCase } from "@/lib/utils";
import { Link2, CalendarClock, ArrowRight } from "lucide-react";

export const metadata = { title: "Consenter onboarding" };

const ENTITY_TYPES = ["PERSON", "TV_SHOW", "MOVIE", "WEB_SERIES", "BRAND", "FICTIONAL_CHARACTER", "BAND_GROUP", "SPORTS_TEAM", "OTHER"];

export default async function ConsenterOnboarding({ searchParams }: PageProps<"/onboarding/consenter">) {
  const sp = await searchParams;
  const session = await requireUser();
  const member = await db.consenterMember.findFirst({
    where: { userId: session.userId },
    include: {
      consenter: { include: { socialAccounts: true, meetings: { orderBy: { scheduledAt: "desc" } } } },
    },
  });

  if (member) {
    const c = member.consenter;
    const isOwner = member.role === "OWNER";
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <PageHeader kicker="Consenter onboarding" title={c.displayName} desc="Verification status" />
        <ErrorNote error={sp.error as string | undefined} />
        {sp.submitted && (
          <SuccessNote msg="Submitted. Our team will review your documents and schedule a mandatory verification meeting (video call or in person)." />
        )}
        {sp.replied && <SuccessNote msg="Sent. The verification team will look at your profile again." />}
        <Card className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Status</span>
            {c.status === "APPROVED" ? <VerifiedBadge /> : <StatusBadge status={c.status} />}
          </div>
          {c.status === "MORE_INFO_NEEDED" && c.adminNotes && (
            <Alert tone="warn"><strong>Message from the verification team:</strong> {c.adminNotes}</Alert>
          )}
          {c.status === "REJECTED" && (
            <Alert tone="warn">Verification was rejected.{c.adminNotes ? ` Reason: ${c.adminNotes}` : ""}</Alert>
          )}
          <KV k="Legal name" v={c.legalName} />
          <KV k="Entity type" v={titleCase(c.entityType)} />
          <KV k="Country" v={c.country} />
          {c.status === "APPROVED" && (
            <>
              <Alert>
                Your profile is live and searchable. Set up your consent matrix and standing rules in
                the consenter panel.
              </Alert>
              <ButtonLink href="/c-panel/matrix">
                Set your terms <ArrowRight className="size-4" aria-hidden />
              </ButtonLink>
            </>
          )}
        </Card>

        {c.meetings.length > 0 && (
          <Card className="space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <CalendarClock className="size-4" aria-hidden /> Verification meeting
            </h2>
            {c.meetings.map((m) => (
              <div key={m.id} className="glass-subtle space-y-1 px-4 py-3 text-sm">
                <div className="font-medium">{fmtDateTime(m.scheduledAt)} · {m.mode === "VIDEO" ? "Video call" : "In person"}</div>
                {m.link && (
                  <a href={m.link} className="text-ink underline underline-offset-4" target="_blank" rel="noreferrer">
                    Join meeting link
                  </a>
                )}
                {m.location && <div className="text-ink-soft">{m.location}</div>}
                {m.outcome && <div className="text-xs text-ink-faint">Outcome: {m.outcome}</div>}
              </div>
            ))}
          </Card>
        )}

        {c.socialAccounts.length > 0 && (
          <Card className="space-y-3">
            <h2 className="text-sm font-semibold">Official accounts</h2>
            {c.socialAccounts.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2 text-sm">
                <span>{s.platformName} — {s.handle}</span>
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

        {c.status === "MORE_INFO_NEEDED" && (
          <Card strong className="space-y-4">
            <SectionTitle
              title="Reply to the verification team"
              desc="Answer the verification team and add a new document if they asked for one. Your profile then goes back for review."
            />
            {isOwner ? (
              <form action={replyToConsenterReviewAction} className="space-y-4">
                <Field label="Your reply">
                  <Textarea name="reply" maxLength={2000} placeholder="Here is the trademark certificate you asked for." />
                </Field>
                <Field label="Upload a new document" hint="Optional. A PDF or an image.">
                  <Input
                    name="document"
                    type="file"
                    accept="image/*,.pdf"
                    className="file:mr-3 file:rounded-lg file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white"
                  />
                </Field>
                <SubmitButton className="w-full">Send to the verification team</SubmitButton>
              </form>
            ) : (
              <p className="text-sm text-ink-soft">Only the account owner can reply.</p>
            )}
          </Card>
        )}

        {c.status === "REJECTED" && (
          <Card className="space-y-3">
            <SectionTitle
              title="What you can do next"
              desc="If you think this is a mistake, or you have new documents, contact support."
            />
            <ButtonLink href="/contact" variant="secondary">Contact support</ButtonLink>
          </Card>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        kicker="Consenter onboarding"
        title="Set the terms for your identity"
        desc="You are verified manually — real documents, official account proof, a real meeting, one account per entity — so a yes is provably from you."
      />
      <ErrorNote error={sp.error as string | undefined} />
      <form action={submitConsenterApplicationAction} className="space-y-5">
        <Card className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-soft">Entity</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Entity type" required>
              <Select name="entityType" required defaultValue="PERSON">
                {ENTITY_TYPES.map((t) => (
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
            <Field label="Legal name" required hint="Person's legal name, or the registered IP/production name.">
              <Input name="legalName" required placeholder="Jane Carter / 'Nightwatch' (Series)" />
            </Field>
            <Field label="Public display name" required>
              <Input name="displayName" required placeholder="Jane Carter" />
            </Field>
          </div>
          <Field label="Aliases / also known as" hint="Comma separated. Helps requesters find you.">
            <Input name="aliases" placeholder="JC, janecarterofficial" />
          </Field>
          <Field label="Category" hint="e.g. actor, musician, TV drama, sports">
            <Input name="category" placeholder="actor" />
          </Field>
          <Field label="Short public bio">
            <Textarea name="bio" maxLength={2000} placeholder="Shown on your public profile." />
          </Field>
          <Field label="Profile photo">
            <Input name="photo" type="file" accept="image/*" className="file:mr-3 file:rounded-lg file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white" />
          </Field>
        </Card>

        <Card className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-soft">Legal documents</h2>
          <Field
            label="Document number"
            required
            hint="Government ID number (persons) or registration/trademark number (entities). Stored only as a salted hash for duplicate prevention."
          >
            <Input name="documentNumber" required placeholder="e.g. passport / trademark no." />
          </Field>
          <Field
            label="Proof document"
            required
            hint="Persons: government ID. Entities: IP registration, production agreement, trademark certificate or rights-holder authorisation letter."
          >
            <Input name="document" type="file" required accept="image/*,.pdf" className="file:mr-3 file:rounded-lg file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white" />
          </Field>
        </Card>

        <Card className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-soft">Official accounts</h2>
          <p className="text-xs text-ink-faint">Connect via OAuth after submitting, or they serve as manual proof.</p>
          {[0, 1, 2].map((i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-2">
              <Input name="socialPlatform" placeholder="Instagram" aria-label={`Account ${i + 1} platform`} />
              <Input name="socialHandle" placeholder="@janecarter" aria-label={`Account ${i + 1} handle`} />
            </div>
          ))}
        </Card>

        <Card className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-soft">Contact details you share</h2>
          <p className="text-xs text-ink-faint">
            Nothing is shared automatically. When you approve a request, or any time after, you tick
            which of these the requester sees. The ones you tick here start ticked. Any usage fee is
            settled directly between you; Consent never processes it.
          </p>
          <div className="space-y-2">
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" name="shareEmail" defaultChecked className="size-4 accent-black" /> Share email
            </label>
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" name="sharePhone" className="size-4 accent-black" /> Share phone
            </label>
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" name="shareAddress" className="size-4 accent-black" /> Share address
            </label>
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" name="shareManager" className="size-4 accent-black" /> Share manager contact
            </label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Contact email" hint="Defaults to your login email.">
              <Input name="contactEmail" type="email" placeholder="mgmt@janecarter.com" />
            </Field>
            <Field label="Contact phone">
              <Input name="contactPhone" type="tel" placeholder="+1 555 010 2030" />
            </Field>
          </div>
          <Field label="Contact address" hint="Optional. A postal or office address, e.g. for in-person meetings or paperwork.">
            <Input name="contactAddress" maxLength={300} autoComplete="street-address" placeholder="Street, city, postcode, country" />
          </Field>
          <Field label="Manager / agency contact">
            <Input name="managerContact" placeholder="Alex Rivers — alex@agency.com" />
          </Field>
        </Card>

        <SubmitButton className="w-full">Submit for verification</SubmitButton>
      </form>
    </div>
  );
}
