import Link from "next/link";
import { notFound } from "next/navigation";
import { requireConsenter } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, StatusBadge, SectionTitle, Alert, Field, Input, Textarea, Select, ScoreRing } from "@/components/ui";
import { SubmitButton, ConfirmSubmit } from "@/components/form";
import { ErrorNote } from "@/components/error-note";
import {
  ScopeCard, FilesCard, NegotiationCard, ContactsCard, MessagesCard, TimelineCard, GrantCard,
  type FullRequest,
} from "@/components/request-view";
import {
  approveRequestAction, requestChangesAction, markPaidAction, denyRequestAction, consenterProceedAppRecordAction,
  shareContactsAction,
} from "../actions";
import { AgreementPanel } from "@/components/agreement-panel";
import { RevokePanel } from "@/components/takedown-panels";
import { ReportPanel } from "@/components/report-panel";
import { fmtDateTime } from "@/lib/utils";
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
  if (!request || request.consenterId !== consenter.id) notFound();

  const canDecide = member.role === "OWNER" || member.canApprove;
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

      <GrantCard request={request} />
      {request.grant && <RevokePanel request={request} canDecide={canDecide} />}

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

      {request.status === "LEGAL_AGREEMENT_PENDING" && <AgreementPanel request={request} side="consenter" />}

      {decidable && canDecide && (
        <Card strong className="space-y-5">
          <SectionTitle title="Decide" desc="Approve as asked, apply conditions, ask for changes, set a fee, or deny." />

          {/* Approve (with optional conditions) */}
          <form action={approveRequestAction} className="space-y-3">
            <input type="hidden" name="id" value={request.id} />
            <details className="group">
              <summary className="cursor-pointer text-sm font-medium text-ink-soft hover:text-ink">
                Conditions (optional) — reduce scope, cap duration, remove thumbnail, shorten validity
              </summary>
              <div className="mt-3 space-y-3 border-l-2 border-ink/10 pl-4">
                <div className="space-y-1.5">
                  <div className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Keep only these formats</div>
                  {selections.map((s) => (
                    <label key={s.formatId} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="keepFormat" value={s.formatId} defaultChecked className="size-4 accent-black" />
                      {s.platformName} → {s.formatName}
                      {s.durationSec ? (
                        <span className="flex items-center gap-1 text-xs text-ink-soft">
                          ({s.durationSec}s asked — cap at
                          <input type="number" name={`cap_${s.formatId}`} min={1} max={s.durationSec} placeholder={String(s.durationSec)} className="w-16 rounded-lg border border-ink/10 bg-white/70 px-1.5 py-0.5 text-xs" aria-label={`Cap duration for ${s.formatName}`} />
                          s)
                        </span>
                      ) : null}
                    </label>
                  ))}
                </div>
                {request.thumbnailUsed && (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="removeThumbnail" className="size-4 accent-black" />
                    Don&apos;t allow the thumbnail
                  </label>
                )}
                <Field label="Shorten validity to (end date)">
                  <Input name="validUntil" type="date" />
                </Field>
                <Field label="Written condition">
                  <Textarea name="conditionsNote" placeholder="e.g. No use in political contexts; credit @janecarter on screen." className="min-h-16" />
                </Field>
              </div>
            </details>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="proposeLegal" defaultChecked={request.isPaid && consenter.defaultRequireLegalAgreementForPaid} className="size-4 accent-black" />
              Also propose a legally binding agreement (requester must accept)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="shareContacts" defaultChecked={request.isPaid} className="size-4 accent-black" />
              Also share my contact details with {request.requester.displayName}
            </label>
            <p className="text-xs text-ink-faint">
              Leave it unticked to just approve. You can share your details later from this page.
            </p>
            <SubmitButton>Approve{request.isPaid ? " (deal agreed)" : ""}</SubmitButton>
          </form>

          <div className="border-t hairline" />

          {/* Request changes */}
          <form action={requestChangesAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="id" value={request.id} />
            <div className="min-w-56 flex-1">
              <Field label="Request changes" hint="Asks the requester to upload a revised file.">
                <Input name="note" placeholder="e.g. Trim the clip to 15 seconds and remove the last scene." required />
              </Field>
            </div>
            <SubmitButton variant="secondary">Request changes</SubmitButton>
          </form>

          {/* Mark as paid */}
          {request.status !== "IN_NEGOTIATION" && (
            <>
              <div className="border-t hairline" />
              <form action={markPaidAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={request.id} />
                <div className="w-28">
                  <Field label="Fee amount" required>
                    <Input name="amount" type="number" step="0.01" min="1" required placeholder="500" />
                  </Field>
                </div>
                <div className="w-24">
                  <Field label="Currency" required>
                    <Input name="currency" defaultValue="USD" maxLength={3} required />
                  </Field>
                </div>
                <div className="min-w-40 flex-1">
                  <Field label="Note">
                    <Input name="scopeNote" placeholder="optional" />
                  </Field>
                </div>
                <SubmitButton variant="secondary">Mark as paid — open negotiation</SubmitButton>
              </form>
            </>
          )}

          <div className="border-t hairline" />

          {/* Deny */}
          <form action={denyRequestAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="id" value={request.id} />
            <div className="w-56">
              <Field label="Denial reason">
                <Select name="reasonId" defaultValue="">
                  <option value="">— pick a reason (optional)</option>
                  {denialReasons.map((d) => (
                    <option key={d.id} value={d.id}>{d.label}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="min-w-40 flex-1">
              <Field label="Details">
                <Input name="freeText" placeholder="optional free text" />
              </Field>
            </div>
            <ConfirmSubmit confirm="Deny this request?" variant="danger">Deny</ConfirmSubmit>
          </form>
        </Card>
      )}

      {decidable && !canDecide && (
        <Alert>You can view this request, but approving/denying requires the approve permission.</Alert>
      )}

      <ContactsCard request={request} />
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
            <form action={shareContactsAction}>
              <input type="hidden" name="id" value={request.id} />
              <SubmitButton variant="secondary">Share my contact details</SubmitButton>
            </form>
            <p className="text-xs text-ink-faint">
              Which details are shared (email, phone, manager) is set in your profile settings.
            </p>
          </Card>
        )}
      <NegotiationCard request={request} side="consenter" />
      <div className="flex items-center justify-between">
        <ScoreRing score={request.requester.score} size={52} />
      </div>
      <ScopeCard request={request} />
      <FilesCard request={request} watermark />
      <MessagesCard request={request} side="consenter" />
      <ReportPanel request={request} side="consenter" />
      <TimelineCard request={request} />
    </div>
  );
}
