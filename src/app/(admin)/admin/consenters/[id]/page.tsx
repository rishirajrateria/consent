import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { PageHeader, Card, StatusBadge, KV, Field, Textarea, Input, Select, SectionTitle, Alert } from "@/components/ui";
import { SubmitButton, ConfirmSubmit } from "@/components/form";
import { ErrorNote, SuccessNote } from "@/components/error-note";
import {
  decideProfileAction,
  clearDuplicateFlagAction,
  scheduleMeetingAction,
  recordMeetingOutcomeAction,
} from "../actions";
import { requireIdCheck, hasIdCheckPerm, ID_CHECK_MODULE } from "../perm";
import { decidable } from "../statuses";
import { fmtDateTime, fmtMoney, titleCase, fmtBytes } from "@/lib/utils";
import { parseChannels, compactCount } from "@/lib/channels";
import { FileText, ExternalLink } from "lucide-react";
import { NoPermission } from "../../no-permission";
import { PURPOSE, refundLine } from "../../payment-labels";

export const metadata = { title: "ID check" };

/** Audit actions for the applicant's answer to "more information needed" (current and older names). */
const REPLY_ACTIONS = ["profile_info_sent", "consenter_info_sent", "requester_info_sent"];

/** What each action's ?done= value confirms (only a decision or a scheduled call tells the applicant). */
const DONE_NOTES: Record<string, string> = {
  decided: "Saved. The applicant was told.",
  flag: "Duplicate flag cleared.",
  call: "Call outcome saved.",
};

/** The request limit the profile chose at onboarding, in words. */
function limitText(c: { maxOpenRequests: number | null; dailyRequestLimit: number | null; weeklyRequestLimit: number | null; monthlyRequestLimit: number | null }) {
  const parts = [
    c.maxOpenRequests && `${c.maxOpenRequests} waiting at once`,
    c.dailyRequestLimit && `${c.dailyRequestLimit} a day`,
    c.weeklyRequestLimit && `${c.weeklyRequestLimit} a week`,
    c.monthlyRequestLimit && `${c.monthlyRequestLimit} a month`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Unlimited";
}

/**
 * One profile's ID check. A profile is a pair (see lib/profiles), so this
 * page reads both halves: the profile (kind, legal name, bio, photo, fee,
 * limits, duplicate flag, the optional verification call) and its sending
 * half (creator type, channels, payments). The decision writes both.
 */
export default async function ProfileCheck({ params, searchParams }: PageProps<"/admin/consenters/[id]">) {
  const session = await requireIdCheck("view");
  const canDecide = hasIdCheckPerm(session.user.adminRole, "approve");
  const canEdit = hasIdCheckPerm(session.user.adminRole, "edit");
  const { id } = await params;
  const sp = await searchParams;
  const c = await db.consenterProfile.findUnique({
    where: { id },
    include: {
      members: { include: { user: true }, orderBy: { createdAt: "asc" } },
      documents: true,
      socialAccounts: true,
      meetings: { orderBy: { scheduledAt: "desc" }, include: { officer: true } },
      priceTiers: { include: { intentCategory: true } },
      asker: {
        include: {
          documents: true,
          socialAccounts: true,
          payments: { orderBy: { createdAt: "desc" }, take: 20 },
        },
      },
    },
  });
  if (!c) notFound();
  const asker = c.asker;
  const targets = [c.id, ...(asker ? [asker.id] : [])];
  // Internal notes are kept in the audit log, never on the profile (the applicant sees adminNotes).
  const [history, reply] = await Promise.all([
    db.auditLog.findMany({
      where: { module: { in: [ID_CHECK_MODULE, "requesters"] }, targetId: { in: targets } },
      orderBy: { createdAt: "desc" },
      take: 6,
    }),
    // The applicant's answer to "more information needed" lives in the audit log.
    db.auditLog.findFirst({
      where: { action: { in: REPLY_ACTIONS }, targetId: { in: targets } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const replyAddedDoc = !!(reply?.detail as { documentId?: string | null } | null)?.documentId;

  // Duplicate matches, for context.
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

  // Documents and channel proof can sit on either half; show each once.
  const documents = [...new Map([...c.documents, ...(asker?.documents ?? [])].map((d) => [d.id, d])).values()];
  const proofs = [...new Map([...c.socialAccounts, ...(asker?.socialAccounts ?? [])].map((s) => [s.url ?? `${s.platformName}:${s.handle}`, s])).values()];
  const channels = parseChannels(asker?.channels ?? []);
  const owner = c.members.find((m) => m.role === "OWNER");
  const base = Number(c.consentPrice?.toString() ?? 0);

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="ID check"
        title={c.displayName}
        desc={`${titleCase(c.entityType)}${asker ? ` · ${titleCase(asker.type)}` : ""} · ${c.country}`}
        action={<StatusBadge status={c.status} />}
      />
      {sp.done && <SuccessNote msg={DONE_NOTES[String(sp.done)] ?? "Saved."} />}
      <ErrorNote error={sp.error as string | undefined} />

      {c.duplicateFlag && (
        <Card className="space-y-3 border-ink/25">
          <Alert tone="warn">
            <strong>Possible duplicate: one person or name, one account.</strong> This application matches an
            existing profile by legal name, document number or channel. Approval is blocked until the flag is
            cleared with a reason.
          </Alert>
          {dupMatches.map((d) => (
            <div key={d.id} className="flex items-center justify-between text-sm">
              <Link href={`/admin/consenters/${d.id}`} className="underline underline-offset-4">
                {d.displayName} — {d.legalName}
              </Link>
              <StatusBadge status={d.status} />
            </div>
          ))}
          {canDecide ? (
            <form action={clearDuplicateFlagAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="id" value={c.id} />
              <div className="min-w-56 flex-1">
                <Field label="Reason to clear" required>
                  <Input name="reason" required placeholder="e.g. different person, name collision confirmed via documents" />
                </Field>
              </div>
              <SubmitButton variant="secondary">Clear flag</SubmitButton>
            </form>
          ) : (
            <NoPermission to="clear the flag" perm="approve" module={ID_CHECK_MODULE} />
          )}
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-1">
          <SectionTitle title="Profile" />
          <KV k="Legal name" v={c.legalName} />
          <KV k="Also known as" v={c.aliases.join(", ") || "—"} />
          <KV k="What they do" v={c.category ?? "—"} />
          <KV k="About" v={c.bio ?? asker?.description ?? "—"} />
          {asker && asker.categories.length > 0 && <KV k="Categories" v={asker.categories.join(", ")} />}
          <KV
            k="Consent request fee"
            v={
              base > 0
                ? `${fmtMoney(base, c.consentPriceCurrency)}${c.priceTiers.length ? " (different fees for some uses)" : ""}`
                : `Free to ask (${c.consentPriceCurrency})${c.priceTiers.length ? ", with fees for some uses" : ""}`
            }
          />
          <KV k="Requests they take" v={limitText(c)} />
          <KV k="Applied" v={fmtDateTime(c.createdAt)} />
          <KV
            k="Team"
            v={c.members.map((m) => `${m.user.name} (${m.user.email}) — ${titleCase(m.role)}`).join("; ") || "—"}
          />
          <KV k="Doc number hash" v={c.documentNumberHash ? `${c.documentNumberHash.slice(0, 16)}…` : "—"} mono />
        </Card>

        <Card className="space-y-3">
          <SectionTitle title="Channels" desc="Where they publish, as they gave it." />
          {channels.length === 0 && <p className="text-sm text-ink-faint">None listed.</p>}
          {channels.map((ch, i) => (
            <div key={i} className="flex items-center justify-between gap-2 text-sm">
              <span className="font-medium">{ch.platform}</span>
              <a href={ch.href} target="_blank" rel="noopener noreferrer" className="flex min-w-0 items-center gap-1 truncate text-ink-soft underline underline-offset-4">
                <span className="truncate">{ch.url}</span> <ExternalLink className="size-3 shrink-0" aria-hidden />
              </a>
              <span className="shrink-0 text-xs text-ink-faint">
                {ch.followers != null ? `${compactCount(ch.followers)} followers` : "—"}
              </span>
            </div>
          ))}
          <SectionTitle title="Channel proof" />
          {proofs.length === 0 && <p className="text-sm text-ink-faint">None connected.</p>}
          {proofs.map((s) => (
            <div key={s.id} className="flex items-center justify-between text-sm">
              <span>{s.platformName} — {s.handle}</span>
              <StatusBadge status={s.verifiedAt ? "VERIFIED" : "PENDING"} label={s.verifiedAt ? `Proven (${s.verifiedVia})` : "Not proven"} />
            </div>
          ))}
        </Card>

        <Card className="space-y-3">
          <SectionTitle title="Documents" desc="Private; links expire in 10 minutes." />
          {documents.length === 0 && <p className="text-sm text-ink-faint">No documents uploaded.</p>}
          {documents.map((d) => (
            <a
              key={d.id}
              href={storage.signedUrl(d.storageKey, d.name, 600)}
              target="_blank"
              rel="noreferrer"
              className="glass-subtle flex items-center gap-2 px-4 py-3 text-sm hover:border-ink/20"
            >
              <FileText className="size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{d.name}</span>
              <span className="text-xs text-ink-faint">
                {d.kind === "PROFILE_PHOTO" ? "Photo · " : ""}
                {fmtBytes(d.size)}
              </span>
            </a>
          ))}
        </Card>

        {reply && (
          <Card className="space-y-2">
            <SectionTitle title="Applicant's reply" desc={`Sent ${fmtDateTime(reply.createdAt)}`} />
            {reply.reason ? (
              <p className="whitespace-pre-wrap text-sm">{reply.reason}</p>
            ) : (
              <p className="text-sm text-ink-faint">No message.</p>
            )}
            {replyAddedDoc && <p className="text-xs text-ink-faint">They added a new document. It&apos;s under Documents.</p>}
          </Card>
        )}

        <Card className="space-y-4">
          <SectionTitle
            title="Verification call"
            desc="Optional. Schedule one when the documents need a closer look; it isn't needed to approve."
          />
          {c.meetings.map((m) => (
            <div key={m.id} className="glass-subtle space-y-2 px-4 py-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">{fmtDateTime(m.scheduledAt)} · {m.mode === "VIDEO" ? "Video" : "In person"}</span>
                {m.outcome ? (
                  <StatusBadge status={m.outcome === "passed" ? "APPROVED" : "REJECTED"} label={m.outcome === "passed" ? "Passed" : "Failed"} />
                ) : (
                  <StatusBadge status="PENDING" label="Scheduled" />
                )}
              </div>
              {m.link && <div className="truncate text-ink-soft">{m.link}</div>}
              {m.location && <div className="text-ink-soft">{m.location}</div>}
              {m.officer && <div className="text-xs text-ink-faint">Officer: {m.officer.name}</div>}
              {m.notes && <div className="text-xs text-ink-soft">{m.notes}</div>}
              {!m.outcome && canEdit && (
                <form action={recordMeetingOutcomeAction} className="space-y-2 border-t hairline pt-2">
                  <input type="hidden" name="meetingId" value={m.id} />
                  <Textarea name="notes" placeholder="Call notes…" className="min-h-16" aria-label="Call notes" />
                  <div className="flex gap-2">
                    <SubmitButton name="outcome" value="failed" size="sm" variant="danger">Failed</SubmitButton>
                    <SubmitButton name="outcome" value="passed" size="sm" variant="secondary">Passed</SubmitButton>
                  </div>
                </form>
              )}
            </div>
          ))}
          {c.status !== "APPROVED" &&
            (canEdit ? (
              <details>
                <summary className="flex min-h-10 cursor-pointer items-center text-sm font-medium text-ink-soft hover:text-ink">
                  Schedule a call…
                </summary>
                <form action={scheduleMeetingAction} className="space-y-3 pt-2">
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
                  <Field label="Call link" hint="Google Meet / Zoom URL for video calls.">
                    <Input name="link" type="url" placeholder="https://meet.google.com/…" />
                  </Field>
                  <Field label="Location" hint="For in-person checks.">
                    <Input name="location" placeholder="Office address" />
                  </Field>
                  <SubmitButton variant="secondary">Schedule call</SubmitButton>
                </form>
              </details>
            ) : (
              <NoPermission to="schedule or record calls" perm="edit" module={ID_CHECK_MODULE} />
            ))}
        </Card>

        {asker && asker.payments.length > 0 && (
          <Card className="space-y-2 lg:col-span-2">
            <SectionTitle title="Payments" />
            {asker.payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 text-sm">
                <span>
                  {PURPOSE[p.purpose]} · {fmtMoney(p.amount.toString(), p.currency)} · {fmtDateTime(p.createdAt)}
                  {p.status === "REFUNDED" && <span className="block text-xs text-ink-soft">{refundLine(p)}</span>}
                </span>
                <StatusBadge
                  status={p.status}
                  label={
                    p.status === "REFUNDED" && p.purpose === "CONSENT_PRICE"
                      ? `${Math.round((Number((p.refundedAmount ?? p.amount).toString()) / Number(p.amount.toString())) * 100)}% refunded`
                      : undefined
                  }
                />
              </div>
            ))}
          </Card>
        )}

        {/* Review first, decide last: the decision is the final card, full width. */}
        <Card className="space-y-4 lg:col-span-2">
          <SectionTitle title="Decision" desc="Approving lets this profile send and receive requests, and lists it publicly. They're told in-app and by email." />
          {history.length > 0 && (
            <ul className="space-y-1 text-xs text-ink-faint" aria-label="Team history">
              <li className="font-medium uppercase tracking-wider">Team history</li>
              {history.map((h) => (
                <li key={h.id}>
                  {fmtDateTime(h.createdAt)} · {h.actorName} · {titleCase(h.action.replace(/^(consenter|requester|profile)_/, ""))}
                  {h.reason ? ` · ${h.reason}` : ""}
                </li>
              ))}
            </ul>
          )}
          {c.status === "APPROVED" ? (
            <p className="text-sm text-ink-soft">
              Verified {c.verifiedAt ? fmtDateTime(c.verifiedAt) : ""}. To send this profile back to review, use{" "}
              <Link href={`/admin/users?q=${encodeURIComponent(owner?.user.email ?? c.displayName)}`} className="underline underline-offset-4">
                Users
              </Link>
              .
            </p>
          ) : !decidable(c.status) ? (
            <p className="text-sm text-ink-soft">Not sent yet. You can decide once they send the application.</p>
          ) : canDecide ? (
            <form action={decideProfileAction} className="space-y-3">
              <input type="hidden" name="id" value={c.id} />
              <Field label="Message to the applicant (they will see this)" hint="Required for Ask for info and Reject.">
                <Textarea name="note" placeholder="e.g. Please upload a clearer scan of your passport." />
              </Field>
              <Field label="Internal note (team only)" hint="Kept in the audit log. The applicant never sees it.">
                <Textarea name="internalNote" className="min-h-14" placeholder="e.g. Passport photo looks edited; worth a call." />
              </Field>
              {c.duplicateFlag && <p className="text-xs text-ink-faint">To approve, first clear the duplicate flag.</p>}
              <div className="flex flex-wrap gap-2">
                <SubmitButton name="decision" value="under_review" variant="secondary">Under review</SubmitButton>
                <SubmitButton name="decision" value="more_info" variant="secondary">Ask for info</SubmitButton>
                <ConfirmSubmit confirm="Reject this ID check? The applicant sees your message." name="decision" value="reject">
                  Reject
                </ConfirmSubmit>
                <SubmitButton name="decision" value="approve">Approve</SubmitButton>
              </div>
            </form>
          ) : (
            <NoPermission to="decide" perm="approve" module={ID_CHECK_MODULE} />
          )}
        </Card>
      </div>
    </div>
  );
}
