import Link from "next/link";
import { notFound } from "next/navigation";
import { requireConsenter } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, StatusBadge, SectionTitle, Alert, ScoreRing } from "@/components/ui";
import { ErrorNote } from "@/components/error-note";
import {
  ScopeCard, FilesCard, TimelineCard, GrantCard, MoneyRows, MoneyRow, fullRequestInclude,
  type FullRequest,
} from "@/components/request-view";
import { LocalTime } from "@/components/local-time";
import { DecisionPanel } from "./decision-panel";
import { RevokePanel } from "@/components/takedown-panels";
import { ReportPanel } from "@/components/report-panel";
import { fmtDate, fmtMoney } from "@/lib/utils";
import { ChannelLinks } from "@/components/channel-links";
import { getSettings } from "@/lib/settings";
import { OPEN_STATUSES, requestWindows } from "@/lib/request-window";
import { profileScore } from "@/lib/profiles-pure";
import type { Selection } from "@/lib/rules";
import type { Prisma } from "@prisma/client";
import { Timer } from "lucide-react";
import {
  OWNER_PCT, REFUND_PCT, CONSENT_PCT, grossOf, refundedOf, shareOf, nextPayoutDay, fmtPayoutDay,
} from "../fee-split";
import { openAsRightProfile, pathWithQuery } from "@/app/(app)/requests/open-as";

export const metadata = { title: "Review request" };

/** Waiting for this profile's answer. */
const DECIDABLE = ["PENDING", "CHANGES_REQUESTED"];

/** Tomorrow as "YYYY-MM-DD" (UTC): the earliest end date that still leaves some time. */
function tomorrow() {
  return new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
}

export default async function ReceivedRequestPage({ params, searchParams }: PageProps<"/c-panel/requests/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const { session, consenter, member } = await requireConsenter();
  const request = await db.consentRequest.findUnique({ where: { id }, include: fullRequestInclude });
  if (!request) notFound();
  // Sent to another profile this person is on (switch to it), or this person
  // sent it (open the sent view). A draft isn't sent yet, so nobody receives it.
  if (request.consenterId !== consenter.id || !request.submittedAt)
    await openAsRightProfile(session.userId, request, "received", pathWithQuery(`/c-panel/requests/${id}`, sp));

  const canDecide = member.role === "OWNER" || member.canApprove;
  const decidable = DECIDABLE.includes(request.status);
  const selections = request.selections as Selection[];
  const asker = request.requester;
  const askerScore = profileScore(asker.consenter?.score ?? asker.score, asker.consenter ? asker.score : null);
  const askerHref = `/c/${asker.consenter?.slug ?? asker.slug}`;
  const hasRaw = request.files.some((f) => f.kind === "RAW_CONTENT");
  const isOpen = OPEN_STATUSES.includes(request.status);
  const [denialReasons, earning, settings] = await Promise.all([
    decidable && canDecide ? db.denialReason.findMany({ where: { active: true } }) : [],
    db.earningEntry.findUnique({ where: { requestId: request.id }, include: { payment: true, settlement: true } }),
    getSettings(),
  ]);
  const [lastPayout, windows] = await Promise.all([
    earning?.status === "PENDING"
      ? db.settlement.findFirst({ where: { consenterId: consenter.id }, orderBy: { createdAt: "desc" } })
      : null,
    // An open request expires a set number of days after its last action from either side.
    isOpen ? requestWindows([request], settings.slaDays) : null,
  ]);
  const expiresAt = windows?.get(request.id)?.expiresAt ?? null;
  const ask = latestAsk(request.events);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        kicker={`Request #${request.number}`}
        title={asker.displayName}
        desc={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Link href={askerHref} className="underline underline-offset-4">Public profile</Link>
            <span>
              Consent Score <strong>{askerScore}</strong>
            </span>
            {expiresAt && (
              <span className="flex items-center gap-1 text-ink-soft">
                <Timer className="size-3.5 shrink-0" aria-hidden />
                <span>
                  Expires <LocalTime iso={expiresAt.toISOString()} /> unless someone acts
                </span>
              </span>
            )}
          </span>
        }
        action={<StatusBadge status={request.status} />}
      />
      <ErrorNote error={sp.error as string | undefined} />

      {/* Outcome first when there is one, then everything needed to judge the
          request, and the decision last: review first, decide last. */}
      <GrantCard request={request} />
      {request.status === "APPROVED_IN_PRINCIPLE" && (
        <Alert>
          <strong>You said yes.</strong> {asker.displayName} uploads the final content file next. The
          certificate is issued then, locked to that exact file.
        </Alert>
      )}

      <Card className="space-y-4">
        <SectionTitle title="Who's asking" />
        <div className="flex items-center gap-4">
          <ScoreRing score={askerScore} size={52} />
          <div className="min-w-0">
            <Link href={askerHref} className="font-semibold underline-offset-4 hover:underline">
              {asker.displayName}
            </Link>
            <div className="text-xs text-ink-faint">{asker.country}</div>
          </div>
        </div>
        {(asker.description || asker.consenter?.bio) && (
          <p className="text-sm leading-relaxed text-ink-soft">{asker.description || asker.consenter?.bio}</p>
        )}
        <ChannelLinks channels={asker.channels} owner={asker.displayName} />
      </Card>
      <ScopeCard request={request} />
      <FilesCard request={request} watermark />
      {earning && (
        <ConsentFeeCard
          earning={earning}
          askerName={asker.displayName}
          payoutDay={fmtPayoutDay(nextPayoutDay(lastPayout?.createdAt))}
        />
      )}
      <TimelineCard request={request} expiresAt={expiresAt} />
      <ReportPanel request={request} side="consenter" canAct={member.role !== "VIEWER"} />

      {/* What was asked and what came back, right above the decision. */}
      {decidable && ask && <AskSummary ask={ask} askerName={asker.displayName} canDecide={canDecide} />}

      {decidable && canDecide && (
        <DecisionPanel
          requestId={request.id}
          requesterName={asker.displayName}
          selections={selections}
          thumbnailUsed={request.thumbnailUsed}
          validUntil={request.validityKind === "DATE_RANGE" ? (request.validUntil?.toISOString() ?? null) : null}
          minEnd={tomorrow()}
          hasRaw={hasRaw}
          canAsk={request.status !== "CHANGES_REQUESTED"}
          denialReasons={denialReasons.map((d) => ({ id: d.id, label: d.label }))}
        />
      )}

      {decidable && !canDecide && (
        <Alert>You can see this request. Answering it needs the approve permission. Ask the profile&apos;s owner for it.</Alert>
      )}

      {request.grant && <RevokePanel request={request} canDecide={canDecide} />}
    </div>
  );
}

/** What the asker paid to ask, and where this profile's share of it stands. */
function ConsentFeeCard({
  earning: e,
  askerName,
  payoutDay,
}: {
  earning: Prisma.EarningEntryGetPayload<{ include: { payment: true; settlement: true } }>;
  askerName: string;
  payoutDay: string;
}) {
  const gross = grossOf(e);
  const share = Number(e.amount.toString());
  const refunded = e.status === "REFUNDED" ? refundedOf(e) : 0;
  const [label, amount, note] =
    e.status === "HELD"
      ? [`Yours if you say yes (${shareOf(share, gross)})`, share, "Held until you answer."]
      : e.status === "PENDING"
        ? [`Yours (${shareOf(share, gross)})`, share, `Paid out ${payoutDay}.`]
        : e.status === "SETTLED"
          ? [
              `Paid out to you (${shareOf(share, gross)})`,
              share,
              e.settlement ? `Paid out ${fmtDate(e.settlement.createdAt)}.` : null,
            ]
          : e.status === "REFUNDED"
            ? [`Refunded to ${askerName} (${shareOf(refunded, gross)})`, refunded, "No yes, so it went back to them."]
            : ["Not paid to you", share, null];
  return (
    <Card className="space-y-2">
      <SectionTitle
        title="Money"
        desc={`The consent request fee is held until you answer. If you say yes, ${OWNER_PCT} is yours, paid out on Fridays. If you decline, or the request ends without a yes, ${REFUND_PCT} goes back to them. Consent keeps ${CONSENT_PCT}.`}
      />
      <MoneyRows>
        <MoneyRow label="Consent request fee" amount={fmtMoney(gross, e.currency)} />
        <MoneyRow label={label} amount={fmtMoney(amount, e.currency)} note={note} strong />
      </MoneyRows>
    </Card>
  );
}

type Ask = {
  question: string;
  askedAt: Date;
  askedBy: string | null;
  answer: { text: string; at: Date; by: string | null } | null;
};

/** The latest Ask and the written answer to it, if any. */
function latestAsk(events: FullRequest["events"]): Ask | null {
  const newest = [...events].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const asked = newest.find((e) => e.type === "changes_requested");
  if (!asked) return null;
  const answered = newest.find((e) => e.type === "ask_answered" && e.createdAt >= asked.createdAt);
  const text = (d: Prisma.JsonValue, key: string) => {
    const v = d && typeof d === "object" && !Array.isArray(d) ? d[key] : null;
    return typeof v === "string" ? v : "";
  };
  return {
    question: text(asked.detail, "note"),
    askedAt: asked.createdAt,
    askedBy: asked.actorName,
    answer: answered ? { text: text(answered.detail, "answer"), at: answered.createdAt, by: answered.actorName } : null,
  };
}

/** "You asked … / They answered …", shown right above the decision. */
function AskSummary({ ask, askerName, canDecide }: { ask: Ask; askerName: string; canDecide: boolean }) {
  return (
    <Card className="space-y-4" id="ask">
      <div className="space-y-1">
        <p className="text-sm">
          <span className="font-semibold">You asked:</span>{" "}
          <span className="whitespace-pre-wrap break-words">{ask.question}</span>
        </p>
        <p className="text-xs text-ink-faint">
          {ask.askedBy ? `${ask.askedBy} · ` : ""}
          <LocalTime iso={ask.askedAt.toISOString()} />
        </p>
      </div>
      {ask.answer ? (
        <div className="space-y-1 border-t hairline pt-4">
          <p className="text-sm">
            <span className="font-semibold">They answered:</span>{" "}
            <span className="whitespace-pre-wrap break-words">{ask.answer.text}</span>
          </p>
          <p className="text-xs text-ink-faint">
            {ask.answer.by ? `${ask.answer.by} · ` : ""}
            <LocalTime iso={ask.answer.at.toISOString()} />
          </p>
        </div>
      ) : (
        <p className="border-t hairline pt-4 text-sm text-ink-soft">
          Waiting for {askerName} to answer.{canDecide ? " You can still approve or decline below." : ""}
        </p>
      )}
    </Card>
  );
}
