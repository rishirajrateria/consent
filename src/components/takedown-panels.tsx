import { db } from "@/lib/db";
import { Card, SectionTitle, Field, Input, Textarea, StatusBadge, Alert } from "@/components/ui";
import { SubmitButton, ConfirmSubmit } from "@/components/form";
import {
  revokeGrantAction, raiseTakedownAction, respondTakedownAction, confirmTakedownAction,
} from "@/app/(app)/requests/grant-actions";
import { ViewOnlyNote, type FullRequest } from "@/components/request-view";
import { storage } from "@/lib/storage";
import { fmtDateTime } from "@/lib/utils";
import { ShieldOff, Siren, Image as ImageIcon } from "lucide-react";

const fileInputCls =
  "file:mr-3 file:rounded-lg file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white";

/** The live links, each one openable so it can be checked. */
function LiveLinks({ links }: { links: string[] }) {
  return (
    <div className="text-xs text-ink-soft">
      Links:
      <ul className="mt-0.5 space-y-0.5">
        {links.map((l) => (
          <li key={l} className="break-all">
            {/^https?:\/\//i.test(l) ? (
              <a href={l} target="_blank" rel="noreferrer" className="inline-flex min-h-10 max-w-full items-center underline underline-offset-4 hover:text-ink">{l}</a>
            ) : (
              l
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The asker's screenshot, as a short-lived signed link. */
function ScreenshotLink({ file }: { file?: { storageKey: string; name: string } }) {
  if (!file) return null;
  return (
    <a
      href={storage.signedUrl(file.storageKey, file.name, 600)}
      target="_blank"
      rel="noreferrer"
      className="flex min-h-10 w-fit items-center gap-1.5 text-xs font-medium underline underline-offset-4"
    >
      <ImageIcon className="size-3.5" aria-hidden /> Their screenshot
    </a>
  );
}

/** The profile that gave consent: revoke it, and raise and check takedowns. */
export async function RevokePanel({ request, canDecide }: { request: FullRequest; canDecide: boolean }) {
  const grant = request.grant;
  if (!grant) return null;
  const takedowns = await db.takedownRequest.findMany({
    where: { grantId: grant.id },
    orderBy: { createdAt: "desc" },
  });
  // The asker's proof that it's down, shown before the owner decides.
  const evidenceIds = takedowns.map((t) => t.requesterEvidenceFileId).filter((x): x is string => !!x);
  const evidence = evidenceIds.length
    ? await db.storedFile.findMany({ where: { id: { in: evidenceIds } } })
    : [];

  return (
    <Card className="space-y-5">
      <SectionTitle
        title="Revocation & takedown"
        desc="Revoking covers future use only. For content already published, raise a takedown request."
      />
      {takedowns.map((t) => (
        <div key={t.id} className="glass-subtle space-y-2 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Siren className="size-4" aria-hidden />
            <span className="font-medium">Takedown · {fmtDateTime(t.createdAt)}</span>
            <StatusBadge status={t.status} />
            <span className="ml-auto text-xs text-ink-faint">respond by {fmtDateTime(t.respondBy)}</span>
          </div>
          <div className="text-xs text-ink-soft">Reason: {t.reason}</div>
          <LiveLinks links={t.liveLinks} />
          {t.requesterNote && <div className="text-xs text-ink-soft">{request.requester.displayName}&apos;s note: {t.requesterNote}</div>}
          <ScreenshotLink file={evidence.find((f) => f.id === t.requesterEvidenceFileId)} />
          {t.declineReason && <div className="text-xs text-ink-soft">Declined: {t.declineReason}</div>}
          {t.status === "MARKED_DOWN" && canDecide && (
            <form action={confirmTakedownAction} className="flex flex-wrap gap-2 border-t hairline pt-2">
              <input type="hidden" name="takedownId" value={t.id} />
              <p className="w-full text-xs text-ink-faint">Open the links above to check before you answer.</p>
              <SubmitButton name="action" value="reject" variant="secondary" size="sm">Still live — reject claim</SubmitButton>
              <ConfirmSubmit
                name="action"
                value="confirm"
                variant="primary"
                size="sm"
                confirm="Confirm the content is down? This closes the takedown for good."
              >
                Confirm it&apos;s down
              </ConfirmSubmit>
            </form>
          )}
        </div>
      ))}

      {canDecide && grant.status === "ACTIVE" && (
        <details>
          <summary className="cursor-pointer text-sm font-medium text-ink-soft hover:text-ink">
            <ShieldOff className="mr-1 inline size-4" aria-hidden /> Revoke this consent
          </summary>
          <form action={revokeGrantAction} className="mt-3 space-y-3 border-l-2 border-ink/10 pl-4">
            <input type="hidden" name="grantId" value={grant.id} />
            <Field label="Reason (mandatory)" required>
              <Textarea name="reason" required className="min-h-16" placeholder="Why are you revoking it?" />
            </Field>
            <Alert>
              Content published within the scope and validity before today stays covered. The
              certificate shows the revocation.
            </Alert>
            <ConfirmSubmit confirm="Revoke this consent for all future use?" variant="danger">Revoke consent</ConfirmSubmit>
          </form>
        </details>
      )}

      {canDecide && (
        <details>
          <summary className="cursor-pointer text-sm font-medium text-ink-soft hover:text-ink">
            <Siren className="mr-1 inline size-4" aria-hidden /> Raise a takedown request
          </summary>
          <form action={raiseTakedownAction} className="mt-3 space-y-3 border-l-2 border-ink/10 pl-4">
            <input type="hidden" name="grantId" value={grant.id} />
            <Field label="Reason" required>
              <Input name="reason" required placeholder="e.g. used beyond approved scope" />
            </Field>
            <Field label="Live link(s)" required hint="One per line.">
              <Textarea name="links" required className="min-h-16" placeholder="https://youtube.com/watch?v=…" />
            </Field>
            <SubmitButton variant="secondary">Send takedown request</SubmitButton>
          </form>
        </details>
      )}
    </Card>
  );
}

/** The profile that asked: takedown requests waiting for its answer. */
export async function TakedownRespondPanel({
  request,
  canAct = true,
}: {
  request: FullRequest;
  /** False for view-only seats: the requests only, no answer forms. */
  canAct?: boolean;
}) {
  const grant = request.grant;
  if (!grant) return null;
  const takedowns = await db.takedownRequest.findMany({
    where: { grantId: grant.id },
    orderBy: { createdAt: "desc" },
  });
  if (takedowns.length === 0) return null;

  return (
    <Card className="space-y-4">
      <SectionTitle title="Takedown requests" />
      {takedowns.map((t) => (
        <div key={t.id} className="glass-subtle space-y-2 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Siren className="size-4" aria-hidden />
            <span className="font-medium">{fmtDateTime(t.createdAt)}</span>
            <StatusBadge status={t.status} />
            <span className="ml-auto text-xs text-ink-faint">respond by {fmtDateTime(t.respondBy)}</span>
          </div>
          <div className="text-xs text-ink-soft">Reason: {t.reason}</div>
          <LiveLinks links={t.liveLinks} />
          {(t.status === "RAISED" || t.status === "REJECTED_CLAIM") && !canAct && <ViewOnlyNote />}
          {(t.status === "RAISED" || t.status === "REJECTED_CLAIM") && canAct && (
            <div className="space-y-3 border-t hairline pt-2">
              {t.status === "REJECTED_CLAIM" && (
                <Alert tone="warn">{request.consenter.displayName} says the content is still live.</Alert>
              )}
              <form action={respondTakedownAction} className="space-y-2">
                <input type="hidden" name="takedownId" value={t.id} />
                <Field label="Note (optional)">
                  <Input name="note" placeholder="e.g. removed from all platforms today" />
                </Field>
                <Field label="Screenshot (optional)">
                  <Input name="screenshot" type="file" accept="image/*" className={fileInputCls} />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <SubmitButton name="action" value="down" size="sm">Content taken down</SubmitButton>
                </div>
              </form>
              <form action={respondTakedownAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="takedownId" value={t.id} />
                <div className="min-w-48 flex-1">
                  <Field label="Decline with reason">
                    <Input name="declineReason" placeholder="Why you won't take it down" />
                  </Field>
                </div>
                <SubmitButton name="action" value="decline" variant="secondary" size="sm">Decline</SubmitButton>
              </form>
              <p className="text-xs text-ink-faint">
                Ignoring or declining is recorded and lowers your Consent Score. Consent takes no
                other action. Legal matters stay between you.
              </p>
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}
