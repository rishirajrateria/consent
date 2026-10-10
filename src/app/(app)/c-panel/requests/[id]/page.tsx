import Link from "next/link";
import { notFound } from "next/navigation";
import { requireConsenter } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, StatusBadge, SectionTitle, Alert, ScoreRing } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { ErrorNote } from "@/components/error-note";
import {
  ScopeCard, FilesCard, NegotiationCard, ContactsCard, MessagesCard, TimelineCard, GrantCard,
  type FullRequest,
} from "@/components/request-view";
import { consenterProceedAppRecordAction, shareContactsAction } from "../actions";
import { DecisionPanel } from "./decision-panel";
import { AgreementPanel } from "@/components/agreement-panel";
import { RevokePanel } from "@/components/takedown-panels";
import { ReportPanel } from "@/components/report-panel";
import { fmtDateTime, fmtMoney, titleCase } from "@/lib/utils";
import { ChannelLinks } from "@/components/channel-links";
import { canSendOffer } from "@/lib/negotiation";
import type { Selection } from "@/lib/rules";
import { Timer } from "lucide-react";

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
      messages: { include: { sender: true } },
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
  const denialReasons = await db.denialReason.findMany({ where: { active: true } });

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
            {request.status === "PENDING" && request.slaExpiresAt && (
              <span className="flex items-center gap-1 text-ink-soft">
                <Timer className="size-3.5" aria-hidden /> auto-expires {fmtDateTime(request.slaExpiresAt)}
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
      <MessagesCard request={request} side="consenter" />
      <ContactsCard request={request} />
      <TimelineCard request={request} />
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
          proposeLegalByDefault={request.isPaid && consenter.defaultRequireLegalAgreementForPaid}
          denialReasons={denialReasons.map((d) => ({ id: d.id, label: d.label }))}
        />
      )}

      {decidable && !canDecide && (
        <Alert>You can view this request, but approving/denying requires the approve permission.</Alert>
      )}

      {!request.contactsRevealed &&
        ["DEAL_AGREED", "AGREEMENT_MODE_PENDING", "LEGAL_AGREEMENT_PENDING", "APPROVED_IN_PRINCIPLE", "APPROVED"].includes(request.status) &&
        (member.role === "OWNER" || member.canApprove || member.canNegotiate) && (
          <Card className="space-y-3">
            <SectionTitle
              title="Contact details not shared"
              desc={
                request.isPaid
                  ? `You approved without sharing your contact details. ${request.requester.displayName} needs a way to pay the agreed fee — share your details, or arrange it in messages.`
                  : `You approved without sharing your contact details. Share them if you'd like ${request.requester.displayName} to be able to reach you directly.`
              }
            />
            <p className="text-xs text-ink-faint">
              Which details are shared (email, phone, manager) is set in your profile settings.
            </p>
            <form action={shareContactsAction}>
              <input type="hidden" name="id" value={request.id} />
              <SubmitButton variant="secondary">Share my contact details</SubmitButton>
            </form>
          </Card>
        )}

      {request.grant && <RevokePanel request={request} canDecide={canDecide} />}
    </div>
  );
}
