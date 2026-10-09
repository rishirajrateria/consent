import { db } from "@/lib/db";
import { Card, SectionTitle, Alert, Field, Input, StatusBadge } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { storage } from "@/lib/storage";
import { fmtDateTime } from "@/lib/utils";
import {
  proposeLegalAction,
  respondProposalAction,
  chooseAgreementKindAction,
  sendSignatureOtpAction,
  signAgreementAction,
  uploadOwnAgreementAction,
  confirmUploadedAgreementAction,
} from "@/app/(app)/requests/agreement-actions";
import { proceedAppRecordAction } from "@/app/(app)/r-panel/requests/actions";
import { consenterProceedAppRecordAction } from "@/app/(app)/c-panel/requests/actions";
import { closeNegotiationAction } from "@/app/(app)/requests/shared-actions";
import type { FullRequest } from "@/components/request-view";
import { Scale, PenLine, FileUp } from "lucide-react";

const fileInputCls =
  "file:mr-3 file:rounded-lg file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white";

/** Renders the legally-binding-agreement flow for the given side. */
export async function AgreementPanel({
  request,
  side,
  proposeOnly,
}: {
  request: FullRequest;
  side: "consenter" | "requester";
  proposeOnly?: boolean;
}) {
  if (proposeOnly) {
    return (
      <form action={proposeLegalAction}>
        <input type="hidden" name="id" value={request.id} />
        <SubmitButton variant="secondary">
          <Scale className="size-4" aria-hidden /> Propose legally binding agreement
        </SubmitButton>
      </form>
    );
  }

  const agreement = await db.agreement.findUnique({
    where: { requestId: request.id },
    include: { template: true, signatures: { include: { user: true } } },
  });
  if (!agreement) return null;
  const mySide = side;
  const proposedByMe = agreement.proposedBySide === mySide;
  const proceedAction = side === "requester" ? proceedAppRecordAction : consenterProceedAppRecordAction;

  return (
    <Card strong className="space-y-4">
      <SectionTitle
        title="Legally binding agreement"
        desc="Applies only if both sides agree. Consent is not a party to the agreement and gives no legal advice."
      />
      <div className="flex items-center gap-2">
        <Scale className="size-4" aria-hidden />
        <StatusBadge status={agreement.status} />
        <span className="text-xs text-ink-faint">proposed by {agreement.proposedBySide}</span>
      </div>

      {agreement.status === "PROPOSED" && !proposedByMe && (
        <form action={respondProposalAction} className="flex gap-2">
          <input type="hidden" name="id" value={request.id} />
          <SubmitButton name="respond" value="accept">Accept — formalise it</SubmitButton>
          <SubmitButton name="respond" value="decline" variant="secondary">Decline</SubmitButton>
        </form>
      )}
      {agreement.status === "PROPOSED" && proposedByMe && (
        <Alert>Waiting for the other side to accept or decline your proposal.</Alert>
      )}

      {agreement.status === "DECLINED" && proposedByMe && (
        <div className="space-y-2">
          <Alert tone="warn">The other side declined. Continue with the in-app record, or close the request.</Alert>
          <div className="flex gap-2">
            <form action={proceedAction}>
              <input type="hidden" name="id" value={request.id} />
              <SubmitButton variant="secondary">Continue with Consent-app record</SubmitButton>
            </form>
            <form action={closeNegotiationAction}>
              <input type="hidden" name="id" value={request.id} />
              <SubmitButton variant="danger">Close the request</SubmitButton>
            </form>
          </div>
        </div>
      )}

      {agreement.status === "DRAFTING" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <form action={chooseAgreementKindAction} className="glass-subtle space-y-3 p-4">
            <input type="hidden" name="id" value={request.id} />
            <input type="hidden" name="kind" value="PLATFORM_GENERATED" />
            <div className="flex items-center gap-2 font-medium"><PenLine className="size-4" aria-hidden /> Platform-generated</div>
            <p className="text-xs text-ink-soft">
              Built from the admin-managed template for your jurisdiction, auto-filled with legal
              details, exact approved scope, fee, validity and file hashes. Signed in-app
              (typed name + OTP + timestamp + IP).
            </p>
            <OptionalClauses />
            <SubmitButton variant="secondary" size="sm">Generate agreement</SubmitButton>
          </form>
          <form action={chooseAgreementKindAction} className="glass-subtle space-y-3 p-4">
            <input type="hidden" name="id" value={request.id} />
            <input type="hidden" name="kind" value="UPLOADED" />
            <div className="flex items-center gap-2 font-medium"><FileUp className="size-4" aria-hidden /> Upload our own</div>
            <p className="text-xs text-ink-soft">
              Sign your own contract outside the app; one side uploads it, the other confirms it&apos;s
              the correct fully signed document. Stored with its SHA-256 hash.
            </p>
            <SubmitButton variant="secondary" size="sm">Choose upload</SubmitButton>
          </form>
        </div>
      )}

      {agreement.status === "AWAITING_SIGNATURES" && agreement.body && (
        <div className="space-y-4">
          <details className="glass-subtle p-4" open>
            <summary className="cursor-pointer text-sm font-medium">Agreement text (v{agreement.bodyVersion})</summary>
            <pre className="mt-3 max-h-80 overflow-y-auto whitespace-pre-wrap font-sans text-xs text-ink-soft">{agreement.body}</pre>
            <div className="mt-2 font-mono text-[10px] text-ink-faint break-all">sha256: {agreement.sha256}</div>
          </details>
          <div className="space-y-2">
            {agreement.signatures.map((s) => (
              <div key={s.id} className="flex items-center gap-2 text-sm">
                <PenLine className="size-4" aria-hidden />
                <span className="font-medium">{s.typedName}</span>
                <span className="text-xs text-ink-faint">({s.side}, {s.user.name}) · {fmtDateTime(s.signedAt)} · OTP verified</span>
              </div>
            ))}
          </div>
          {!agreement.signatures.some((s) => s.side === mySide) ? (
            <div className="space-y-3 border-t hairline pt-3">
              <form action={sendSignatureOtpAction}>
                <input type="hidden" name="id" value={request.id} />
                <SubmitButton variant="secondary" size="sm">Email me a signature code</SubmitButton>
              </form>
              <form action={signAgreementAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={request.id} />
                <div className="min-w-48 flex-1">
                  <Field label="Type your full legal name" required>
                    <Input name="typedName" required minLength={3} placeholder="Jane Carter" />
                  </Field>
                </div>
                <div className="w-32">
                  <Field label="OTP code" required>
                    <Input name="code" required inputMode="numeric" maxLength={6} placeholder="123456" />
                  </Field>
                </div>
                <SubmitButton>Sign agreement</SubmitButton>
              </form>
              <p className="text-xs text-ink-faint">
                E-signature providers (DocuSign, Leegality/Digio Aadhaar eSign) can be plugged in; this
                in-app signature records name, OTP verification, timestamp and IP.
              </p>
            </div>
          ) : (
            <Alert>You have signed. Waiting for the other side&apos;s signature.</Alert>
          )}
        </div>
      )}

      {agreement.status === "UPLOAD_PENDING_CONFIRMATION" && (
        <div className="space-y-3">
          {!agreement.uploadedFileId ? (
            <form action={uploadOwnAgreementAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="id" value={request.id} />
              <Input name="file" type="file" required accept=".pdf,image/*" className={fileInputCls} aria-label="Upload signed agreement" />
              <SubmitButton variant="secondary" size="sm">Upload signed agreement</SubmitButton>
            </form>
          ) : agreement.uploadConfirmedBySide !== mySide ? (
            <div className="space-y-2">
              <UploadedFileLink fileId={agreement.uploadedFileId} />
              <form action={confirmUploadedAgreementAction}>
                <input type="hidden" name="id" value={request.id} />
                <SubmitButton>Confirm — this is the correct, fully signed document</SubmitButton>
              </form>
            </div>
          ) : (
            <div className="space-y-2">
              <UploadedFileLink fileId={agreement.uploadedFileId} />
              <Alert>Waiting for the other side to confirm the document.</Alert>
            </div>
          )}
        </div>
      )}

      {agreement.status === "COMPLETED" && (
        <Alert>
          Agreement completed{agreement.sha256 ? <> — sha256 <span className="font-mono text-xs break-all">{agreement.sha256}</span></> : null}. It is referenced in the certificate and included in the dossier.
        </Alert>
      )}
    </Card>
  );
}

async function OptionalClauses() {
  const template = await db.agreementTemplate.findFirst({ where: { active: true } });
  const clauses = (template?.optionalClauses as { id: string; title: string; body: string }[]) ?? [];
  if (clauses.length === 0) return null;
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Optional clauses</div>
      {clauses.map((c) => (
        <label key={c.id} className="flex items-start gap-2 text-xs">
          <input type="checkbox" name="clauses" value={c.id} className="mt-0.5 size-3.5 accent-black" />
          <span><strong>{c.title}.</strong> {c.body}</span>
        </label>
      ))}
    </div>
  );
}

async function UploadedFileLink({ fileId }: { fileId: string }) {
  const file = await db.storedFile.findUnique({ where: { id: fileId } });
  if (!file) return null;
  return (
    <a href={storage.signedUrl(file.storageKey, file.name, 600)} target="_blank" rel="noreferrer" className="glass-subtle flex items-center gap-2 px-4 py-2.5 text-sm hover:border-ink/20">
      <FileUp className="size-4" aria-hidden /> {file.name}
      <span className="ml-auto font-mono text-[10px] text-ink-faint">sha256:{file.sha256.slice(0, 16)}…</span>
    </a>
  );
}
