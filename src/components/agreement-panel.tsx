import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canActOnAgreement, agreementTemplateFor } from "@/lib/esign";
import { Card, SectionTitle, Alert, Field, Input, Textarea, StatusBadge } from "@/components/ui";
import { SubmitButton, ConfirmSubmit } from "@/components/form";
import { AgreementChoices } from "@/components/agreement-choices";
import { storage } from "@/lib/storage";
import { fmtDateTime } from "@/lib/utils";
import {
  proposeLegalAction,
  respondProposalAction,
  chooseAgreementKindAction,
  sendSignatureOtpAction,
  signAgreementAction,
  requestRedraftAction,
  uploadOwnAgreementAction,
  confirmUploadedAgreementAction,
  rejectUploadedAgreementAction,
  continueWithAppRecordAction,
} from "@/app/(app)/requests/agreement-actions";
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
  canAct: allowed = true,
}: {
  request: FullRequest;
  side: "consenter" | "requester";
  proposeOnly?: boolean;
  /** Pages may narrow this; the panel also checks the signed-in member's seat. */
  canAct?: boolean;
}) {
  // Requester viewers and owner team members without approve permission can
  // read the agreement but not act on it.
  const canAct = allowed && (await memberCanAct(request, side));

  if (proposeOnly) {
    if (!canAct) return null;
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
  const mySideSigned = agreement.signatures.some((s) => s.side === mySide);
  const open = agreement.status !== "COMPLETED" && agreement.status !== "CANCELLED";
  // After a decline, closing is already one of the proposer's two choices.
  const showClose = canAct && open && !(agreement.status === "DECLINED" && proposedByMe);
  // The owner already said yes, so a consent request fee paid is theirs (80%) and Consent's (20%).
  const paidFee = request.payments.some((p) => p.purpose === "CONSENT_PRICE" && p.status === "PAID");
  const closeConfirm =
    side === "requester"
      ? `Close this request for good? You won't get a certificate. ${
          paidFee
            ? "The owner already said yes, so neither their consent request fee nor the platform fee is refunded."
            : "The platform fee isn't refunded."
        }`
      : "Close this request for good? No certificate is issued and it can't be reopened.";

  return (
    <>
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

        {agreement.status === "PROPOSED" && !proposedByMe && canAct && (
          <div className="space-y-3">
            <p className="text-sm text-ink-soft">
              If you accept, you both choose how to write the agreement, then both sign it. If you
              decline, the other side chooses to go on with the in-app record or close the request.
            </p>
            <form action={respondProposalAction} className="flex flex-wrap gap-2">
              <input type="hidden" name="id" value={request.id} />
              <SubmitButton name="respond" value="decline" variant="secondary">Decline</SubmitButton>
              <SubmitButton name="respond" value="accept">Accept — formalise it</SubmitButton>
            </form>
          </div>
        )}
        {agreement.status === "PROPOSED" && proposedByMe && (
          <Alert>Waiting for the other side to accept or decline your proposal.</Alert>
        )}

        {agreement.status === "DECLINED" && proposedByMe && (
          <div className="space-y-3">
            <Alert tone="warn">The other side declined. Continue with the in-app record, or close the request.</Alert>
            {canAct && (
              <div className="flex flex-wrap gap-2">
                <form action={closeNegotiationAction}>
                  <input type="hidden" name="id" value={request.id} />
                  <ConfirmSubmit confirm={closeConfirm} variant="ghost" className="min-h-10">
                    Close the request
                  </ConfirmSubmit>
                </form>
                <form action={continueWithAppRecordAction}>
                  <input type="hidden" name="id" value={request.id} />
                  <SubmitButton>Continue with Consent-app record</SubmitButton>
                </form>
              </div>
            )}
          </div>
        )}
        {agreement.status === "DECLINED" && !proposedByMe && (
          <Alert>Your side declined. Waiting for the other side to continue with the in-app record or close the request.</Alert>
        )}

        {agreement.status === "DRAFTING" && canAct && (
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
              <OptionalClauses country={request.requester.country} />
              <SubmitButton variant="secondary">Generate agreement</SubmitButton>
            </form>
            <form action={chooseAgreementKindAction} className="glass-subtle space-y-3 p-4">
              <input type="hidden" name="id" value={request.id} />
              <input type="hidden" name="kind" value="UPLOADED" />
              <div className="flex items-center gap-2 font-medium"><FileUp className="size-4" aria-hidden /> Upload our own</div>
              <p className="text-xs text-ink-soft">
                Sign your own contract outside the app; one side uploads it, the other confirms it&apos;s
                the correct fully signed document. Stored with its SHA-256 hash.
              </p>
              <SubmitButton variant="secondary">Choose upload</SubmitButton>
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
            {mySideSigned ? (
              <Alert>You have signed. Waiting for the other side&apos;s signature.</Alert>
            ) : canAct ? (
              <div className="border-t hairline pt-3">
                {/* Sign, or send it back with a reason: one choice at a time, its button last. */}
                <AgreementChoices
                  label="Your move"
                  options={[
                    {
                      key: "sign",
                      label: "Sign it",
                      content: (
                        <div className="space-y-3">
                          <p className="text-xs text-ink-soft">
                            Read the text above first. Your signature records your typed name, the
                            emailed code, the time and your IP address.
                          </p>
                          <form action={sendSignatureOtpAction}>
                            <input type="hidden" name="id" value={request.id} />
                            <SubmitButton variant="secondary">Email me a signature code</SubmitButton>
                          </form>
                          <form action={signAgreementAction} className="flex flex-wrap items-end gap-2">
                            <input type="hidden" name="id" value={request.id} />
                            {/* Ties the signature to the version shown above. */}
                            <input type="hidden" name="sha256" value={agreement.sha256 ?? ""} />
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
                        </div>
                      ),
                    },
                    {
                      key: "redraft",
                      label: "Ask for a new draft",
                      content: (
                        <form action={requestRedraftAction} className="space-y-3">
                          <input type="hidden" name="id" value={request.id} />
                          <input type="hidden" name="sha256" value={agreement.sha256 ?? ""} />
                          <Field label="What should change?" required>
                            <Textarea name="reason" required placeholder="e.g. Please take out the exclusivity clause." className="min-h-16" />
                          </Field>
                          <p className="text-xs text-ink-faint">
                            The agreement goes back to drafting and any signature on it is removed.
                            The other side gets your note, and it stays on the timeline.
                          </p>
                          <SubmitButton>Ask for a new draft</SubmitButton>
                        </form>
                      ),
                    },
                  ]}
                />
              </div>
            ) : null}
          </div>
        )}

        {agreement.status === "UPLOAD_PENDING_CONFIRMATION" && (
          <div className="space-y-3">
            {!agreement.uploadedFileId ? (
              canAct ? (
                <form action={uploadOwnAgreementAction} className="space-y-3">
                  <input type="hidden" name="id" value={request.id} />
                  <p className="text-sm text-ink-soft">
                    Sign your own contract outside the app. Then one of you uploads the fully signed
                    file here, and the other side checks it.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input name="file" type="file" required accept=".pdf,image/*" className={fileInputCls} aria-label="Upload signed agreement" />
                    <SubmitButton variant="secondary">Upload signed agreement</SubmitButton>
                  </div>
                </form>
              ) : (
                <Alert>Waiting for the fully signed file to be uploaded.</Alert>
              )
            ) : agreement.uploadConfirmedBySide !== mySide ? (
              <div className="space-y-3">
                <UploadedFileLink fileId={agreement.uploadedFileId} />
                {canAct && (
                  <>
                    <p className="text-sm text-ink-soft">
                      Open the file and check it&apos;s the right, fully signed document. Confirming
                      completes the agreement.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <form action={rejectUploadedAgreementAction}>
                        <input type="hidden" name="id" value={request.id} />
                        <input type="hidden" name="fileId" value={agreement.uploadedFileId} />
                        <SubmitButton variant="secondary">This isn&apos;t the right document</SubmitButton>
                      </form>
                      <form action={confirmUploadedAgreementAction}>
                        <input type="hidden" name="id" value={request.id} />
                        {/* Ties the answer to the file shown above. */}
                        <input type="hidden" name="fileId" value={agreement.uploadedFileId} />
                        <SubmitButton>Confirm — this is the correct, fully signed document</SubmitButton>
                      </form>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <UploadedFileLink fileId={agreement.uploadedFileId} />
                <Alert>Waiting for the other side to confirm the document.</Alert>
                {canAct && (
                  <form action={uploadOwnAgreementAction} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="id" value={request.id} />
                    <Input name="file" type="file" required accept=".pdf,image/*" className={fileInputCls} aria-label="Replace the uploaded agreement" />
                    <SubmitButton variant="secondary">Replace the file</SubmitButton>
                  </form>
                )}
              </div>
            )}
          </div>
        )}

        {agreement.status === "COMPLETED" && (
          <Alert>
            Agreement completed{agreement.sha256 ? <> — sha256 <span className="font-mono text-xs break-all">{agreement.sha256}</span></> : null}. It is referenced in the certificate and included in the dossier.
          </Alert>
        )}

        {!canAct && open && (
          <p className="text-xs text-ink-faint">
            {side === "requester"
              ? "You have a viewer seat. You can read everything here, but only editors can act."
              : "You can read this agreement, but acting on it needs the approve permission."}
          </p>
        )}
      </Card>

      {/* A quiet way out, kept outside the card so its main action stays last. */}
      {showClose && (
        <form action={closeNegotiationAction} className="flex flex-wrap items-center gap-x-2">
          <input type="hidden" name="id" value={request.id} />
          <span className="text-xs text-ink-faint">Don&apos;t want to go ahead?</span>
          <ConfirmSubmit confirm={closeConfirm} variant="ghost" className="min-h-10">
            Close the request
          </ConfirmSubmit>
        </form>
      )}
    </>
  );
}

/** Whether the signed-in member may act on the agreement for this side. */
async function memberCanAct(request: FullRequest, side: "consenter" | "requester") {
  const session = await requireUser();
  const member =
    side === "consenter"
      ? await db.consenterMember.findUnique({
          where: { consenterId_userId: { consenterId: request.consenterId, userId: session.userId } },
        })
      : await db.requesterMember.findUnique({
          where: { requesterId_userId: { requesterId: request.requesterId, userId: session.userId } },
        });
  return canActOnAgreement(side, member);
}

async function OptionalClauses({ country }: { country: string }) {
  // Same template as generation, so every ticked clause ends up in the agreement.
  const template = await agreementTemplateFor(country);
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
