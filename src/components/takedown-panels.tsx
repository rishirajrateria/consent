import { db } from "@/lib/db";
import { Card, SectionTitle, Field, Input, Textarea, StatusBadge, Alert } from "@/components/ui";
import { SubmitButton, ConfirmSubmit } from "@/components/form";
import {
  revokeGrantAction, raiseTakedownAction, respondTakedownAction, confirmTakedownAction,
} from "@/app/(app)/requests/grant-actions";
import type { FullRequest } from "@/components/request-view";
import { fmtDateTime } from "@/lib/utils";
import { ShieldOff, Siren } from "lucide-react";

const fileInputCls =
  "file:mr-3 file:rounded-lg file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white";

/** Consenter-side: revoke + takedown management for an issued grant. */
export async function RevokePanel({ request, canDecide }: { request: FullRequest; canDecide: boolean }) {
  const grant = request.grant;
  if (!grant) return null;
  const takedowns = await db.takedownRequest.findMany({
    where: { grantId: grant.id },
    orderBy: { createdAt: "desc" },
  });

  return (
    <Card className="space-y-5">
      <SectionTitle
        title="Revocation & takedown"
        desc="Revocation applies to future use only. For already-published content, raise a takedown request."
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
          <div className="text-xs text-ink-soft">Links: {t.liveLinks.join(" · ")}</div>
          {t.requesterNote && <div className="text-xs text-ink-soft">Requester note: {t.requesterNote}</div>}
          {t.declineReason && <div className="text-xs text-ink-soft">Declined: {t.declineReason}</div>}
          {t.status === "MARKED_DOWN" && canDecide && (
            <form action={confirmTakedownAction} className="flex gap-2 pt-1">
              <input type="hidden" name="takedownId" value={t.id} />
              <SubmitButton name="action" value="confirm" size="sm">Confirm it&apos;s down</SubmitButton>
              <SubmitButton name="action" value="reject" variant="secondary" size="sm">Still live — reject claim</SubmitButton>
            </form>
          )}
        </div>
      ))}

      {canDecide && grant.status === "ACTIVE" && (
        <details>
          <summary className="cursor-pointer text-sm font-medium text-ink-soft hover:text-ink">
            <ShieldOff className="mr-1 inline size-4" aria-hidden /> Revoke this grant
          </summary>
          <form action={revokeGrantAction} className="mt-3 space-y-3 border-l-2 border-ink/10 pl-4">
            <input type="hidden" name="grantId" value={grant.id} />
            <Field label="Reason (mandatory)" required>
              <Textarea name="reason" required className="min-h-16" placeholder="Why are you revoking this grant?" />
            </Field>
            <Alert>
              Content published within the validity and scope before the revocation date remains
              covered; the certificate will show the revocation.
            </Alert>
            <ConfirmSubmit confirm="Revoke this grant for all future use?" variant="danger">Revoke grant</ConfirmSubmit>
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

/** Requester-side: open takedown requests needing a response. */
export async function TakedownRespondPanel({ request }: { request: FullRequest }) {
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
          <div className="text-xs text-ink-soft">Links: {t.liveLinks.join(" · ")}</div>
          {(t.status === "RAISED" || t.status === "REJECTED_CLAIM") && (
            <div className="space-y-3 border-t hairline pt-2">
              {t.status === "REJECTED_CLAIM" && (
                <Alert tone="warn">The consenter says the content is still live.</Alert>
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
                Ignoring or declining is recorded and affects your Consent Score. Consent takes no
                further action; legal matters stay between the parties.
              </p>
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}
