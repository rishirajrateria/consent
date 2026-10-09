import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, Field, Input, SectionTitle, Select } from "@/components/ui";
import { SubmitButton } from "@/components/form";
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

async function assignRoleAction(formData: FormData) {
  "use server";
  const session = await requireAdmin();
  if (!session.user.adminRole?.isSuperAdmin) return;
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const roleId = String(formData.get("roleId") ?? "");
  const user = await db.user.findUnique({ where: { email } });
  if (!user) return;
  await db.user.update({ where: { id: user.id }, data: { adminRoleId: roleId || null } });
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: roleId ? "admin_role_assigned" : "admin_role_removed",
    module: "settings",
    targetId: user.id,
    detail: { email, roleId },
  });
  revalidatePath("/admin/roles");
}

export default async function AdminRoles() {
  const session = await requireAdmin();
  const isSuper = !!session.user.adminRole?.isSuperAdmin;
  const [roles, admins] = await Promise.all([
    db.adminRole.findMany({ orderBy: { name: "asc" }, include: { users: true } }),
    db.user.findMany({ where: { adminRoleId: { not: null } }, include: { adminRole: true } }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader kicker="Admin · RBAC" title="Admin roles" desc="Granular permissions per module. Only the Super Admin can change roles. All admins require 2FA." />

      <Card className="space-y-2">
        <SectionTitle title="Current admins" />
        {admins.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center gap-2 border-t hairline py-2 text-sm first:border-t-0">
            <span className="font-medium">{a.name}</span>
            <span className="text-xs text-ink-faint">{a.email}</span>
            <span className="ml-auto rounded-full bg-ink px-2 py-0.5 text-[10px] font-semibold uppercase text-white">{a.adminRole?.name}</span>
          </div>
        ))}
        {isSuper && (
          <form action={assignRoleAction} className="flex flex-wrap items-end gap-2 border-t hairline pt-3">
            <div className="min-w-48 flex-1">
              <Field label="User email" required><Input name="email" type="email" required placeholder="person@team.com" /></Field>
            </div>
            <Field label="Role">
              <Select name="roleId" defaultValue="">
                <option value="">— remove admin access</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </Select>
            </Field>
            <SubmitButton variant="secondary" size="sm">Assign</SubmitButton>
          </form>
        )}
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
