import Link from "next/link";
import { Card, SectionTitle, StatusBadge, KV, Divider, Alert } from "@/components/ui";
import { storage } from "@/lib/storage";
import { cn, fmtDate, fmtDateTime, fmtBytes, fmtMoney, shownEvent, statusLabel } from "@/lib/utils";
import type { Selection } from "@/lib/rules";
import type { Prisma } from "@prisma/client";
import type { ReactNode } from "react";
import { FileText, Download, Award, Timer } from "lucide-react";
import { LocalTime } from "./local-time";

/**
 * Everything both request pages show. The asker's profile (its receiving
 * half: public page, score) comes with the sending half, so pages can link to
 * the one public profile and show the one Consent Score.
 */
export const fullRequestInclude = {
  consenter: true,
  requester: { include: { consenter: { select: { slug: true, score: true, bio: true } } } },
  files: true,
  events: true,
  grant: true,
  payments: true,
  reports: true,
} satisfies Prisma.ConsentRequestInclude;

export type FullRequest = Prisma.ConsentRequestGetPayload<{ include: typeof fullRequestInclude }>;

/** The name of whoever is on that side of the request, for copy: never "requester" or "consenter". */
export function sideName(request: Pick<FullRequest, "consenter" | "requester">, side: string | null | undefined) {
  if (side === "consenter") return request.consenter.displayName;
  if (side === "requester") return request.requester.displayName;
  if (side === "admin") return "Consent team";
  if (side === "system") return "Automatic";
  return null;
}

/**
 * How long the consent lasts. An end date always shows: a request approved
 * with an earlier end before only time windows could get one may carry an
 * end date on a single publication or perpetual request.
 */
function validityText(r: Pick<FullRequest, "validityKind" | "validFrom" | "validUntil">): string {
  if (r.validityKind === "DATE_RANGE") return `${fmtDateTime(r.validFrom)} → ${fmtDateTime(r.validUntil)}`;
  if (r.validityKind === "SINGLE_PUBLICATION")
    return r.validUntil ? `Single publication, until ${fmtDate(r.validUntil)}` : "Single publication";
  return r.validUntil ? `Until ${fmtDate(r.validUntil)}` : "Perpetual";
}

export function ScopeCard({ request }: { request: FullRequest }) {
  const selections = (request.approvedSelections ?? request.selections) as Selection[];
  const original = request.selections as Selection[];
  const reduced = request.approvedSelections && JSON.stringify(request.approvedSelections) !== JSON.stringify(original);
  return (
    <Card className="space-y-3">
      <SectionTitle
        title="Requested scope"
        desc={reduced ? `Shown as approved, with ${request.consenter.displayName}'s conditions.` : undefined}
      />
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
      <KV k="Validity" v={validityText(request)} />
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
    ["RAW_CONTENT", "Final content"],
    ["ASSET", `Assets of ${request.consenter.displayName}`],
    ["THUMBNAIL", "Thumbnail"],
  ];
  // A file another upload replaced is superseded; the certificate never covers it.
  const replaced = new Set(request.files.map((f) => f.replacesId).filter(Boolean));
  return (
    <Card className="space-y-4" id="uploads">
      <SectionTitle title="The exact files" desc="Approval is locked to these exact files. A new version needs its own approval." />
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
                  {f.approvedInGrant ? " · on the certificate" : request.grant && !replaced.has(f.id) ? " · not on the certificate" : ""}
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

/** A list of money lines (MoneyRow), one under the other. */
export function MoneyRows({ children }: { children: ReactNode }) {
  return <dl className="divide-y divide-ink/10 text-sm">{children}</dl>;
}

/**
 * One money line: the label and the amount on one line (the amount never
 * wraps), and the note under them across the full width, so a narrow phone
 * screen doesn't squeeze the label into a thin column.
 */
export function MoneyRow({
  label,
  amount,
  note,
  strong,
}: {
  label: ReactNode;
  amount: ReactNode;
  note?: ReactNode;
  strong?: boolean;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 py-2.5">
      <dt className={strong ? "font-medium text-ink" : "text-ink-soft"}>{label}</dt>
      <dd className={cn("whitespace-nowrap text-right tabular-nums", strong && "font-semibold")}>{amount}</dd>
      {note && <dd className="col-span-2 mt-0.5 text-xs leading-relaxed text-ink-faint">{note}</dd>}
    </div>
  );
}

/** View-only line for seats that can see a card but not act on it. */
export function ViewOnlyNote({ children = "You have view-only access." }: { children?: ReactNode }) {
  return <p className="border-t hairline pt-3 text-xs text-ink-faint">{children}</p>;
}

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

const FILE_KIND: Record<string, string> = {
  ASSET: "Asset",
  RAW_CONTENT: "Final content file",
  THUMBNAIL: "Thumbnail",
  EVIDENCE: "Evidence",
};

/** A timeline line, in plain words; a refunded consent request fee shows the part that went back. */
function eventTitle(e: { type: string; detail: Prisma.JsonValue }, owner: string): ReactNode {
  switch (e.type) {
    case "submitted":
      return "Request sent";
    case "auto_approved": {
      const rule = detailText(e.detail, "rule");
      return rule ? <Said label={`Approved automatically by ${owner}'s terms`} text={rule} /> : `Approved automatically by ${owner}'s terms`;
    }
    case "auto_denied":
      return `Declined automatically by ${owner}'s terms`;
    case "routed":
      return "Passed to a teammate";
    case "approved":
    case "approved_with_conditions": {
      const note = detailText(e.detail, "conditionsNote");
      const until = detailText(e.detail, "validUntil");
      const label = note || e.type === "approved_with_conditions" ? "Approved with conditions" : "Approved";
      // The end date it was approved until, so a shorter one the owner set is seen.
      const withEnd = until && !Number.isNaN(new Date(until).getTime()) ? `${label}, until ${fmtDate(until)}` : label;
      return note ? <Said label={withEnd} text={note} /> : withEnd;
    }
    case "changes_requested":
      return <Said label="Asked" text={detailText(e.detail, "note")} />;
    case "ask_answered":
      return <Said label="Answered" text={detailText(e.detail, "answer")} />;
    case "denied":
      return <Said label="Declined" text={detailText(e.detail, "reason")} />;
    case "withdrawn":
      return "Withdrawn";
    case "file_uploaded": {
      const kind = FILE_KIND[detailText(e.detail, "kind")] ?? "File";
      const name = detailText(e.detail, "name");
      return name ? `${kind} uploaded: ${name}` : `${kind} uploaded`;
    }
    case "grant_issued":
      return "Certificate issued";
    case "grant_revoked":
      return <Said label="Consent revoked" text={detailText(e.detail, "reason")} />;
    case "takedown_raised":
      return <Said label="Takedown requested" text={detailText(e.detail, "reason")} />;
    case "takedown_marked_down":
      return "Marked as taken down";
    case "takedown_declined":
      return <Said label="Takedown declined" text={detailText(e.detail, "declineReason")} />;
    case "takedown_confirmed":
      return "Takedown confirmed as done";
    case "takedown_claim_rejected":
      return "Said the content is still live";
    case "takedown_ignored":
      return "Takedown not answered in time";
    case "report_filed":
      return <Said label="Breach reported" text={detailText(e.detail, "reason")} />;
    case "report_response":
      return "Answered a breach report";
    case "auto_expired":
      return "Expired unanswered";
    case "auto_closed": {
      const reason = detailText(e.detail, "reason");
      return reason ? `Closed: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}` : "Closed";
    }
    case "closed":
      return "Closed";
    case "closed_by_consent":
      return <Said label="Closed by the Consent team" text={detailText(e.detail, "note")} />;
    case "admin_force_expired":
      return "Expired by the Consent team";
    case "admin_note":
      return <Said label="Note from the Consent team" text={detailText(e.detail, "note")} />;
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
    default: {
      const words = e.type.replace(/_/g, " ");
      return words.charAt(0).toUpperCase() + words.slice(1);
    }
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
  const events = [...request.events]
    .filter(shownEvent)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  if (events.length === 0 && !expiresAt) return null;
  return (
    <Card className="space-y-3">
      <SectionTitle
        title="Timeline"
        desc="Shown in your local time."
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
        {events.map((e) => {
          const who = sideName(request, e.actorSide);
          // A person's name, then the profile they acted for when it isn't the same.
          const forProfile = e.actorSide === "consenter" || e.actorSide === "requester";
          const by =
            forProfile && e.actorName && who && e.actorName !== who ? `${e.actorName} for ${who}` : (e.actorName ?? who);
          return (
            <li key={e.id} className="relative border-l border-ink/10 pb-3 pl-4 last:pb-0">
              <span className="absolute -left-[3.5px] top-1.5 size-1.5 rounded-full bg-ink" aria-hidden />
              <div className="text-sm font-medium break-words">{eventTitle(e, request.consenter.displayName)}</div>
              <div className="text-xs text-ink-faint">
                {by ? `${by} · ` : ""}
                <LocalTime iso={e.createdAt.toISOString()} />
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

export function GrantCard({ request }: { request: FullRequest }) {
  const grant = request.grant;
  if (!grant) return null;
  return (
    <Card strong className="space-y-3">
      <SectionTitle title="Certificate" />
      <div className="flex flex-wrap items-center gap-3">
        <Award className="size-8" strokeWidth={1.25} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-sm font-semibold break-all">{grant.certificateId}</div>
          <div className="text-xs text-ink-soft">Issued {fmtDateTime(grant.issuedAt)} · {statusLabel(grant.status)}</div>
        </div>
        <StatusBadge status={grant.status} />
      </div>
      {grant.revokedAt && (
        <Alert tone="warn">
          Revoked on {fmtDateTime(grant.revokedAt)}. Use published before this date stays covered. Reason: {grant.revokeReason}
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
        The verification link <span className="font-mono text-xs break-all">{process.env.APP_URL}/v/{grant.publicId}</span> must appear in the published content&apos;s description, caption, notes or article.
      </Alert>
    </Card>
  );
}
