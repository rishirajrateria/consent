import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireRequester } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, StatusBadge, SectionTitle, Alert, Input } from "@/components/ui";
import { SubmitButton, ConfirmSubmit } from "@/components/form";
import { ErrorNote, SuccessNote } from "@/components/error-note";
import {
  ScopeCard, FilesCard, NegotiationCard, ContactsCard, TimelineCard, GrantCard, ViewOnlyNote,
  type FullRequest,
} from "@/components/request-view";
import { uploadRequestFileAction, withdrawRequestAction, proceedAppRecordAction } from "../actions";
import { AnswerAskForm, ClearAnswerDraft } from "./answer-ask-form";
import { AgreementPanel } from "@/components/agreement-panel";
import { TakedownRespondPanel } from "@/components/takedown-panels";
import { ReportPanel } from "@/components/report-panel";
import { splitConsentFee } from "@/lib/escrow";
import { fmtMoney } from "@/lib/utils";
import { LocalTime } from "@/components/local-time";
import { MeetingCard } from "@/components/meeting-card";
import { getSettings } from "@/lib/settings";
import { OPEN_STATUSES, requestWindows } from "@/lib/request-window";
import type { Prisma } from "@prisma/client";
import { Timer } from "lucide-react";

export const metadata = { title: "Request" };

const fileInputCls =
  "file:mr-3 file:rounded-lg file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white";

export default async function RequesterRequestDetail({ params, searchParams }: PageProps<"/r-panel/requests/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const { requester, session, member } = await requireRequester();
  // Viewer seats are read-only: they see everything but every form is left out.
  const canAct = member.role !== "VIEWER";
  const request = (await db.consentRequest.findUnique({
    where: { id },
    include: {
      consenter: true,
      requester: true,
      files: true,
      offers: { include: { byUser: true }, orderBy: { version: "desc" } },
      events: true,
      grant: true,
      agreement: { include: { template: true, signatures: { include: { user: true } } } },
      payments: true,
      reports: true,
    },
  })) as (FullRequest & { agreement: NonNullable<unknown> | null }) | null;
  if (!request || request.requesterId !== requester.id) notFound();
  if (request.status === "DRAFT") redirect(`/r-panel/requests/${id}/edit`);

  const canWithdraw = ["SUBMITTED", "PENDING", "CHANGES_REQUESTED"].includes(request.status);
  // While the owner's question is open, a new final file goes with the answer instead.
  const needsRaw =
    request.status === "APPROVED_IN_PRINCIPLE" ||
    (request.status === "AGREEMENT_MODE_PENDING" && !request.files.some((f) => f.kind === "RAW_CONTENT"));
  // The owner's consent request fee, if one was paid: without a yes, 80% comes back.
  const owner = request.consenter.displayName;
  const feeLine = request.payments.find(
    (p) => p.purpose === "CONSENT_PRICE" && (p.status === "PAID" || p.status === "REFUNDED")
  );
  const feePaid = feeLine ? Number(feeLine.amount.toString()) : 0;
  const feeBack = feeLine
    ? feeLine.refundedAmount != null
      ? Number(feeLine.refundedAmount.toString())
      : splitConsentFee(feePaid).refund
    : 0;
  const share = feePaid > 0 ? Math.round((feeBack / feePaid) * 100) : 0;
  const refundNote = feeLine
    ? `${share}% of ${owner}'s consent request fee (${fmtMoney(feeBack, feeLine.currency)}) is refunded to you${
        share < 100 ? `; Consent keeps ${100 - share}%` : ""
      }. The platform fee isn't refunded.`
    : "The platform fee isn't refunded.";
  // Closed after the owner's yes: their share was already released, so nothing comes back.
  const closedNote =
    feeLine?.status === "PAID"
      ? `${owner} had already said yes, so their consent request fee isn't refunded, and neither is the platform fee.`
      : refundNote;
  // An open request expires a set number of days after its last action from either side.
  const settings = await getSettings();
  const windows = OPEN_STATUSES.includes(request.status) ? await requestWindows([request], settings.slaDays) : null;
  const expiresAt = windows?.get(request.id)?.expiresAt ?? null;
  // The owner's open question. Without a logged one, the answer form still shows: never a dead end.
  const ask =
    request.status === "CHANGES_REQUESTED"
      ? (latestAsk(request.events) ?? { question: "", askedAt: request.updatedAt, askedBy: null })
      : null;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        kicker={`Request #${request.number}`}
        title={request.consenter.displayName}
        desc={
          expiresAt ? (
            <span className="flex items-center gap-1.5">
              <Timer className="size-3.5 shrink-0" aria-hidden />
              <span>
                Expires <LocalTime iso={expiresAt.toISOString()} /> unless someone acts
              </span>
            </span>
          ) : undefined
        }
        action={<StatusBadge status={request.status} />}
      />
      <ErrorNote error={sp.error as string | undefined} />
      {sp.submitted && <SuccessNote msg="Request submitted — the consenter has been notified." />}
      {sp.answered && request.status !== "CHANGES_REQUESTED" && (
        <>
          <SuccessNote msg={`Answer sent. It's back with ${owner}.`} />
          <ClearAnswerDraft requestId={request.id} />
        </>
      )}

      {request.status === "DENIED" && (
        <Alert tone="warn">
          <strong>Denied.</strong> {request.denialReason ?? "No reason given."} {refundNote} You may
          submit a fresh request.
        </Alert>
      )}
      {request.status === "EXPIRED_NO_RESPONSE" && (
        <Alert tone="warn">
          {owner} did not respond within the window. {refundNote} You can submit a fresh
          request any time.
        </Alert>
      )}
      {request.status === "CLOSED" && (
        <Alert tone="warn">
          {request.closedReason?.startsWith("No action for")
            ? `This request closed after ${request.closedReason.charAt(0).toLowerCase()}${request.closedReason.slice(1)}.`
            : "This request was closed without a deal."}{" "}
          {closedNote} To try again, raise a new request.{" "}
          <Link href={`/r-panel/new?consenter=${request.consenter.slug}`} className="font-medium underline underline-offset-4">
            Raise a new request
          </Link>
        </Alert>
      )}
      {request.status === "WITHDRAWN" && (
        <Alert tone="warn">This request was withdrawn. {refundNote}</Alert>
      )}
      {request.status === "CHANGES_REQUESTED" && (
        <Alert tone="warn">
          {owner} asked you something.{" "}
          {canAct ? (
            <>
              <a href="#ask" className="font-medium underline underline-offset-4">Answer it below</a> to send the
              request back to them.
            </>
          ) : (
            <>
              <a href="#ask" className="font-medium underline underline-offset-4">See their question below</a>.
            </>
          )}
        </Alert>
      )}

      {/* Outcome first when there is one, then the request itself, and what you
          need to do last. */}
      <GrantCard request={request} />

      <ScopeCard request={request} />
      <FilesCard request={request} />
      <ContactsCard request={request} />
      <TimelineCard request={request} expiresAt={expiresAt} />
      <ReportPanel request={request} side="requester" canAct={canAct} />

      {/* ── Your next steps ── */}
      <TakedownRespondPanel request={request} canAct={canAct} />
      <NegotiationCard request={request} side="requester" canAct={canAct} />
      {!request.contactsRevealed && request.isPaid && request.agreedAmount && (
        <Alert>
          {owner} hasn&apos;t shared contact details yet. You&apos;re notified when they do, so you can
          settle the agreed fee directly with them.
        </Alert>
      )}

      {ask && (
        <AnswerAskCard
          request={request}
          ask={ask}
          canAct={canAct}
          minPlanChars={settings.minCreativePlanChars}
          maxUploadMb={settings.maxUploadMb}
        />
      )}

      {request.status === "APPROVED_IN_PRINCIPLE" && (
        <Alert>
          <strong>Approved in principle.</strong>{" "}
          {canAct
            ? "Upload the raw final content file below — the certificate is issued once it's in place (approval binds to its hash)."
            : "The certificate is issued once a teammate with edit access uploads the raw final content file (approval binds to its hash)."}
        </Alert>
      )}

      {needsRaw && canAct && (
        <Card className="space-y-3">
          <SectionTitle title="Upload final content file" desc="The raw final content, exactly as it will be published. Approval binds to this exact file." />
          <form action={uploadRequestFileAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="id" value={request.id} />
            <input type="hidden" name="kind" value="RAW_CONTENT" />
            <Input name="file" type="file" required className={fileInputCls} aria-label="Upload final content" />
            <SubmitButton variant="secondary" size="sm">Upload</SubmitButton>
          </form>
        </Card>
      )}

      {request.status === "AGREEMENT_MODE_PENDING" && (
        <Card strong className="space-y-3">
          <SectionTitle
            title="Choose the agreement mode"
            desc="How formal should this consent be? The in-app record is the default; a legally binding agreement applies only if both sides accept it."
          />
          {canAct ? (
            <div className="flex flex-wrap gap-2">
              <AgreementPanel request={request} side="requester" proposeOnly />
              <form action={proceedAppRecordAction}>
                <input type="hidden" name="id" value={request.id} />
                <SubmitButton>Continue with Consent-app record</SubmitButton>
              </form>
            </div>
          ) : (
            <ViewOnlyNote />
          )}
        </Card>
      )}

      {request.status === "LEGAL_AGREEMENT_PENDING" && (
        <AgreementPanel request={request} side="requester" canAct={canAct} />
      )}

      <MeetingCard request={request} side="requester" canAct={canAct} />

      {canWithdraw && canAct && (
        <form action={withdrawRequestAction}>
          <input type="hidden" name="id" value={request.id} />
          <ConfirmSubmit confirm={`Withdraw this request? ${refundNote}`} variant="ghost" size="sm">
            Withdraw request
          </ConfirmSubmit>
        </form>
      )}
      <p className="text-xs text-ink-faint">
        Signed in as {session.user.name}. All actions are logged.
      </p>
    </div>
  );
}

type Ask = { question: string; askedAt: Date; askedBy: string | null };

/** The owner's latest Ask: their question or the change they want. */
function latestAsk(events: FullRequest["events"]): Ask | null {
  const asked = [...events]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .find((e) => e.type === "changes_requested");
  if (!asked) return null;
  const d = asked.detail as Prisma.JsonObject | null;
  return {
    question: typeof d?.note === "string" ? d.note : "",
    askedAt: asked.createdAt,
    askedBy: asked.actorName,
  };
}

/**
 * The owner's question and the written answer to it. The plan and a new final
 * file can go with the answer; sending it puts the request back with the owner.
 */
function AnswerAskCard({
  request,
  ask,
  canAct,
  minPlanChars,
  maxUploadMb,
}: {
  request: FullRequest;
  ask: Ask;
  canAct: boolean;
  minPlanChars: number;
  maxUploadMb: number;
}) {
  const owner = request.consenter.displayName;
  const hasRaw = request.files.some((f) => f.kind === "RAW_CONTENT");
  return (
    <Card strong className="space-y-4" id="ask">
      <SectionTitle title={`Answer ${owner}`} desc={`Sending your answer puts the request back with ${owner} to decide.`} />
      <div className="glass-subtle space-y-1 px-4 py-3">
        <p className="text-sm">
          <span className="font-semibold">{owner} asked:</span>{" "}
          <span className="whitespace-pre-wrap break-words">{ask.question || "No question written."}</span>
        </p>
        <p className="text-xs text-ink-faint">
          {ask.askedBy ? `${ask.askedBy} · ` : ""}
          <LocalTime iso={ask.askedAt.toISOString()} />
        </p>
      </div>
      {canAct ? (
        <AnswerAskForm
          requestId={request.id}
          askedAt={ask.askedAt.toISOString()}
          creativePlan={request.creativePlan}
          minPlanChars={minPlanChars}
          maxUploadMb={maxUploadMb}
          hasRaw={hasRaw}
        />
      ) : (
        <ViewOnlyNote>You have view-only access. A teammate with edit access answers it.</ViewOnlyNote>
      )}
    </Card>
  );
}
