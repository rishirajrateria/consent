import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireRequester } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, StatusBadge, SectionTitle, Alert, Input } from "@/components/ui";
import { SubmitButton, ConfirmSubmit } from "@/components/form";
import { ErrorNote, SuccessNote } from "@/components/error-note";
import {
  ScopeCard, FilesCard, TimelineCard, GrantCard, ViewOnlyNote, MoneyRows, MoneyRow, fullRequestInclude,
  type FullRequest,
} from "@/components/request-view";
import { issueCertificateAction, uploadRequestFileAction, withdrawRequestAction } from "../actions";
import { AnswerAskForm, ClearAnswerDraft } from "./answer-ask-form";
import { TakedownRespondPanel } from "@/components/takedown-panels";
import { ReportPanel } from "@/components/report-panel";
import { splitConsentFee } from "@/lib/escrow";
import { PLATFORM_PCT } from "@/lib/platform-fee";
import { fmtDate, fmtMoney } from "@/lib/utils";
import { LocalTime } from "@/components/local-time";
import { getSettings } from "@/lib/settings";
import { OPEN_STATUSES, requestWindows } from "@/lib/request-window";
import type { EarningStatus, Payment, Prisma } from "@prisma/client";
import { Timer } from "lucide-react";
import { OWNER_PCT, REFUND_PCT, CONSENT_PCT } from "@/app/(app)/c-panel/requests/fee-split";
import { openAsRightProfile, pathWithQuery } from "@/app/(app)/requests/open-as";

export const metadata = { title: "Request" };

const fileInputCls =
  "file:mr-3 file:rounded-lg file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white";

const WITHDRAWABLE = ["SUBMITTED", "PENDING", "CHANGES_REQUESTED"];

const num = (v: { toString(): string } | null | undefined) => (v == null ? 0 : Number(v.toString()));

export default async function SentRequestPage({ params, searchParams }: PageProps<"/r-panel/requests/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const { requester, session, member } = await requireRequester();
  const request = await db.consentRequest.findUnique({ where: { id }, include: fullRequestInclude });
  if (!request) notFound();
  // Sent from another profile this person is on (switch to it), or sent to
  // them (open the received view).
  if (request.requesterId !== requester.id)
    await openAsRightProfile(session.userId, request, "sent", pathWithQuery(`/r-panel/requests/${id}`, sp));
  if (request.status === "DRAFT") redirect(`/r-panel/requests/${id}/edit`);

  // Viewer seats are read-only: they see everything but every form is left out.
  const canAct = member.role !== "VIEWER";
  const owner = request.consenter.displayName;
  const [settings, earning] = await Promise.all([
    getSettings(),
    db.earningEntry.findUnique({ where: { requestId: id }, select: { status: true } }),
  ]);

  // What was charged. A free ask has no lines at all. A request that expired
  // unanswered keeps its platform fee as FORFEITED: it was still paid.
  const charged = request.payments.filter((p) => ["PAID", "REFUNDED", "FORFEITED"].includes(p.status));
  const feeLine = charged.find((p) => p.purpose === "CONSENT_PRICE") ?? null;
  const platformLine = charged.find((p) => p.purpose === "PER_REQUEST") ?? null;
  const feePaid = num(feeLine?.amount);
  const feeBack = feeLine ? (feeLine.refundedAmount != null ? num(feeLine.refundedAmount) : splitConsentFee(feePaid).refund) : 0;
  const backShare = feePaid > 0 ? Math.round((feeBack / feePaid) * 100) : 0;
  // Said on every ending without a yes.
  const refundNote = feeLine
    ? `${backShare}% of ${owner}'s consent request fee (${fmtMoney(feeBack, feeLine.currency)}) is refunded to you${
        backShare < 100 ? `; Consent keeps ${100 - backShare}%` : ""
      }. The platform fee isn't refunded.`
    : platformLine
      ? "The platform fee isn't refunded."
      : "";
  // Closed after their yes: their share was already released, so nothing comes back.
  const released = earning?.status === "PENDING" || earning?.status === "SETTLED";
  const closedNote = released
    ? `${owner} had already said yes, so the consent request fee isn't refunded, and neither is the platform fee.`
    : refundNote;
  const askAgain = `/c/${request.consenter.slug}`;

  // An open request expires a set number of days after its last action from either side.
  const windows = OPEN_STATUSES.includes(request.status) ? await requestWindows([request], settings.slaDays) : null;
  const expiresAt = windows?.get(request.id)?.expiresAt ?? null;
  // The open question. Without a logged one, the answer form still shows: never a dead end.
  const ask =
    request.status === "CHANGES_REQUESTED"
      ? (latestAsk(request.events) ?? { question: "", askedAt: request.updatedAt, askedBy: null })
      : null;
  const needsRaw = request.status === "APPROVED_IN_PRINCIPLE";
  // The final file is already in (uploaded as the yes came in): the certificate is owed, not another upload.
  const hasRaw = request.files.some((f) => f.kind === "RAW_CONTENT");
  const askAgainLink = (
    <Link href={askAgain} className="font-medium underline underline-offset-4">
      Ask {owner} again
    </Link>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        kicker={`Request #${request.number}`}
        title={owner}
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
        action={
          <div className="flex flex-wrap items-center gap-2">
            {/* Taking it back sits up here, away from the step you take next. */}
            {WITHDRAWABLE.includes(request.status) && canAct && (
              <form action={withdrawRequestAction}>
                <input type="hidden" name="id" value={request.id} />
                <ConfirmSubmit
                  confirm={`Withdraw this request?${refundNote ? ` ${refundNote}` : ""}`}
                  variant="ghost"
                  size="sm"
                >
                  Withdraw request
                </ConfirmSubmit>
              </form>
            )}
            <StatusBadge status={request.status} />
          </div>
        }
      />
      <ErrorNote error={sp.error as string | undefined} />
      {sp.submitted && <SuccessNote msg={`Request sent. ${owner} has been told.`} />}
      {sp.certified && request.grant && (
        <SuccessNote
          msg={
            sp.certified === "existing"
              ? "Your final content file was already uploaded, so your certificate was issued for that file."
              : sp.certified === "ready"
                ? "Your certificate is ready."
                : "Final file uploaded. Your certificate is ready."
          }
        />
      )}
      {sp.answered && request.status !== "CHANGES_REQUESTED" && (
        <>
          <SuccessNote msg={`Answer sent. It's back with ${owner}.`} />
          <ClearAnswerDraft requestId={request.id} />
        </>
      )}

      {request.status === "DENIED" && (
        <Alert tone="warn">
          <strong>{owner} said no.</strong> {request.denialReason ?? "No reason given."} {refundNote} {askAgainLink}
        </Alert>
      )}
      {request.status === "EXPIRED_NO_RESPONSE" && (
        <Alert tone="warn">
          {owner} did not respond within the window. {refundNote} {askAgainLink}
        </Alert>
      )}
      {request.status === "CLOSED" && (
        <Alert tone="warn">
          {request.closedReason?.startsWith("No action for")
            ? `This request closed after ${request.closedReason.charAt(0).toLowerCase()}${request.closedReason.slice(1)}.`
            : "This request was closed."}{" "}
          {closedNote} {askAgainLink}
        </Alert>
      )}
      {request.status === "WITHDRAWN" && (
        <Alert tone="warn">
          You withdrew this request. {refundNote} {askAgainLink}
        </Alert>
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
      {needsRaw && (
        <Alert>
          <strong>{owner} said yes.</strong>{" "}
          {hasRaw ? (
            canAct ? (
              <>
                Your final content file is in.{" "}
                <a href="#final-file" className="font-medium underline underline-offset-4">
                  Get your certificate
                </a>
                .
              </>
            ) : (
              "Your final content file is in. A teammate with edit access gets the certificate."
            )
          ) : canAct ? (
            <>
              <a href="#final-file" className="font-medium underline underline-offset-4">
                Upload the final content file
              </a>{" "}
              to get your certificate.
            </>
          ) : (
            "The certificate is issued once a teammate with edit access uploads the final content file."
          )}
        </Alert>
      )}

      {/* Outcome first when there is one, then the request itself, and what you
          need to do last. */}
      <GrantCard request={request} />

      <ScopeCard request={request} />
      <FilesCard request={request} />
      <PaidCard owner={owner} fee={feeLine} platform={platformLine} earning={earning?.status ?? null} />
      <TimelineCard request={request} expiresAt={expiresAt} />
      <ReportPanel request={request} side="requester" canAct={canAct} />

      {/* ── Your next steps ── */}
      <TakedownRespondPanel request={request} canAct={canAct} />

      {ask && (
        <AnswerAskCard
          request={request}
          ask={ask}
          canAct={canAct}
          minPlanChars={settings.minCreativePlanChars}
          maxUploadMb={settings.maxUploadMb}
        />
      )}

      {needsRaw && hasRaw && (
        <Card strong className="space-y-3" id="final-file">
          <SectionTitle
            title="Get your certificate"
            desc="Your final content file is already uploaded. The certificate is locked to that exact file."
          />
          {canAct ? (
            <form action={issueCertificateAction}>
              <input type="hidden" name="id" value={request.id} />
              <SubmitButton size="sm">Get certificate</SubmitButton>
            </form>
          ) : (
            <ViewOnlyNote>You have view-only access. A teammate with edit access gets it.</ViewOnlyNote>
          )}
        </Card>
      )}

      {needsRaw && !hasRaw && (
        <Card strong className="space-y-3" id="final-file">
          <SectionTitle
            title="Upload the final content file to get your certificate"
            desc="The raw final content, exactly as it will be published. The certificate is locked to this exact file."
          />
          {canAct ? (
            <form action={uploadRequestFileAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="id" value={request.id} />
              <input type="hidden" name="kind" value="RAW_CONTENT" />
              <Input name="file" type="file" required className={fileInputCls} aria-label="Final content file" />
              <SubmitButton size="sm">Upload and get certificate</SubmitButton>
            </form>
          ) : (
            <ViewOnlyNote>You have view-only access. A teammate with edit access uploads it.</ViewOnlyNote>
          )}
        </Card>
      )}

      <p className="text-xs text-ink-faint">
        Signed in as {session.user.name}. All actions are logged.
      </p>
    </div>
  );
}

/**
 * "What you paid": the consent request fee, the platform fee and the total,
 * each amount on one line with its note under it. A free ask paid nothing.
 */
function PaidCard({
  owner,
  fee,
  platform,
  earning,
}: {
  owner: string;
  fee: Payment | null;
  platform: Payment | null;
  earning: EarningStatus | null;
}) {
  if (!fee && !platform) {
    return (
      <Card className="space-y-1">
        <SectionTitle title="What you paid" />
        <p className="text-sm text-ink-soft">Free to ask. Nothing was charged.</p>
      </Card>
    );
  }
  const feeAmount = num(fee?.amount);
  const back = fee ? (fee.refundedAmount != null ? num(fee.refundedAmount) : splitConsentFee(feeAmount).refund) : 0;
  const backShare = feeAmount > 0 ? Math.round((back / feeAmount) * 100) : 0;
  const refunded = fee?.status === "REFUNDED";
  const feeNote = !fee
    ? null
    : refunded
      ? `${backShare}% (${fmtMoney(back, fee.currency)}) was refunded to you${fee.refundedAt ? ` on ${fmtDate(fee.refundedAt)}` : ""}. Consent keeps ${100 - backShare}%.`
      : earning === "PENDING" || earning === "SETTLED"
        ? `${owner} said yes, so ${OWNER_PCT} went to them. Consent keeps ${CONSENT_PCT}.`
        : `Held until ${owner} answers. If they say yes, ${OWNER_PCT} goes to them. If not, ${REFUND_PCT} (${fmtMoney(back, fee.currency)}) comes back to you. Consent keeps ${CONSENT_PCT}.`;
  // The platform fee line is charged with its tax and after any coupon. Shown
  // as before paying: the 20% itself, then the coupon and the tax, each on its own row.
  const tax = num(platform?.tax);
  const discount = num(platform?.discount);
  const platformFee = Math.round((num(platform?.amount) - tax + discount) * 100) / 100;
  // Both lines are charged in the consent request fee's currency; older rows may differ.
  const lines = [fee, platform].filter((p): p is Payment => !!p);
  const sameCurrency = lines.every((p) => p.currency === lines[0].currency);
  const total = sameCurrency
    ? fmtMoney(lines.reduce((sum, p) => sum + num(p.amount), 0), lines[0].currency)
    : lines.map((p) => fmtMoney(p.amount.toString(), p.currency)).join(" + ");
  return (
    <Card className="space-y-2">
      <SectionTitle title="What you paid" />
      <MoneyRows>
        {fee && <MoneyRow label="Consent request fee" amount={fmtMoney(feeAmount, fee.currency)} note={feeNote} />}
        {platform && (
          <MoneyRow
            label={`Platform fee (${PLATFORM_PCT})`}
            amount={fmtMoney(platformFee, platform.currency)}
            note={`${PLATFORM_PCT} of the consent request fee. Never refunded.`}
          />
        )}
        {platform && discount > 0 && (
          <MoneyRow
            label={`Discount${platform.couponCode ? ` (${platform.couponCode})` : ""}`}
            amount={`−${fmtMoney(discount, platform.currency)}`}
            note="Off the platform fee only."
          />
        )}
        {platform && tax > 0 && (
          <MoneyRow label={platform.taxLabel ?? "Tax"} amount={fmtMoney(tax, platform.currency)} note="On the platform fee only." />
        )}
        <MoneyRow
          label="Total paid"
          amount={total}
          note={refunded && fee ? `${fmtMoney(back, fee.currency)} of it came back to you.` : null}
          strong
        />
      </MoneyRows>
    </Card>
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
