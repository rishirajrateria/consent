import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, StatusBadge, EmptyState, Input } from "@/components/ui";
import { SubmitButton, ConfirmSubmit } from "@/components/form";
import { audit } from "@/lib/audit";
import { fmtDateTime, cn } from "@/lib/utils";
import { Inbox } from "lucide-react";

export const metadata = { title: "Requests & grants" };

async function adminRequestAction(formData: FormData) {
  "use server";
  const session = await requireAdmin("requests", "edit");
  const id = String(formData.get("id"));
  const op = String(formData.get("op"));
  const note = String(formData.get("note") ?? "").trim();
  if (op === "force_expire") {
    await db.consentRequest.update({ where: { id }, data: { status: "EXPIRED_NO_RESPONSE" } });
    await db.requestEvent.create({
      data: { requestId: id, type: "admin_force_expired", actorName: session.user.name, actorSide: "admin" },
    });
  }
  if (op === "note" && note) {
    await db.requestEvent.create({
      data: { requestId: id, type: "admin_note", actorName: session.user.name, actorSide: "admin", detail: { note } },
    });
  }
  await audit({ actorId: session.userId, actorName: session.user.name, action: `request_${op}`, module: "requests", targetId: id, reason: note || null });
  revalidatePath("/admin/requests");
}

export default async function AdminRequests({ searchParams }: PageProps<"/admin/requests">) {
  await requireAdmin("requests", "view");
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
      <PageHeader kicker="Admin" title="Requests & grants" desc="View all, add admin notes, force-expire stuck requests." />
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
              <form action={adminRequestAction} className="flex flex-wrap items-center gap-2 border-t hairline pt-2">
                <input type="hidden" name="id" value={r.id} />
                <Input name="note" placeholder="Admin note…" className="max-w-64 py-1.5 text-xs" aria-label="Admin note" />
                <SubmitButton name="op" value="note" variant="secondary" size="sm">Add note</SubmitButton>
                {!["APPROVED", "DENIED", "CLOSED", "EXPIRED_NO_RESPONSE", "WITHDRAWN"].includes(r.status) && (
                  <ConfirmSubmit confirm={`Force-expire request #${r.number}?`} name="op" value="force_expire" variant="ghost" size="sm">
                    Force-expire
                  </ConfirmSubmit>
                )}
              </form>
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
