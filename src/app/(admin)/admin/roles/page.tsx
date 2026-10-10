import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, Field, Input, SectionTitle, Select } from "@/components/ui";
import { SubmitButton, ConfirmSubmit } from "@/components/form";
import { ErrorNote, SuccessNote } from "@/components/error-note";
import { audit } from "@/lib/audit";

export const metadata = { title: "Admin roles" };

const MODULES = ["requesters", "consenters", "users", "requests", "reports", "scores", "catalog", "pricing", "payments", "settings", "templates", "cms", "audit", "takedowns", "analytics"];
const PERMS = ["view", "create", "edit", "approve", "delete", "export"];

async function saveRoleAction(formData: FormData) {
  "use server";
  const session = await requireAdmin();
  if (!session.user.adminRole?.isSuperAdmin) return;
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const permissions: Record<string, string[]> = {};
  for (const m of MODULES) {
    const granted = PERMS.filter((p) => formData.get(`${m}:${p}`) === "on");
    if (granted.length) permissions[m] = granted;
  }
  if (id) await db.adminRole.update({ where: { id }, data: { name, permissions } });
  else await db.adminRole.create({ data: { name, permissions } });
  await audit({ actorId: session.userId, actorName: session.user.name, action: "admin_role_saved", module: "settings", targetId: name });
  revalidatePath("/admin/roles");
}

/** Gives a user an admin role, or (op=remove) takes admin access away. Never your own, never the last Super Admin. */
async function assignRoleAction(formData: FormData) {
  "use server";
  const session = await requireAdmin();
  const back = (key: "error" | "done", msg: string) => redirect(`/admin/roles?${key}=${encodeURIComponent(msg)}`);
  if (!session.user.adminRole?.isSuperAdmin) back("error", "Only a Super Admin can change admin roles.");
  const remove = String(formData.get("op") ?? "") === "remove";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const roleId = remove ? "" : String(formData.get("roleId") ?? "");
  const user = remove
    ? await db.user.findUnique({ where: { id: String(formData.get("userId") ?? "") }, include: { adminRole: true } })
    : await db.user.findUnique({ where: { email }, include: { adminRole: true } });
  if (!user) return back("error", remove ? "That account no longer exists." : `No account uses ${email}. They need to sign up first.`);
  if (!remove && !roleId) return back("error", "Choose a role to give.");
  const role = roleId ? await db.adminRole.findUnique({ where: { id: roleId } }) : null;
  if (roleId && !role) return back("error", "That role no longer exists. Pick another.");
  if (user.id === session.userId) return back("error", "You can't change your own admin access. Ask another Super Admin.");
  if (user.adminRole?.isSuperAdmin && !role?.isSuperAdmin) {
    const superAdmins = await db.user.count({ where: { adminRole: { isSuperAdmin: true } } });
    if (superAdmins <= 1) return back("error", "This is the last Super Admin. Make someone else Super Admin first.");
  }
  await db.user.update({ where: { id: user.id }, data: { adminRoleId: role?.id ?? null } });
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: role ? "admin_role_assigned" : "admin_role_removed",
    module: "settings",
    targetId: user.id,
    detail: { email: user.email, roleId: role?.id ?? null },
  });
  revalidatePath("/admin/roles");
  back("done", role ? `${user.name} is now ${role.name}.` : `${user.name} no longer has admin access.`);
}

export default async function AdminRoles({ searchParams }: PageProps<"/admin/roles">) {
  const session = await requireAdmin();
  const sp = await searchParams;
  const isSuper = !!session.user.adminRole?.isSuperAdmin;
  const [roles, admins] = await Promise.all([
    db.adminRole.findMany({ orderBy: { name: "asc" }, include: { users: true } }),
    db.user.findMany({ where: { adminRoleId: { not: null } }, include: { adminRole: true } }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader kicker="Admin · RBAC" title="Admin roles" desc="Granular permissions per module. Only the Super Admin can change roles. All admins require 2FA." />

      <ErrorNote error={sp.error} />
      {typeof sp.done === "string" && <SuccessNote msg={sp.done} />}

      <Card className="space-y-2">
        <SectionTitle title="Current admins" />
        {admins.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center gap-2 border-t hairline py-2 text-sm first:border-t-0">
            <span className="font-medium">{a.name}</span>
            <span className="text-xs text-ink-faint">{a.email}</span>
            <span className="ml-auto rounded-full bg-ink px-2 py-0.5 text-[10px] font-semibold uppercase text-white">{a.adminRole?.name}</span>
            {isSuper && a.id !== session.userId && (
              <form action={assignRoleAction}>
                <input type="hidden" name="userId" value={a.id} />
                <ConfirmSubmit
                  confirm={`Remove admin access for ${a.name}? Their normal account stays.`}
                  name="op"
                  value="remove"
                  size="sm"
                  className="min-h-10"
                >
                  Remove
                </ConfirmSubmit>
              </form>
            )}
          </div>
        ))}
      </Card>

      {roles.filter((r) => !r.isSuperAdmin).map((r) => {
        const perms = (r.permissions as Record<string, string[]>) ?? {};
        return (
          <Card key={r.id} className="space-y-3">
            <SectionTitle title={r.name} desc={`${r.users.length} member(s)`} />
            {isSuper ? (
              <form action={saveRoleAction} className="space-y-3">
                <input type="hidden" name="id" value={r.id} />
                <input type="hidden" name="name" value={r.name} />
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-xs">
                    <thead>
                      <tr className="text-left text-[9px] font-semibold uppercase tracking-wider text-ink-faint">
                        <th className="py-1">Module</th>
                        {PERMS.map((p) => <th key={p} className="px-2 text-center">{p}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {MODULES.map((m) => (
                        <tr key={m} className="border-t hairline">
                          <td className="py-1.5 font-medium">{m}</td>
                          {PERMS.map((p) => (
                            <td key={p} className="px-2 text-center">
                              <input type="checkbox" name={`${m}:${p}`} defaultChecked={perms[m]?.includes(p)} className="size-3.5 accent-black" aria-label={`${r.name} ${m} ${p}`} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <SubmitButton variant="secondary" size="sm">Save permissions</SubmitButton>
              </form>
            ) : (
              <p className="text-xs text-ink-faint">
                {Object.entries(perms).map(([m, ps]) => `${m}: ${ps.join("/")}`).join(" · ") || "No permissions"}
              </p>
            )}
          </Card>
        );
      })}

      {/* Assign comes after the role cards, so the permissions are read before a role is given. */}
      {isSuper && (
        <Card className="space-y-3">
          <SectionTitle title="Give someone a role" desc="They must already have a Consent account." />
          <form action={assignRoleAction} className="flex flex-wrap items-end gap-2">
            <div className="min-w-48 flex-1">
              <Field label="User email" required><Input name="email" type="email" required placeholder="person@team.com" /></Field>
            </div>
            <Field label="Role" required>
              <Select name="roleId" required defaultValue="">
                <option value="" disabled>Choose a role…</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>{r.isSuperAdmin ? `${r.name} (can do everything)` : r.name}</option>
                ))}
              </Select>
            </Field>
            <SubmitButton variant="secondary">Give role</SubmitButton>
          </form>
        </Card>
      )}

      {isSuper && (
        <Card className="space-y-3">
          <SectionTitle title="New role" />
          <form action={saveRoleAction} className="flex flex-wrap items-end gap-2">
            <div className="min-w-48 flex-1">
              <Field label="Role name" required><Input name="name" required placeholder="Compliance Reviewer" /></Field>
            </div>
            <SubmitButton variant="secondary" size="sm">Create (set permissions after)</SubmitButton>
          </form>
        </Card>
      )}
    </div>
  );
}
