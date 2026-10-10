import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, hasAdminPerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, StatusBadge, EmptyState, Input, Field } from "@/components/ui";
import { SubmitButton, ConfirmSubmit } from "@/components/form";
import { audit } from "@/lib/audit";
import { notifyConsenterTeam, notifyRequesterTeam } from "@/lib/notify";
import { ErrorNote, SuccessNote } from "@/components/error-note";
import { NoPermission } from "../no-permission";
import { fmtDateTime, cn } from "@/lib/utils";
import { Inbox } from "lucide-react";
import { syncConsentPrice } from "@/lib/escrow";

export const metadata = { title: "Requests & grants" };

// Requests in these states are already finished; there is nothing left to close.
const FINISHED = ["APPROVED", "DENIED", "CLOSED", "EXPIRED_NO_RESPONSE", "WITHDRAWN"];

async function adminRequestAction(formData: FormData) {
  "use server";
  const session = await requireAdmin("requests", "edit");
  const id = String(formData.get("id"));
  const op = String(formData.get("op"));
  const note = String(formData.get("note") ?? "").trim();
  const back = (key: "error" | "done", msg: string) => redirect(`/admin/requests?${key}=${encodeURIComponent(msg)}`);
  if (op === "close") {
    if (!note) back("error", "Add a reason to close this request. Both sides will see it.");
    const r = await db.consentRequest.findUnique({ where: { id } });
    if (!r) return back("error", "That request no longer exists.");
    if (FINISHED.includes(r.status)) back("error", `Request #${r.number} is already finished.`);
    // CLOSED, not EXPIRED_NO_RESPONSE: that status is kept for the SLA job and
    // counts against the owner as "ignored". As on every close, the platform
    // fee stays; an ask price still held (no yes yet) is refunded.
    await db.$transaction([
      db.consentRequest.update({ where: { id }, data: { status: "CLOSED", closedReason: `Closed by Consent: ${note}` } }),
      db.requestEvent.create({
        data: { requestId: id, type: "closed_by_consent", actorName: session.user.name, actorSide: "admin", detail: { note } },
      }),
    ]);
    const title = `Request #${r.number} closed by Consent`;
    // End the admin's reason with a full stop so the next sentence doesn't run into it.
    const reason = `Reason: ${/[.!?]$/.test(note) ? note : `${note}.`}`;
    await notifyConsenterTeam(r.consenterId, { title, body: reason, href: `/c-panel/requests/${id}` });
    await syncConsentPrice(id);
    await notifyRequesterTeam(r.requesterId, {
      title,
      body: `${reason} The platform fee isn't refunded. If the owner hadn't said yes, their ask price is refunded to you.`,
      href: `/r-panel/requests/${id}`,
    });
    await audit({ actorId: session.userId, actorName: session.user.name, action: "request_closed_by_admin", module: "requests", targetId: id, reason: note });
    revalidatePath("/admin/requests");
    back("done", `Request #${r.number} closed. Both sides were told why.`);
  }
  if (op === "note") {
    if (!note) back("error", "Write the note first.");
    await db.requestEvent.create({
      data: { requestId: id, type: "admin_note", actorName: session.user.name, actorSide: "admin", detail: { note } },
    });
    await audit({ actorId: session.userId, actorName: session.user.name, action: "request_note", module: "requests", targetId: id, reason: note });
    revalidatePath("/admin/requests");
    back("done", "Note added.");
  }
}

export default async function AdminRequests({ searchParams }: PageProps<"/admin/requests">) {
  const session = await requireAdmin("requests", "view");
  const canEdit = hasAdminPerm(session.user.adminRole, "requests", "edit");
  const sp = await searchParams;
  const tab = sp.tab === "grants" ? "grants" : "requests";

  if (tab === "grants") {
    const grants = await db.grant.findMany({
      orderBy: { issuedAt: "desc" },
      take: 100,
      include: { request: { include: { consenter: true, requester: true } } },
    });
    return (
      <div className="space-y-6">
        <PageHeader kicker="Admin" title="Requests & grants" />
        <Tabs tab={tab} />
        {grants.length === 0 ? (
          <EmptyState title="No grants yet" />
        ) : (
          <div className="space-y-2">
            {grants.map((g) => (
              <Card key={g.id} className="flex flex-wrap items-center gap-3 py-4">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{g.certificateId}</div>
                  <div className="text-xs text-ink-faint">
                    {g.request.consenter.displayName} → {g.request.requester.displayName} · issued {fmtDateTime(g.issuedAt)}
                  </div>
                </div>
                <Link href={`/v/${g.publicId}`} className="text-xs underline underline-offset-4">verification page</Link>
                <StatusBadge status={g.status} />
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  }

  const requests = await db.consentRequest.findMany({
    where: { status: { not: "DRAFT" } },
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: { consenter: true, requester: true },
  });

  return (
    <div className="space-y-6">
      <PageHeader kicker="Admin" title="Requests & grants" desc="View all, add admin notes, close stuck requests." />
      <ErrorNote error={sp.error} />
      {typeof sp.done === "string" && <SuccessNote msg={sp.done} />}
      <Tabs tab={tab} />
      {requests.length === 0 ? (
        <EmptyState icon={Inbox} title="No requests" />
      ) : (
        <div className="space-y-2">
          {requests.map((r) => (
            <Card key={r.id} className="space-y-2 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">#{r.number} · {r.requester.displayName} → {r.consenter.displayName}</div>
                  <div className="text-xs text-ink-faint">{r.assetTypeNames.join(", ")} · updated {fmtDateTime(r.updatedAt)}</div>
                </div>
                <StatusBadge status={r.status} />
              </div>
              {canEdit ? (
                <>
                  <form action={adminRequestAction} className="flex flex-wrap items-center gap-2 border-t hairline pt-2">
                    <input type="hidden" name="id" value={r.id} />
                    <Input name="note" required placeholder="Admin note…" className="max-w-64 py-1.5 text-xs" aria-label="Admin note" />
                    <SubmitButton name="op" value="note" variant="secondary" size="sm">Add note</SubmitButton>
                  </form>
                  {!FINISHED.includes(r.status) && (
                    <details>
                      <summary className="flex min-h-10 cursor-pointer items-center text-xs font-medium text-ink-soft hover:text-ink">
                        Close this request…
                      </summary>
                      <form action={adminRequestAction} className="space-y-2 border-l-2 border-ink/10 pl-4">
                        <input type="hidden" name="id" value={r.id} />
                        <Field label="Reason (both sides see this)" required>
                          <Input name="note" required placeholder="e.g. Stuck on signing for 30 days; closed at the requester's ask." className="text-xs" />
                        </Field>
                        <ConfirmSubmit
                          confirm={`Close request #${r.number}? Both sides will see your reason. This can't be undone.`}
                          name="op"
                          value="close"
                        >
                          Close request
                        </ConfirmSubmit>
                      </form>
                    </details>
                  )}
                </>
              ) : (
                <NoPermission to="add notes or close requests" perm="edit" module="requests" />
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Tabs({ tab }: { tab: string }) {
  return (
    <div className="flex gap-1">
      {[["requests", "Requests"], ["grants", "Grants"]].map(([t, label]) => (
        <Link key={t} href={`/admin/requests?tab=${t}`} className={cn("rounded-xl px-3 py-1.5 text-sm font-medium", t === tab ? "bg-ink text-white" : "text-ink-soft hover:bg-ink/5")}>
          {label}
        </Link>
      ))}
    </div>
  );
}
