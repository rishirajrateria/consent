import { revalidatePath } from "next/cache";
import { requireAdmin, hasAdminPerm } from "@/lib/auth";
import { ViewOnlyPage } from "../no-permission";
import { db } from "@/lib/db";
import { PageHeader, Card, Input, SectionTitle } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { audit } from "@/lib/audit";
import { cn } from "@/lib/utils";

export const metadata = { title: "Platforms & catalog" };

async function catalogAction(formData: FormData) {
  "use server";
  const session = await requireAdmin("catalog", "edit");
  const op = String(formData.get("op"));
  const kind = String(formData.get("kind"));
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();

  if (op === "add" && name) {
    if (kind === "platform") await db.platform.create({ data: { name, sortOrder: 99 } });
    if (kind === "format") {
      const platformId = String(formData.get("platformId"));
      await db.format.create({ data: { platformId, name, isTimed: formData.get("isTimed") === "on" } });
    }
    if (kind === "assetType") await db.assetType.create({ data: { name, sortOrder: 99 } });
    if (kind === "intent") await db.intentCategory.create({ data: { name } });
    if (kind === "denial") await db.denialReason.create({ data: { label: name } });
  }
  if (op === "toggle" && id) {
    if (kind === "platform") {
      const row = await db.platform.findUnique({ where: { id } });
      if (row) await db.platform.update({ where: { id }, data: { active: !row.active } });
    }
    if (kind === "format") {
      const row = await db.format.findUnique({ where: { id } });
      if (row) await db.format.update({ where: { id }, data: { active: !row.active } });
    }
    if (kind === "assetType") {
      const row = await db.assetType.findUnique({ where: { id } });
      if (row) await db.assetType.update({ where: { id }, data: { active: !row.active } });
    }
    if (kind === "intent") {
      const row = await db.intentCategory.findUnique({ where: { id } });
      if (row) await db.intentCategory.update({ where: { id }, data: { active: !row.active } });
    }
    if (kind === "denial") {
      const row = await db.denialReason.findUnique({ where: { id } });
      if (row) await db.denialReason.update({ where: { id }, data: { active: !row.active } });
    }
  }
  await audit({ actorId: session.userId, actorName: session.user.name, action: `catalog_${op}`, module: "catalog", targetId: id || name, detail: { kind } });
  revalidatePath("/admin/catalog");
}

function Chip({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", active ? "bg-ink/5 text-ink" : "border border-dashed border-ink/20 text-ink-faint line-through")}>
      {children}
    </span>
  );
}

export default async function AdminCatalog() {
  const session = await requireAdmin("catalog", "view");
  const canEdit = hasAdminPerm(session.user.adminRole, "catalog", "edit");
  const [platforms, assetTypes, intents, denials] = await Promise.all([
    db.platform.findMany({ orderBy: { sortOrder: "asc" }, include: { formats: true } }),
    db.assetType.findMany({ orderBy: { sortOrder: "asc" } }),
    db.intentCategory.findMany(),
    db.denialReason.findMany(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader kicker="Admin" title="Platforms & catalog" desc="Platforms, formats, asset types, intent categories and denial reasons are data, not code. Toggling off hides an item from new requests without breaking old ones." />
      {!canEdit && <ViewOnlyPage module="catalog" />}

      {/* View-only roles see the catalog but can't toggle or add anything the server will refuse. */}
      <fieldset disabled={!canEdit} className="min-w-0 space-y-6">
        <Card className="space-y-4">
          <SectionTitle title="Platforms & formats" />
          {platforms.map((p) => (
            <div key={p.id} className="space-y-1.5 border-t hairline pt-3 first:border-t-0 first:pt-0">
              <form action={catalogAction} className="flex items-center gap-2">
                <input type="hidden" name="kind" value="platform" />
                <input type="hidden" name="id" value={p.id} />
                <span className={cn("text-sm font-semibold", !p.active && "text-ink-faint line-through")}>{p.name}</span>
                <SubmitButton name="op" value="toggle" variant="ghost" size="sm">{p.active ? "Disable" : "Enable"}</SubmitButton>
              </form>
              <div className="flex flex-wrap items-center gap-1.5">
                {p.formats.map((f) => (
                  <form key={f.id} action={catalogAction} className="inline">
                    <input type="hidden" name="kind" value="format" />
                    <input type="hidden" name="id" value={f.id} />
                    <button name="op" value="toggle" title="Toggle" className="cursor-pointer disabled:cursor-default">
                      <Chip active={f.active}>{f.name}{f.isTimed ? " ⏱" : ""}</Chip>
                    </button>
                  </form>
                ))}
                <form action={catalogAction} className="flex items-center gap-1">
                  <input type="hidden" name="kind" value="format" />
                  <input type="hidden" name="platformId" value={p.id} />
                  <Input name="name" placeholder="New format" className="w-32 py-1 text-xs" aria-label={`New format for ${p.name}`} />
                  <label className="flex items-center gap-1 text-[10px] text-ink-soft">
                    <input type="checkbox" name="isTimed" className="size-3 accent-black" /> timed
                  </label>
                  <SubmitButton name="op" value="add" variant="ghost" size="sm">+</SubmitButton>
                </form>
              </div>
            </div>
          ))}
          <form action={catalogAction} className="flex items-center gap-2 border-t hairline pt-3">
            <input type="hidden" name="kind" value="platform" />
            <Input name="name" placeholder="New platform" className="max-w-48" aria-label="New platform" />
            <SubmitButton name="op" value="add" variant="secondary" size="sm">Add platform</SubmitButton>
          </form>
        </Card>

        {([
          ["assetType", "Asset types", assetTypes.map((a) => ({ id: a.id, label: a.name, active: a.active }))],
          ["intent", "Intent categories", intents.map((i) => ({ id: i.id, label: i.name, active: i.active }))],
          ["denial", "Denial reasons", denials.map((d) => ({ id: d.id, label: d.label, active: d.active }))],
        ] as const).map(([kind, title, items]) => (
          <Card key={kind} className="space-y-3">
            <SectionTitle title={title} />
            <div className="flex flex-wrap items-center gap-1.5">
              {items.map((item) => (
                <form key={item.id} action={catalogAction} className="inline">
                  <input type="hidden" name="kind" value={kind} />
                  <input type="hidden" name="id" value={item.id} />
                  <button name="op" value="toggle" title="Toggle" className="cursor-pointer disabled:cursor-default">
                    <Chip active={item.active}>{item.label}</Chip>
                  </button>
                </form>
              ))}
            </div>
            <form action={catalogAction} className="flex items-center gap-2">
              <input type="hidden" name="kind" value={kind} />
              <Input name="name" placeholder={`New ${title.toLowerCase().slice(0, -1)}`} className="max-w-48" aria-label={`New ${title}`} />
              <SubmitButton name="op" value="add" variant="secondary" size="sm">Add</SubmitButton>
            </form>
          </Card>
        ))}
      </fieldset>
    </div>
  );
}
