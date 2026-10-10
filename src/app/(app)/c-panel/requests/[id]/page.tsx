import Link from "next/link";
import { notFound } from "next/navigation";
import { requireConsenter } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, StatusBadge, SectionTitle, Alert, ScoreRing, ButtonLink } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { ErrorNote } from "@/components/error-note";
import {
  ScopeCard, FilesCard, NegotiationCard, ContactsCard, TimelineCard, GrantCard,
  type FullRequest,
} from "@/components/request-view";
import { LocalTime } from "@/components/local-time";
import { MeetingCard } from "@/components/meeting-card";
import { consenterProceedAppRecordAction, shareContactsAction } from "../actions";
import { DecisionPanel } from "./decision-panel";
import { ContactChoices } from "./contact-choices";
import { contactChoices } from "../contact-fields";
import { AgreementPanel } from "@/components/agreement-panel";
import { RevokePanel } from "@/components/takedown-panels";
import { ReportPanel } from "@/components/report-panel";
import { fmtDate, fmtMoney, titleCase } from "@/lib/utils";
import { ChannelLinks } from "@/components/channel-links";
import { canSendOffer } from "@/lib/negotiation";
import { getSettings } from "@/lib/settings";
import { OPEN_STATUSES, requestWindows } from "@/lib/request-window";
import type { Selection } from "@/lib/rules";
import type { Prisma } from "@prisma/client";
import { Timer } from "lucide-react";
import {
  OWNER_PCT, REFUND_PCT, CONSENT_PCT, grossOf, refundedOf, shareOf, nextPayoutDay, fmtPayoutDay,
} from "../fee-split";

const SHAREABLE = ["DEAL_AGREED", "AGREEMENT_MODE_PENDING", "LEGAL_AGREEMENT_PENDING", "APPROVED_IN_PRINCIPLE", "APPROVED"];

export const metadata = { title: "Review request" };

export default async function ConsenterRequestDetail({ params, searchParams }: PageProps<"/c-panel/requests/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const { consenter, member } = await requireConsenter();
  const request = (await db.consentRequest.findUnique({
    where: { id },
    include: {
      consenter: true,
      requester: true,
      files: true,
      offers: { include: { byUser: true }, orderBy: { version: "desc" } },
      events: true,
      grant: { include: { takedowns: true } },
      agreement: { include: { template: true, signatures: { include: { user: true } } } },
      payments: true,
      reports: true,
    },
  })) as FullRequest | null;
  // A request the requester hasn't sent yet (an unpaid draft) isn't the owner's to see.
  if (!request || request.consenterId !== consenter.id || !request.submittedAt) notFound();

  const canDecide = member.role === "OWNER" || member.canApprove;
  const canNegotiate = member.role === "OWNER" || member.canNegotiate;
  // Sharing contact details and arranging a meeting: anyone who can answer or negotiate.
  const canReach = canDecide || canNegotiate;
  // A new fee counts as a counter-offer once there are offers; each side has 3.
  const canSetFee = canNegotiate && canSendOffer(request.offers, "consenter");
  // Offers are ordered newest first; only the latest one can still be open.
  const latestOffer = request.offers[0];
  const openOffer =
    latestOffer?.status === "OPEN"
      ? {
          id: latestOffer.id,
          label: fmtMoney(latestOffer.amount.toString(), latestOffer.currency),
          note: latestOffer.scopeNote,
          fromRequester: latestOffer.bySide === "requester",
        }
      : null;
  const decidable = ["PENDING", "IN_NEGOTIATION", "CHANGES_REQUESTED"].includes(request.status);
  const selections = request.selections as Selection[];
  const isOpen = OPEN_STATUSES.includes(request.status);
  const [denialReasons, earning, settings] = await Promise.all([
    db.denialReason.findMany({ where: { active: true } }),
    db.earningEntry.findUnique({ where: { requestId: request.id }, include: { payment: true, settlement: true } }),
    getSettings(),
  ]);
  const [lastPayout, windows, liveMeeting] = await Promise.all([
    earning?.status === "PENDING"
      ? db.settlement.findFirst({ where: { consenterId: consenter.id }, orderBy: { createdAt: "desc" } })
      : null,
    // An open request expires a set number of days after its last action from either side.
    isOpen ? requestWindows([request], settings.slaDays) : null,
    // One meeting per request: with one set, approving can't add another.
    db.requestMeeting.findFirst({ where: { requestId: id, status: "SCHEDULED" }, select: { id: true } }),
  ]);
  const expiresAt = windows?.get(request.id)?.expiresAt ?? null;
  const ask = latestAsk(request.events);
  const choices = contactChoices(request.consenter);
  // The same rule DecisionPanel uses: the owner's own open fee waits for the
  // requester, and accepting the requester's fee needs the negotiate permission.
  const approveOffered = !(openOffer && !openOffer.fromRequester) && (!openOffer?.fromRequester || canNegotiate);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        kicker={`Request #${request.number}`}
        title={request.requester.displayName}
        desc={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Link href={`/r/${request.requester.slug}`} className="underline underline-offset-4">Public profile</Link>
            <span className="flex items-center gap-1.5">
              Requester score <strong>{request.requester.score}</strong>
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

      <Card className="space-y-4">
        <SectionTitle title="Who's asking" />
        <div className="flex items-center gap-4">
          <ScoreRing score={request.requester.score} size={52} />
          <div className="min-w-0">
            <Link href={`/r/${request.requester.slug}`} className="font-semibold underline-offset-4 hover:underline">
              {request.requester.displayName}
            </Link>
            <div className="text-xs text-ink-faint">
              {titleCase(request.requester.type)} · {request.requester.country}
            </div>
          </div>
        </div>
        {request.requester.description && (
          <p className="text-sm leading-relaxed text-ink-soft">{request.requester.description}</p>
        )}
        <ChannelLinks channels={request.requester.channels} owner={request.requester.displayName} />
      </Card>
      <ScopeCard request={request} />
      <FilesCard request={request} watermark />
      <ContactsCard request={request} />
      {/* A meeting either side set up is part of what the owner reviews before deciding. */}
      <MeetingCard request={request} side="consenter" canAct={canReach} />
      {earning && (
        <ConsentFeeCard
          earning={earning}
          requesterName={request.requester.displayName}
          payoutDay={fmtPayoutDay(nextPayoutDay(lastPayout?.createdAt))}
        />
      )}
      <TimelineCard request={request} expiresAt={expiresAt} />
      <ReportPanel request={request} side="consenter" />

      {/* ── Decisions and actions ── */}
      <NegotiationCard request={request} side="consenter" canAct={canNegotiate} canApprove={canDecide} />

      {request.status === "AGREEMENT_MODE_PENDING" && (
        <Card strong className="space-y-3">
          <SectionTitle
            title="Agreement mode"
            desc="Approved. Waiting for the agreement mode: the requester can continue with the default in-app record, or either side proposes a legally binding agreement."
          />
          {canDecide && (
            <div className="flex flex-wrap gap-2">
              <form action={consenterProceedAppRecordAction}>
                <input type="hidden" name="id" value={request.id} />
                <SubmitButton variant="secondary">Issue with Consent-app record now</SubmitButton>
              </form>
              <AgreementPanel request={request} side="consenter" proposeOnly />
            </div>
          )}
        </Card>
      )}

      {request.status === "LEGAL_AGREEMENT_PENDING" && (
        <AgreementPanel request={request} side="consenter" canAct={canDecide} />
      )}

      {/* What the owner asked and what came back, right above the decision. */}
      {decidable && ask && (
        <AskSummary
          ask={ask}
          requesterName={request.requester.displayName}
          canDecide={canDecide}
          approveOffered={approveOffered}
        />
      )}

      {decidable && canDecide && (
        <DecisionPanel
          requestId={request.id}
          requesterName={request.requester.displayName}
          selections={selections}
          thumbnailUsed={request.thumbnailUsed}
          isPaid={request.isPaid}
          inNegotiation={request.status === "IN_NEGOTIATION"}
          openOffer={openOffer}
          canNegotiate={canNegotiate}
          canSetFee={canSetFee}
          canAsk={request.status !== "CHANGES_REQUESTED"}
          contactChoices={choices}
          hasMeeting={!!liveMeeting}
          proposeLegalByDefault={request.isPaid && consenter.defaultRequireLegalAgreementForPaid}
          denialReasons={denialReasons.map((d) => ({ id: d.id, label: d.label }))}
        />
      )}

      {decidable && !canDecide && (
        <Alert>You can view this request, but approving/denying requires the approve permission.</Alert>
      )}

      {!request.contactsRevealed && SHAREABLE.includes(request.status) && canReach && (
        <Card className="space-y-3">
          <SectionTitle
            title="Contact details not shared"
            desc={
              request.isPaid
                ? `You approved without sharing your contact details. Share them so ${request.requester.displayName} can pay the agreed fee.`
                : `You approved without sharing your contact details. Share them so ${request.requester.displayName} can reach you directly.`
            }
          />
          {choices.some((c) => c.value) ? (
            <form action={shareContactsAction} className="space-y-3">
              <input type="hidden" name="id" value={request.id} />
              <ContactChoices choices={choices} />
              <p className="text-xs text-ink-faint">Only the details you tick are shared.</p>
              <SubmitButton variant="secondary">Share my contact details</SubmitButton>
            </form>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-ink-soft">You haven&apos;t added any contact details yet.</p>
              <ButtonLink href="/c-panel/settings" variant="secondary">Add them in settings</ButtonLink>
            </div>
          )}
        </Card>
      )}

      {request.grant && <RevokePanel request={request} canDecide={canDecide} />}
    </div>
  );
}

/** What the requester paid to ask, and where the owner's share of it stands. */
function ConsentFeeCard({
  earning: e,
  requesterName,
  payoutDay,
}: {
  earning: Prisma.EarningEntryGetPayload<{ include: { payment: true; settlement: true } }>;
  requesterName: string;
  payoutDay: string;
}) {
  const gross = grossOf(e);
  const share = Number(e.amount.toString());
  const refunded = e.status === "REFUNDED" ? refundedOf(e) : 0;
  const [line, amount] =
    e.status === "HELD"
      ? [`You'd get (${shareOf(share, gross)}) if you say yes`, share]
      : e.status === "PENDING"
        ? [`Yours (${shareOf(share, gross)}) · paid out ${payoutDay}`, share]
        : e.status === "SETTLED"
          ? [`Paid out to you (${shareOf(share, gross)})${e.settlement ? ` · ${fmtDate(e.settlement.createdAt)}` : ""}`, share]
          : e.status === "REFUNDED"
            ? [`Refunded to ${requesterName} (${shareOf(refunded, gross)})`, refunded]
            : ["Not paid to you", share];
  return (
    <Card className="space-y-2">
      <SectionTitle
        title="Money"
        desc={`The consent request fee is held until you answer. If you say yes, ${OWNER_PCT} is yours, paid out on Fridays. If you decline, or the request ends without a yes, ${REFUND_PCT} goes back to them. Consent keeps ${CONSENT_PCT}.`}
      />
      <dl className="text-sm">
        <div className="flex items-start justify-between gap-4 py-2">
          <dt className="min-w-0 text-ink-soft">Consent request fee</dt>
          <dd className="shrink-0 tabular-nums">{fmtMoney(gross, e.currency)}</dd>
        </div>
        <div className="flex items-start justify-between gap-4 border-t hairline py-2">
          <dt className="min-w-0">{line}</dt>
          <dd className="shrink-0 font-semibold tabular-nums">{fmtMoney(amount, e.currency)}</dd>
        </div>
      </dl>
    </Card>
  );
}

type Ask = {
  question: string;
  askedAt: Date;
  askedBy: string | null;
  answer: { text: string; at: Date; by: string | null } | null;
};

/** The owner's latest Ask and the requester's written answer to it, if any. */
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

/** "You asked … / They answered …", shown right above the owner's decision. */
function AskSummary({
  ask,
  requesterName,
  canDecide,
  approveOffered,
}: {
  ask: Ask;
  requesterName: string;
  canDecide: boolean;
  /** Whether Approve is one of the answers below. */
  approveOffered: boolean;
}) {
  return (
    <Card className="space-y-4" id="ask">
      <div className="space-y-1">
        <p className="text-sm">
          <span className="font-semibold">You asked:</span>{" "}
          <span className="whitespace-pre-wrap">{ask.question}</span>
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
            <span className="whitespace-pre-wrap">{ask.answer.text}</span>
          </p>
          <p className="text-xs text-ink-faint">
            {ask.answer.by ? `${ask.answer.by} · ` : ""}
            <LocalTime iso={ask.answer.at.toISOString()} />
          </p>
        </div>
      ) : (
        <p className="border-t hairline pt-4 text-sm text-ink-soft">
          Waiting for {requesterName} to answer.
          {canDecide ? (approveOffered ? " You can still approve or decline below." : " You can still answer below.") : ""}
        </p>
      )}
    </Card>
  );
}
