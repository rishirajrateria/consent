import { notFound, redirect } from "next/navigation";
import { requireRequester } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, StatusBadge, SectionTitle, Alert, Input } from "@/components/ui";
import { SubmitButton, ConfirmSubmit } from "@/components/form";
import { ErrorNote, SuccessNote } from "@/components/error-note";
import {
  ScopeCard, FilesCard, NegotiationCard, ContactsCard, MessagesCard, TimelineCard, GrantCard,
  type FullRequest,
} from "@/components/request-view";
import { uploadRequestFileAction, withdrawRequestAction, proceedAppRecordAction } from "../actions";
import { AgreementPanel } from "@/components/agreement-panel";
import { TakedownRespondPanel } from "@/components/takedown-panels";
import { ReportPanel } from "@/components/report-panel";

export const metadata = { title: "Request" };

const fileInputCls =
  "file:mr-3 file:rounded-lg file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white";

export default async function RequesterRequestDetail({ params, searchParams }: PageProps<"/r-panel/requests/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const { requester, session } = await requireRequester();
  const request = (await db.consentRequest.findUnique({
    where: { id },
    include: {
      consenter: true,
      requester: true,
      files: true,
      messages: { include: { sender: true } },
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
  const needsRaw =
    ["APPROVED_IN_PRINCIPLE", "CHANGES_REQUESTED"].includes(request.status) ||
    (request.status === "AGREEMENT_MODE_PENDING" && !request.files.some((f) => f.kind === "RAW_CONTENT"));

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        kicker={`Request #${request.number}`}
        title={request.consenter.displayName}
        action={<StatusBadge status={request.status} />}
      />
      <ErrorNote error={sp.error as string | undefined} />
      {sp.submitted && <SuccessNote msg="Request submitted — the consenter has been notified." />}

      {request.status === "DENIED" && (
        <Alert tone="warn">
          <strong>Denied.</strong> {request.denialReason ?? "No reason given."} The per-request fee is
          not refunded; you may submit a fresh request.
        </Alert>
      )}
      {request.status === "EXPIRED_NO_RESPONSE" && (
        <Alert tone="warn">
          The consenter did not respond within the window. The fee is forfeited — you can submit a
          fresh request any time.
        </Alert>
      )}
      {request.status === "CHANGES_REQUESTED" && (
        <Alert tone="warn">
          The consenter asked for changes. Read their note in the history and messages below, then
          upload a revised final file at the bottom of this page to resubmit for review.
        </Alert>
      )}

      {/* Outcome first when there is one, then the request itself, and what you
          need to do last. */}
      <GrantCard request={request} />

      <ScopeCard request={request} />
      <FilesCard request={request} />
      <MessagesCard request={request} side="requester" />
      <ContactsCard request={request} />
      <TimelineCard request={request} />
      <ReportPanel request={request} side="requester" />

      {/* ── Your next steps ── */}
      <TakedownRespondPanel request={request} />
      <NegotiationCard request={request} side="requester" />
      {!request.contactsRevealed && request.isPaid && request.agreedAmount && (
        <Alert>
          {request.consenter.displayName} hasn&apos;t shared contact details yet. Use the messages
          above to arrange payment of the agreed fee.
        </Alert>
      )}

      {request.status === "APPROVED_IN_PRINCIPLE" && (
        <Alert>
          <strong>Approved in principle.</strong> Upload the raw final content file below — the
          certificate is issued once it&apos;s in place (approval binds to its hash).
        </Alert>
      )}

      {needsRaw && (
        <Card className="space-y-3">
          <SectionTitle title="Upload final content file" desc="Uploading a new version restarts review if changes were requested." />
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
          <div className="flex flex-wrap gap-2">
            <form action={proceedAppRecordAction}>
              <input type="hidden" name="id" value={request.id} />
              <SubmitButton>Continue with Consent-app record</SubmitButton>
            </form>
            <AgreementPanel request={request} side="requester" proposeOnly />
          </div>
        </Card>
      )}

      {request.status === "LEGAL_AGREEMENT_PENDING" && <AgreementPanel request={request} side="requester" />}

      {canWithdraw && (
        <form action={withdrawRequestAction}>
          <input type="hidden" name="id" value={request.id} />
          <ConfirmSubmit confirm="Withdraw this request? The per-request fee is not refunded." variant="ghost" size="sm">
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
