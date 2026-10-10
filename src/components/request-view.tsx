import Link from "next/link";
import { Card, SectionTitle, StatusBadge, KV, Divider, Alert } from "@/components/ui";
import { storage } from "@/lib/storage";
import { fmtDateTime, fmtBytes, titleCase, fmtMoney, statusLabel } from "@/lib/utils";
import type { Selection } from "@/lib/rules";
import type { ContactField, SharedContact } from "@/lib/requests";
import type { CallMode, Prisma } from "@prisma/client";
import type { ReactNode } from "react";
import { FileText, Download, Award, Timer } from "lucide-react";
import { NegotiationActions } from "./negotiation-actions";
import { LocalTime } from "./local-time";
import { countersLeft, MAX_COUNTER_OFFERS } from "@/lib/negotiation";

export type FullRequest = Prisma.ConsentRequestGetPayload<{
  include: {
    consenter: true;
    requester: true;
    files: true;
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
  // A file another upload replaced is superseded; the grant never covers it.
  const replaced = new Set(request.files.map((f) => f.replacesId).filter(Boolean));
  return (
    <Card className="space-y-4" id="uploads">
      <SectionTitle title="The exact files" desc="Approval is locked to these exact files — upload a new version and it needs its own approval." />
      {watermark && (
        <p className="text-xs text-ink-faint">Previews are watermarked for review. Links expire after 10 minutes.</p>
      )}
      {groups.map(([kind, label]) => {
        const files = request.files.filter((f) => f.kind === kind).sort((a, b) => b.version - a.version);
        if (files.length === 0) return null;
        return (
          <div key={kind} className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-ink-faint">{label}</div>
            {files.map((f) => (
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
                  {!replaced.has(f.id) ? (
                    <a href={storage.signedUrl(f.storageKey, f.name, 600)} target="_blank" rel="noreferrer" className="rounded-lg p-1.5 hover:bg-ink/5" aria-label={`Download ${f.name}`}>
                      <Download className="size-4" aria-hidden />
                    </a>
                  ) : (
                    <span className="text-[10px] text-ink-faint">
                      {request.grant && !f.approvedInGrant ? "superseded · not covered" : "superseded"}
                    </span>
                  )}
                </div>
                <div className="mt-1 font-mono text-[10px] text-ink-faint break-all">sha256: {f.sha256}</div>
                <div className="text-[10px] text-ink-faint">{fmtBytes(f.size)} · {fmtDateTime(f.createdAt)}
                  {f.approvedInGrant ? " · bound to grant" : request.grant && !replaced.has(f.id) ? " · not covered by the grant" : ""}
                </div>
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

/** View-only line for seats that can see a card but not act on it. */
export function ViewOnlyNote({ children = "You have view-only access." }: { children?: ReactNode }) {
  return <p className="border-t hairline pt-3 text-xs text-ink-faint">{children}</p>;
}

export function NegotiationCard({
  request,
  side,
  canAct: allowed = true,
  canApprove = true,
}: {
  request: FullRequest;
  side: "consenter" | "requester";
  /** False for read-only seats: requester viewers, owner's teammates who can't negotiate. */
  canAct?: boolean;
  /** Owner's side: whether this teammate can approve, which is how the owner accepts a fee. */
  canApprove?: boolean;
}) {
  const offers = [...request.offers].sort((a, b) => b.version - a.version);
  const latest = offers[0];
  const open = request.status === "IN_NEGOTIATION";
  if (offers.length === 0 && !open) return null;
  return (
    <Card className="space-y-4" id="negotiation">
      <SectionTitle
        title="Fee negotiation"
        desc={`Each side can send up to ${MAX_COUNTER_OFFERS} counter-offers. Once a fee is agreed, the owner can share contact details and payment is settled directly, never through Consent.`}
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
      {open && latest && !allowed && (
        <ViewOnlyNote>
          {side === "requester"
            ? "You have view-only access."
            : "You can follow the fee here. Answering it needs the negotiate permission."}
        </ViewOnlyNote>
      )}
      {open && latest && allowed && (
        <NegotiationActions
          requestId={request.id}
          side={side}
          canApprove={canApprove}
          latestId={latest.id}
          latestLabel={fmtMoney(latest.amount.toString(), latest.currency)}
          latestNote={latest.scopeNote}
          latestIsTheirs={latest.bySide !== side && latest.status === "OPEN"}
          currency={latest.currency}
          myCountersLeft={countersLeft(request.offers, side)}
          theirCountersLeft={countersLeft(request.offers, side === "consenter" ? "requester" : "consenter")}
          otherName={side === "consenter" ? request.requester.displayName : request.consenter.displayName}
        />
      )}
    </Card>
  );
}

const CONTACT_ROWS: [ContactField, string][] = [
  ["email", "Email"],
  ["phone", "Phone"],
  ["address", "Address"],
  ["manager", "Manager/agency"],
];

export function ContactsCard({ request }: { request: FullRequest }) {
  if (!request.contactsRevealed || !request.contactsSnapshot) return null;
  // Snapshots from before addresses could be shared have no address key.
  const snap = request.contactsSnapshot as unknown as {
    consenter: Partial<SharedContact> & { name: string };
    requester: Partial<SharedContact> & { name: string };
    revealedAt: string;
  };
  return (
    <Card className="space-y-3">
      <SectionTitle
        title="Shared contact details"
        desc={
          request.agreedAmount
            ? "Shared by the owner. Settle the agreed fee directly. Consent does not track or process this payment in any way."
            : "Shared by the owner, so you can reach each other directly."
        }
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {([["Consenter", snap.consenter], ["Requester", snap.requester]] as const).map(([label, c]) => {
          const rows = CONTACT_ROWS.filter(([f]) => c[f]);
          return (
            <div key={label} className="glass-subtle space-y-2 px-4 py-3 text-sm">
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-faint">{label} — {c.name}</div>
              {rows.length === 0 ? (
                <p className="text-ink-faint">No details shared.</p>
              ) : (
                <dl className="space-y-1.5">
                  {rows.map(([f, name]) => (
                    <div key={f}>
                      <dt className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{name}</dt>
                      <dd className="whitespace-pre-line break-words">{c[f]}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          );
        })}
      </div>
      {request.agreedAmount && (
        <Alert>
          Agreed fee: <strong>{fmtMoney(request.agreedAmount.toString(), request.agreedCurrency ?? "USD")}</strong> — handled directly between parties, not through Consent.
        </Alert>
      )}
    </Card>
  );
}

const MODE_NAME: Record<CallMode, string> = { VIDEO: "video call", PHONE: "phone call", IN_PERSON: "in person" };
const FIELD_NAME: Record<ContactField, string> = { email: "email", phone: "phone", address: "address", manager: "manager/agency" };

/** A string from an event's detail, or "". */
function detailText(detail: Prisma.JsonValue, key: string): string {
  const v = detail && typeof detail === "object" && !Array.isArray(detail) ? detail[key] : null;
  return typeof v === "string" ? v : "";
}

/** "Label: text", with the text kept as written (line breaks and all). */
function Said({ label, text }: { label: string; text: string }) {
  if (!text) return <>{label}</>;
  return (
    <>
      {label}: <span className="whitespace-pre-wrap font-normal text-ink-soft">{text}</span>
    </>
  );
}

/** A timeline line; a refunded consent request fee shows the part that went back. */
function eventTitle(e: { type: string; detail: Prisma.JsonValue }): ReactNode {
  switch (e.type) {
    case "changes_requested":
      return <Said label="Asked" text={detailText(e.detail, "note")} />;
    case "ask_answered":
      return <Said label="Answered" text={detailText(e.detail, "answer")} />;
    case "agreement_redraft_requested":
      return <Said label="Asked for a new agreement draft" text={detailText(e.detail, "reason")} />;
    case "meeting_scheduled":
    case "meeting_moved": {
      const at = detailText(e.detail, "startsAt");
      const mode = detailText(e.detail, "mode") as CallMode;
      const label = e.type === "meeting_scheduled" ? "Meeting scheduled" : "Meeting moved";
      if (!at) return label;
      return (
        <>
          {label} {e.type === "meeting_scheduled" ? "for" : "to"} <LocalTime iso={at} weekday withZone />
          {MODE_NAME[mode] ? ` · ${MODE_NAME[mode]}` : ""}
        </>
      );
    }
    case "meeting_cancelled":
      return "Meeting cancelled";
    case "contacts_shared": {
      const d = (e.detail ?? {}) as { fields?: ContactField[] };
      const names = (d.fields ?? []).map((f) => FIELD_NAME[f]).filter(Boolean);
      return names.length ? `Contact details shared (${names.join(", ")})` : "Contact details shared";
    }
    case "auto_expired":
      return "Expired unanswered";
    case "auto_closed": {
      const reason = detailText(e.detail, "reason");
      return reason ? `Closed: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}` : "Closed";
    }
    case "consent_price_refunded": {
      // Refunds logged before the 80/20 split returned the whole fee.
      const d = (e.detail ?? {}) as { amount?: string; currency?: string };
      const n = Number(d.amount);
      return n > 0 ? `Consent request fee refunded: ${fmtMoney(n, d.currency)} (100%)` : "Consent request fee refunded";
    }
    case "consent_fee_refunded": {
      const d = (e.detail ?? {}) as { fee?: string; refunded?: string; currency?: string };
      const fee = Number(d.fee);
      const back = Number(d.refunded);
      if (!(fee > 0) || !(back >= 0)) return "Consent request fee refunded";
      return `Consent request fee refunded: ${fmtMoney(back, d.currency)} (${Math.round((back / fee) * 100)}%) of ${fmtMoney(fee, d.currency)}`;
    }
    default:
      return titleCase(e.type);
  }
}

export function TimelineCard({
  request,
  expiresAt,
}: {
  request: FullRequest;
  /** When an open request expires if nobody acts; shown at the top. */
  expiresAt?: Date | null;
}) {
  const events = [...request.events].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  if (events.length === 0 && !expiresAt) return null;
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
      {expiresAt && (
        <p className="glass-subtle flex items-start gap-2 px-4 py-2.5 text-sm text-ink-soft">
          <Timer className="mt-0.5 size-4 shrink-0 text-ink" aria-hidden />
          <span>
            Expires <LocalTime iso={expiresAt.toISOString()} className="font-medium text-ink" /> unless someone acts.
            Any action from either side resets it.
          </span>
        </p>
      )}
      <ol className="space-y-0">
        {events.map((e) => (
          <li key={e.id} className="relative border-l border-ink/10 pb-3 pl-4 last:pb-0">
            <span className="absolute -left-[3.5px] top-1.5 size-1.5 rounded-full bg-ink" aria-hidden />
            <div className="text-sm font-medium break-words">{eventTitle(e)}</div>
            <div className="text-xs text-ink-faint">
              {e.actorName ? `${e.actorName} (${e.actorSide}) · ` : e.actorSide ? `${e.actorSide} · ` : ""}
              <LocalTime iso={e.createdAt.toISOString()} />
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
