import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, Input, StatusBadge, EmptyState } from "@/components/ui";
import { SubmitButton, ConfirmSubmit } from "@/components/form";
import { audit } from "@/lib/audit";
import { fmtDate } from "@/lib/utils";
import { Search, UserRound } from "lucide-react";

export const metadata = { title: "Users & profiles" };

async function userAction(formData: FormData) {
  "use server";
  const session = await requireAdmin("users", "edit");
  const id = String(formData.get("id"));
  const op = String(formData.get("op"));
  const reason = String(formData.get("reason") ?? "").trim() || null;
  const user = await db.user.findUnique({ where: { id } });
  if (!user) return;
  if ((op === "suspend" || op === "ban") && !reason) return; // sensitive actions require a reason
  if (op === "suspend") await db.user.update({ where: { id }, data: { isSuspended: true } });
  if (op === "unsuspend") await db.user.update({ where: { id }, data: { isSuspended: false } });
  if (op === "ban") {
    await db.user.update({ where: { id }, data: { isBanned: true } });
    await db.session.deleteMany({ where: { userId: id } });
  }
  if (op === "unban") await db.user.update({ where: { id }, data: { isBanned: false } });
  if (op === "reverify") {
    await db.consenterMember.findMany({ where: { userId: id, role: "OWNER" } }).then(async (members) => {
      for (const m of members) {
        await db.consenterProfile.update({ where: { id: m.consenterId }, data: { status: "UNDER_REVIEW" } });
      }
    });
  }
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: `user_${op}`,
    module: "users",
    targetId: id,
    reason,
  });
  revalidatePath("/admin/users");
}

export default async function AdminUsers({ searchParams }: PageProps<"/admin/users">) {
  await requireAdmin("users", "view");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const users = await db.user.findMany({
    where: q
      ? { OR: [{ email: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }] }
      : {},
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      adminRole: true,
      consenterMembers: { include: { consenter: true } },
      requesterMembers: { include: { requester: true } },
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader kicker="Admin" title="Users & profiles" desc="Bans and suspensions require a reason and are logged in the immutable audit trail." />
      <form method="GET" className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
        <Input name="q" defaultValue={q} placeholder="Search name, email, phone…" className="pl-10" aria-label="Search users" />
      </form>
      {users.length === 0 ? (
        <EmptyState icon={UserRound} title="No users found" />
      ) : (
        <div className="space-y-2">
          {users.map((u) => (
            <Card key={u.id} className="space-y-2 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">
                    {u.name} {u.adminRole && <span className="rounded-md bg-ink px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">{u.adminRole.name}</span>}
                  </div>
                  <div className="text-xs text-ink-faint">
                    {u.email} · {u.phone ?? "no phone"} · joined {fmtDate(u.createdAt)} · 2FA {u.totpEnabled ? "on" : "off"}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {u.consenterMembers.map((m) => (
                      <span key={m.id} className="rounded-full border border-ink/15 px-2 py-0.5 text-[10px]">consenter: {m.consenter.displayName}</span>
                    ))}
                    {u.requesterMembers.map((m) => (
                      <span key={m.id} className="rounded-full border border-ink/15 px-2 py-0.5 text-[10px]">requester: {m.requester.displayName}</span>
                    ))}
                  </div>
                </div>
                {u.isBanned ? <StatusBadge status="REJECTED" /> : u.isSuspended ? <StatusBadge status="EXPIRED" /> : <StatusBadge status="ACTIVE" />}
              </div>
              <form action={userAction} className="flex flex-wrap items-center gap-2 border-t hairline pt-2">
                <input type="hidden" name="id" value={u.id} />
                <Input name="reason" placeholder="Reason (required for ban/suspend)" className="max-w-64 py-1.5 text-xs" aria-label="Reason" />
                {u.isSuspended ? (
                  <SubmitButton name="op" value="unsuspend" variant="secondary" size="sm">Unsuspend</SubmitButton>
                ) : (
                  <SubmitButton name="op" value="suspend" variant="secondary" size="sm">Suspend</SubmitButton>
                )}
                {u.isBanned ? (
                  <SubmitButton name="op" value="unban" variant="secondary" size="sm">Unban</SubmitButton>
                ) : (
                  <ConfirmSubmit confirm={`Ban ${u.name}? All their sessions end immediately.`} name="op" value="ban" size="sm">Ban</ConfirmSubmit>
                )}
                <SubmitButton name="op" value="reverify" variant="ghost" size="sm">Force re-verification</SubmitButton>
              </form>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
