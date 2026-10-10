import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, hasAdminPerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, Input, StatusBadge, EmptyState } from "@/components/ui";
import { SubmitButton, ConfirmSubmit } from "@/components/form";
import { audit } from "@/lib/audit";
import { notifyConsenterTeam } from "@/lib/notify";
import { syncPair } from "@/lib/profiles";
import { ErrorNote, SuccessNote } from "@/components/error-note";
import { NoPermission } from "../no-permission";
import { fmtDate } from "@/lib/utils";
import { Search, UserRound } from "lucide-react";

export const metadata = { title: "Users & profiles" };

async function userAction(formData: FormData) {
  "use server";
  const session = await requireAdmin("users", "edit");
  const id = String(formData.get("id"));
  const op = String(formData.get("op"));
  const reason = String(formData.get("reason") ?? "").trim() || null;
  const q = String(formData.get("q") ?? "");
  const back = (key: "error" | "done", msg: string) =>
    redirect(`/admin/users?${new URLSearchParams({ ...(q ? { q } : {}), [key]: msg })}`);
  const user = await db.user.findUnique({ where: { id } });
  if (!user) return back("error", "That account no longer exists.");
  // Sensitive actions require a reason, and it is logged in the audit trail.
  if ((op === "suspend" || op === "ban" || op === "reverify") && !reason)
    back("error", "Add a reason to suspend, ban or force re-verification.");
  if ((op === "suspend" || op === "ban") && id === session.userId)
    back("error", "You can't suspend or ban your own account.");
  if (op === "suspend") {
    await db.user.update({ where: { id }, data: { isSuspended: true } });
    // Sign-in already refuses suspended users; ending sessions stops the ones already signed in.
    await db.session.deleteMany({ where: { userId: id } });
  }
  if (op === "unsuspend") await db.user.update({ where: { id }, data: { isSuspended: false } });
  if (op === "ban") {
    await db.user.update({ where: { id }, data: { isBanned: true } });
    await db.session.deleteMany({ where: { userId: id } });
  }
  if (op === "unban") await db.user.update({ where: { id }, data: { isBanned: false } });
  if (op === "reverify") {
    const owned = await db.consenterMember.findMany({
      where: { userId: id, role: "OWNER", consenter: { status: "APPROVED" } },
      include: { consenter: true },
    });
    if (owned.length === 0) back("error", `${user.name} owns no verified profile.`);
    for (const m of owned) {
      // Both halves go back to review together: no sending or receiving until it's approved again.
      await db.$transaction(async (tx) => {
        await tx.consenterProfile.update({ where: { id: m.consenterId }, data: { status: "UNDER_REVIEW" } });
        await syncPair(m.consenterId, tx);
      });
      await notifyConsenterTeam(m.consenterId, {
        title: "Your profile needs to be verified again",
        body: `${m.consenter.displayName} is hidden from search and can't send or receive new requests until it's verified again. Reason: ${reason}`,
        href: `/onboarding?profile=${m.consenterId}`,
        critical: true,
      });
    }
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
  const done: Record<string, string> = {
    suspend: `${user.name} is suspended and signed out.`,
    unsuspend: `${user.name} can sign in again.`,
    ban: `${user.name} is banned and signed out.`,
    unban: `${user.name} is no longer banned.`,
    reverify: `${user.name}'s profiles are back in review. Their teams were told why.`,
  };
  if (done[op]) back("done", done[op]);
}

export default async function AdminUsers({ searchParams }: PageProps<"/admin/users">) {
  const session = await requireAdmin("users", "view");
  const canEdit = hasAdminPerm(session.user.adminRole, "users", "edit");
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
      // Only an old sending-only seat (not yet paired with a profile) is listed on its own.
      requesterMembers: { where: { requester: { consenterId: null } }, include: { requester: true } },
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader kicker="Admin" title="Users & profiles" desc="Bans and suspensions require a reason and are logged in the immutable audit trail." />
      <ErrorNote error={sp.error} />
      {typeof sp.done === "string" && <SuccessNote msg={sp.done} />}
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
                      <Link
                        key={m.id}
                        href={`/admin/consenters/${m.consenterId}`}
                        className="rounded-full border border-ink/15 px-2 py-0.5 text-[10px] hover:border-ink/40"
                      >
                        {m.consenter.displayName} · {m.role.toLowerCase()} · {m.consenter.status === "APPROVED" ? "verified" : m.consenter.status.toLowerCase().replace(/_/g, " ")}
                      </Link>
                    ))}
                    {u.requesterMembers.map((m) => (
                      <span key={m.id} className="rounded-full border border-ink/15 px-2 py-0.5 text-[10px]">{m.requester.displayName} · not paired yet</span>
                    ))}
                  </div>
                </div>
                {u.isBanned ? <StatusBadge status="REJECTED" /> : u.isSuspended ? <StatusBadge status="EXPIRED" /> : <StatusBadge status="ACTIVE" />}
              </div>
              {canEdit ? (
                <form action={userAction} className="flex flex-wrap items-center gap-2 border-t hairline pt-2">
                  <input type="hidden" name="id" value={u.id} />
                  <input type="hidden" name="q" value={q} />
                  <Input name="reason" placeholder="Reason (needed to suspend, ban or re-verify)" className="max-w-72 py-1.5 text-xs" aria-label="Reason" />
                  {u.isSuspended ? (
                    <SubmitButton name="op" value="unsuspend" variant="secondary" size="sm" className="min-h-10">Unsuspend</SubmitButton>
                  ) : (
                    <ConfirmSubmit confirm={`Suspend ${u.name}? They are signed out now.`} name="op" value="suspend" variant="secondary" size="sm" className="min-h-10">
                      Suspend
                    </ConfirmSubmit>
                  )}
                  {u.isBanned ? (
                    <SubmitButton name="op" value="unban" variant="secondary" size="sm" className="min-h-10">Unban</SubmitButton>
                  ) : (
                    <ConfirmSubmit confirm={`Ban ${u.name}? All their sessions end immediately.`} name="op" value="ban" size="sm" className="min-h-10">Ban</ConfirmSubmit>
                  )}
                  {u.consenterMembers.some((m) => m.role === "OWNER" && m.consenter.status === "APPROVED") && (
                    <ConfirmSubmit
                      confirm={`Send ${u.name}'s profiles back to review? They leave search and can't send or receive until verified again, and are told your reason.`}
                      name="op"
                      value="reverify"
                      variant="ghost"
                      size="sm"
                      className="min-h-10"
                    >
                      Force re-verification
                    </ConfirmSubmit>
                  )}
                </form>
              ) : (
                <NoPermission to="suspend, ban or re-verify" perm="edit" module="users" />
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
