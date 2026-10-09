import Link from "next/link";
import { Card, SectionTitle, StatusBadge, KV, Divider, Alert } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { Input, Textarea } from "@/components/ui";
import { storage } from "@/lib/storage";
import { fmtDateTime, fmtBytes, titleCase, fmtMoney, statusLabel } from "@/lib/utils";
import { sendMessageAction, makeOfferAction, acceptOfferAction, closeNegotiationAction } from "@/app/(app)/requests/shared-actions";
import type { Selection } from "@/lib/rules";
import type { Prisma } from "@prisma/client";
import { FileText, Paperclip, Download, Award } from "lucide-react";

export type FullRequest = Prisma.ConsentRequestGetPayload<{
  include: {
    consenter: true;
    requester: true;
    files: true;
    messages: { include: { sender: true } };
    offers: { include: { byUser: true } };
    events: true;
    grant: true;
    agreement: true;
    payments: true;
    reports: true;
  };
}>;

export function ScopeCard({ request }: { request: FullRequest }) {
  const selections = (request.approvedSelections ?? request.selections) as Selection[];
  const original = request.selections as Selection[];
  const reduced = request.approvedSelections && JSON.stringify(request.approvedSelections) !== JSON.stringify(original);
  return (
    <Card className="space-y-3">
      <SectionTitle title="Requested scope" desc={reduced ? "Shown as approved (conditions applied by the consenter)." : undefined} />
      <div className="flex flex-wrap gap-1.5">
        {selections.map((s) => (
          <span key={s.formatId} className="rounded-full border border-ink/20 bg-white/60 px-2.5 py-1 text-xs font-medium">
            {s.platformName} → {s.formatName}
            {s.durationSec ? ` · ${s.durationSec}s` : ""}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {request.assetTypeNames.map((a) => (
          <span key={a} className="rounded-full bg-ink/5 px-2.5 py-1 text-xs">{a}</span>
        ))}
        {(request.approvedThumbnail ?? request.thumbnailUsed) && (
          <span className="rounded-full bg-ink/5 px-2.5 py-1 text-xs">+ Thumbnail</span>
        )}
      </div>
      <Divider />
      <KV k="Validity" v={
        request.validityKind === "SINGLE_PUBLICATION" ? "Single publication"
        : request.validityKind === "PERPETUAL" ? "Perpetual"
        : `${fmtDateTime(request.validFrom)} → ${fmtDateTime(request.validUntil)}`
      } />
      {request.plannedPublishAt && <KV k="Planned publish" v={fmtDateTime(request.plannedPublishAt)} />}
      <KV k="Intent" v={request.intentCategoryName ?? "—"} />
      {request.conditionsNote && <KV k="Conditions" v={request.conditionsNote} />}
      <KV k="Context" v={request.context || "—"} />
      <KV k="Creative plan" v={request.creativePlan || "—"} />
    </Card>
  );
}

export function FilesCard({ request, watermark }: { request: FullRequest; watermark?: boolean }) {
  const groups: [string, string][] = [
    ["RAW_CONTENT", "Raw final content"],
    ["ASSET", "Assets of the consenter"],
    ["THUMBNAIL", "Thumbnail"],
  ];
  return (
    <Card className="space-y-4" id="uploads">
      <SectionTitle title="Files & hashes" desc="Approval is bound to these exact SHA-256 hashes. New versions never inherit a grant." />
      {watermark && (
        <p className="text-xs text-ink-faint">Previews are watermarked for review. Links expire after 10 minutes.</p>
      )}
      {groups.map(([kind, label]) => {
        const files = request.files.filter((f) => f.kind === kind).sort((a, b) => b.version - a.version);
        if (files.length === 0) return null;
        return (
          <div key={kind} className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-ink-faint">{label}</div>
            {files.map((f, i) => (
              <div key={f.id} className="glass-subtle relative overflow-hidden px-4 py-3">
                {watermark && (
                  <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center text-2xl font-bold tracking-[0.3em] text-ink/5 select-none">
                    CONSENT REVIEW
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm">
                  <FileText className="size-4 shrink-0 text-ink-soft" aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-medium">{f.name}</span>
                  <span className="rounded-full border border-ink/15 px-1.5 py-0.5 text-[10px]">v{f.version}</span>
                  {i === 0 ? (
                    <a href={storage.signedUrl(f.storageKey, f.name, 600)} target="_blank" rel="noreferrer" className="rounded-lg p-1.5 hover:bg-ink/5" aria-label={`Download ${f.name}`}>
                      <Download className="size-4" aria-hidden />
                    </a>
                  ) : (
                    <span className="text-[10px] text-ink-faint">superseded</span>
                  )}
                </div>
                <div className="mt-1 font-mono text-[10px] text-ink-faint break-all">sha256: {f.sha256}</div>
                <div className="text-[10px] text-ink-faint">{fmtBytes(f.size)} · {fmtDateTime(f.createdAt)}{f.approvedInGrant ? " · bound to grant" : ""}</div>
              </div>
            ))}
          </div>
        );
      })}
      {request.files.filter((f) => ["RAW_CONTENT", "ASSET", "THUMBNAIL"].includes(f.kind)).length === 0 && (
        <p className="text-sm text-ink-faint">No files uploaded yet.</p>
      )}
    </Card>
  );
}

export function NegotiationCard({ request, side }: { request: FullRequest; side: "consenter" | "requester" }) {
  const offers = [...request.offers].sort((a, b) => b.version - a.version);
  const latest = offers[0];
  const canAct = request.status === "IN_NEGOTIATION";
  if (offers.length === 0 && !canAct) return null;
  return (
    <Card className="space-y-4" id="negotiation">
      <SectionTitle
        title="Fee negotiation"
        desc="Unlimited counter-offers. When one side accepts, contact details are shared and payment is settled directly — never through Consent."
      />
      <ol className="space-y-2">
        {offers.map((o) => (
          <li key={o.id} className="glass-subtle flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
            <span className="rounded-full bg-ink/5 px-2 py-0.5 font-mono text-[10px]">v{o.version}</span>
            <span className="font-semibold">{fmtMoney(o.amount.toString(), o.currency)}</span>
            <span className="text-ink-soft">by {o.byUser.name} ({o.bySide})</span>
            {o.scopeNote && <span className="w-full text-xs text-ink-soft sm:w-auto">“{o.scopeNote}”</span>}
            <span className="ml-auto text-xs text-ink-faint">{fmtDateTime(o.createdAt)}</span>
            <StatusBadge status={o.status === "ACCEPTED" ? "APPROVED" : o.status === "OPEN" ? "PENDING" : "CLOSED"} />
          </li>
        ))}
      </ol>
      {canAct && (
        <div className="space-y-3 border-t hairline pt-3">
          {latest && latest.bySide !== side && latest.status === "OPEN" && (
            <form action={acceptOfferAction}>
              <input type="hidden" name="id" value={request.id} />
              <SubmitButton>Accept {fmtMoney(latest.amount.toString(), latest.currency)}</SubmitButton>
            </form>
          )}
          <form action={makeOfferAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="id" value={request.id} />
            <div className="w-28">
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Amount</label>
              <Input name="amount" type="number" step="0.01" min="0" required placeholder="500" />
            </div>
            <div className="w-20">
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Currency</label>
              <Input name="currency" defaultValue={latest?.currency ?? "USD"} maxLength={3} required />
            </div>
            <div className="min-w-40 flex-1">
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Scope note</label>
              <Input name="scopeNote" placeholder="optional change to scope" />
            </div>
            <SubmitButton variant="secondary">Counter-offer</SubmitButton>
          </form>
          <form action={closeNegotiationAction}>
            <input type="hidden" name="id" value={request.id} />
            <SubmitButton variant="ghost" size="sm">Walk away (close request)</SubmitButton>
          </form>
        </div>
      )}
    </Card>
  );
}

export function ContactsCard({ request }: { request: FullRequest }) {
  if (!request.contactsRevealed || !request.contactsSnapshot) return null;
  const snap = request.contactsSnapshot as {
    consenter: { name: string; email: string | null; phone: string | null; manager: string | null };
    requester: { name: string; email: string | null; phone: string | null; manager: string | null };
    revealedAt: string;
  };
  return (
    <Card className="space-y-3">
      <SectionTitle title="Shared contact details" desc="Settle the agreed fee directly. Consent does not track or process this payment in any way." />
      <div className="grid gap-3 sm:grid-cols-2">
        {([["Consenter", snap.consenter], ["Requester", snap.requester]] as const).map(([label, c]) => (
          <div key={label} className="glass-subtle space-y-1 px-4 py-3 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wider text-ink-faint">{label} — {c.name}</div>
            <div>{c.email ?? <span className="text-ink-faint">email not shared</span>}</div>
            <div>{c.phone ?? <span className="text-ink-faint">phone not shared</span>}</div>
            <div>{c.manager ?? <span className="text-ink-faint">manager not shared</span>}</div>
          </div>
        ))}
      </div>
      {request.agreedAmount && (
        <Alert>
          Agreed fee: <strong>{fmtMoney(request.agreedAmount.toString(), request.agreedCurrency ?? "USD")}</strong> — handled directly between parties, not through Consent.
        </Alert>
      )}
    </Card>
  );
}

export function MessagesCard({ request, side }: { request: FullRequest; side: "consenter" | "requester" }) {
  const messages = [...request.messages].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const open = !["DENIED", "CLOSED", "EXPIRED_NO_RESPONSE", "WITHDRAWN"].includes(request.status);
  return (
    <Card className="space-y-4" id="messages">
      <SectionTitle title="Messages" desc="Clarifications between both teams. Everything is logged." />
      <div className="space-y-2">
        {messages.length === 0 && <p className="text-sm text-ink-faint">No messages yet.</p>}
        {messages.map((m) => {
          const file = m.attachmentFileId ? request.files.find((f) => f.id === m.attachmentFileId) : null;
          const mine = m.senderSide === side;
          return (
            <div key={m.id} className={mine ? "flex justify-end" : "flex justify-start"}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${mine ? "glass-ink" : "glass-subtle"}`}>
                <div className={`text-[10px] font-semibold uppercase tracking-wider ${mine ? "text-white/60" : "text-ink-faint"}`}>
                  {m.sender.name} · {m.senderSide}
                </div>
                {m.body && <p className="mt-0.5 whitespace-pre-wrap">{m.body}</p>}
                {file && (
                  <a href={storage.signedUrl(file.storageKey, file.name, 600)} target="_blank" rel="noreferrer" className={`mt-1 flex items-center gap-1.5 text-xs underline underline-offset-4 ${mine ? "text-white" : "text-ink"}`}>
                    <Paperclip className="size-3" aria-hidden /> {file.name}
                  </a>
                )}
                <div className={`mt-1 text-[10px] ${mine ? "text-white/50" : "text-ink-faint"}`}>{fmtDateTime(m.createdAt)}</div>
              </div>
            </div>
          );
        })}
      </div>
      {open && (
        <form action={sendMessageAction} className="space-y-2 border-t hairline pt-3">
          <input type="hidden" name="id" value={request.id} />
          <Textarea name="body" placeholder="Write a message…" className="min-h-16" />
          <div className="flex items-center justify-between gap-2">
            <input type="file" name="attachment" className="text-xs file:mr-2 file:rounded-lg file:border-0 file:bg-ink/10 file:px-2.5 file:py-1 file:text-xs" aria-label="Attachment" />
            <SubmitButton size="sm">Send</SubmitButton>
          </div>
        </form>
      )}
    </Card>
  );
}

export function TimelineCard({ request }: { request: FullRequest }) {
  const events = [...request.events].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  if (events.length === 0) return null;
  return (
    <Card className="space-y-3">
      <SectionTitle
        title="Timeline"
        desc="All timestamps stored in UTC, shown in your local time."
        action={
          <a href={`/api/dossier/${request.id}`} target="_blank" className="text-xs underline underline-offset-4 text-ink-soft hover:text-ink">
            Export history dossier
          </a>
        }
      />
      <ol className="space-y-0">
        {events.map((e) => (
          <li key={e.id} className="relative border-l border-ink/10 pb-3 pl-4 last:pb-0">
            <span className="absolute -left-[3.5px] top-1.5 size-1.5 rounded-full bg-ink" aria-hidden />
            <div className="text-sm font-medium">{titleCase(e.type)}</div>
            <div className="text-xs text-ink-faint">
              {e.actorName ? `${e.actorName} (${e.actorSide}) · ` : e.actorSide ? `${e.actorSide} · ` : ""}
              {fmtDateTime(e.createdAt)}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

export function GrantCard({ request }: { request: FullRequest }) {
  const grant = request.grant;
  if (!grant) return null;
  return (
    <Card strong className="space-y-3">
      <SectionTitle title="Consent grant" />
      <div className="flex flex-wrap items-center gap-3">
        <Award className="size-8" strokeWidth={1.25} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-sm font-semibold">{grant.certificateId}</div>
          <div className="text-xs text-ink-soft">Issued {fmtDateTime(grant.issuedAt)} · {statusLabel(grant.status)}</div>
        </div>
        <StatusBadge status={grant.status} />
      </div>
      {grant.revokedAt && (
        <Alert tone="warn">
          Revoked on {fmtDateTime(grant.revokedAt)} — valid for use published before this date. Reason: {grant.revokeReason}
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        <Link href={`/v/${grant.publicId}`} className="glass-ink rounded-xl px-4 py-2 text-sm font-medium hover:opacity-85">
          Public verification page
        </Link>
        <a href={`/api/certificates/${grant.publicId}`} className="rounded-xl border border-ink/15 bg-white/70 px-4 py-2 text-sm font-medium hover:border-ink/30">
          Certificate PDF
        </a>
        <Link href={`/v/${grant.publicId}/badge`} className="rounded-xl border border-ink/15 bg-white/70 px-4 py-2 text-sm font-medium hover:border-ink/30">
          Badge & embed
        </Link>
      </div>
      <Alert>
        The verification link <span className="font-mono text-xs">{process.env.APP_URL}/v/{grant.publicId}</span> must appear in the published content&apos;s description, caption, notes or article.
      </Alert>
    </Card>
  );
}
