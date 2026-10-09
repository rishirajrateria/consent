import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { PageHeader, Card, StatusBadge, KV, Field, Textarea, Input, Select, SectionTitle, Alert } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { ErrorNote, SuccessNote } from "@/components/error-note";
import {
  decideConsenterAction,
  clearDuplicateFlagAction,
  scheduleMeetingAction,
  recordMeetingOutcomeAction,
} from "../actions";
import { fmtDateTime, titleCase, fmtBytes } from "@/lib/utils";
import { FileText } from "lucide-react";

export const metadata = { title: "Verify consenter" };

export default async function ConsenterDetail({ params, searchParams }: PageProps<"/admin/consenters/[id]">) {
  await requireAdmin("consenters", "view");
  const { id } = await params;
  const sp = await searchParams;
  const c = await db.consenterProfile.findUnique({
    where: { id },
    include: {
      members: { include: { user: true } },
      documents: true,
      socialAccounts: true,
      meetings: { orderBy: { scheduledAt: "desc" }, include: { officer: true } },
    },
  });
  if (!c) notFound();

  // duplicate matches for context
  const dupMatches = c.duplicateFlag
    ? await db.consenterProfile.findMany({
        where: {
          id: { not: c.id },
          OR: [
            { normalizedLegalName: c.normalizedLegalName },
            ...(c.documentNumberHash ? [{ documentNumberHash: c.documentNumberHash }] : []),
          ],
        },
        select: { id: true, displayName: true, legalName: true, status: true },
      })
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Consenter verification"
        title={c.displayName}
        desc={`${titleCase(c.entityType)} · ${c.country}`}
        action={<StatusBadge status={c.status} />}
      />
      {sp.done && <SuccessNote msg="Saved." />}
      <ErrorNote error={sp.error as string | undefined} />

      {c.duplicateFlag && (
        <Card className="space-y-3 border-ink/25">
          <Alert tone="warn">
            <strong>Possible duplicate — one entity = one account.</strong> This application collides
            with an existing profile by legal name, document number or social handle. Verify is
            blocked until the flag is cleared with a reason.
          </Alert>
          {dupMatches.map((d) => (
            <div key={d.id} className="flex items-center justify-between text-sm">
              <span>{d.displayName} — {d.legalName}</span>
              <StatusBadge status={d.status} />
            </div>
          ))}
          <form action={clearDuplicateFlagAction} className="flex items-end gap-2">
            <input type="hidden" name="id" value={c.id} />
            <Field label="Reason to clear" required>
              <Input name="reason" required placeholder="e.g. different person, name collision confirmed via documents" />
            </Field>
            <SubmitButton variant="secondary">Clear flag</SubmitButton>
          </form>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-1">
          <SectionTitle title="Entity" />
          <KV k="Legal name" v={c.legalName} />
          <KV k="Aliases" v={c.aliases.join(", ") || "—"} />
          <KV k="Category" v={c.category ?? "—"} />
          <KV k="Bio" v={c.bio ?? "—"} />
          <KV k="Applied" v={fmtDateTime(c.createdAt)} />
          <KV
            k="Owner"
            v={c.members.map((m) => `${m.user.name} (${m.user.email}) — ${titleCase(m.role)}`).join("; ")}
          />
          <KV k="Doc number hash" v={c.documentNumberHash?.slice(0, 16) + "…"} mono />
        </Card>

        <Card className="space-y-3">
          <SectionTitle title="Documents" desc="Private; links expire in 10 minutes." />
          {c.documents.map((d) => (
            <a
              key={d.id}
              href={storage.signedUrl(d.storageKey, d.name, 600)}
              target="_blank"
              rel="noreferrer"
              className="glass-subtle flex items-center gap-2 px-4 py-3 text-sm hover:border-ink/20"
            >
              <FileText className="size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{d.name}</span>
              <span className="text-xs text-ink-faint">{fmtBytes(d.size)}</span>
            </a>
          ))}
          <SectionTitle title="Official accounts" />
          {c.socialAccounts.length === 0 && <p className="text-sm text-ink-faint">None listed.</p>}
          {c.socialAccounts.map((s) => (
            <div key={s.id} className="flex items-center justify-between text-sm">
              <span>{s.platformName} — {s.handle}</span>
              <StatusBadge status={s.verifiedAt ? "VERIFIED" : "PENDING"} />
            </div>
          ))}
        </Card>

        <Card className="space-y-4">
          <SectionTitle title="Verification meeting" desc="Mandatory before marking verified." />
          {c.meetings.map((m) => (
            <div key={m.id} className="glass-subtle space-y-2 px-4 py-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">{fmtDateTime(m.scheduledAt)} · {m.mode === "VIDEO" ? "Video" : "In person"}</span>
                {m.outcome ? <StatusBadge status={m.outcome === "passed" ? "APPROVED" : "REJECTED"} /> : <StatusBadge status="PENDING" />}
              </div>
              {m.link && <div className="truncate text-ink-soft">{m.link}</div>}
              {m.location && <div className="text-ink-soft">{m.location}</div>}
              {m.officer && <div className="text-xs text-ink-faint">Officer: {m.officer.name}</div>}
              {m.notes && <div className="text-xs text-ink-soft">{m.notes}</div>}
              {!m.outcome && (
                <form action={recordMeetingOutcomeAction} className="space-y-2 border-t hairline pt-2">
                  <input type="hidden" name="meetingId" value={m.id} />
                  <Textarea name="notes" placeholder="Meeting notes…" className="min-h-16" />
                  <div className="flex gap-2">
                    <SubmitButton name="outcome" value="passed" size="sm" variant="secondary">Passed</SubmitButton>
                    <SubmitButton name="outcome" value="failed" size="sm" variant="danger">Failed</SubmitButton>
                  </div>
                </form>
              )}
            </div>
          ))}
          <form action={scheduleMeetingAction} className="space-y-3 border-t hairline pt-3">
            <input type="hidden" name="id" value={c.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Date & time" required>
                <Input name="scheduledAt" type="datetime-local" required />
              </Field>
              <Field label="Mode" required>
                <Select name="mode" defaultValue="VIDEO">
                  <option value="VIDEO">Video call</option>
                  <option value="IN_PERSON">In person</option>
                </Select>
              </Field>
            </div>
            <Field label="Meeting link" hint="Google Meet / Zoom URL for video calls.">
              <Input name="link" type="url" placeholder="https://meet.google.com/…" />
            </Field>
            <Field label="Location" hint="For in-person meetings.">
              <Input name="location" placeholder="Office address" />
            </Field>
            <SubmitButton variant="secondary">Schedule meeting</SubmitButton>
          </form>
        </Card>

        <Card className="space-y-4">
          <SectionTitle title="Decision" desc="Only verified profiles become searchable and can receive requests." />
          <form action={decideConsenterAction} className="space-y-3">
            <input type="hidden" name="id" value={c.id} />
            <Field label="Message / notes">
              <Textarea name="note" placeholder="Notes to the applicant or internal reason." />
            </Field>
            <div className="flex flex-wrap gap-2">
              <SubmitButton name="decision" value="verify">Mark verified</SubmitButton>
              <SubmitButton name="decision" value="more_info" variant="secondary">Ask for info</SubmitButton>
              <SubmitButton name="decision" value="under_review" variant="secondary">Under review</SubmitButton>
              <SubmitButton name="decision" value="reject" variant="danger">Reject</SubmitButton>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
