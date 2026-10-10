import { revalidatePath } from "next/cache";
import { requireAdmin, hasAdminPerm } from "@/lib/auth";
import { ViewOnlyPage } from "../no-permission";
import { db } from "@/lib/db";
import { PageHeader, Card, Field, Input, Textarea, SectionTitle } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { audit } from "@/lib/audit";

export const metadata = { title: "CMS pages" };

async function savePageAction(formData: FormData) {
  "use server";
  const session = await requireAdmin("cms", "edit");
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "");
  if (!slug || !title) return;
  await db.cmsPage.upsert({ where: { slug }, update: { title, body }, create: { slug, title, body } });
  await audit({ actorId: session.userId, actorName: session.user.name, action: "cms_page_saved", module: "cms", targetId: slug });
  revalidatePath("/admin/cms");
  revalidatePath(`/${slug}`);
}

export default async function AdminCms() {
  const session = await requireAdmin("cms", "view");
  const canEdit = hasAdminPerm(session.user.adminRole, "cms", "edit");
  const pages = await db.cmsPage.findMany({ orderBy: { slug: "asc" } });

  return (
    <div className="space-y-6">
      <PageHeader kicker="Admin" title="CMS pages" desc="Markdown content for the public pages (faq, terms, privacy, contact, pricing-note…)." />
      {!canEdit && <ViewOnlyPage module="cms" />}
      {pages.map((p) => (
        <Card key={p.slug} className="space-y-3">
          <SectionTitle title={`/${p.slug}`} />
          <form action={savePageAction} className="space-y-2">
            <input type="hidden" name="slug" value={p.slug} />
            {/* View-only roles can read and copy the text, but there is nothing to press. */}
            <Field label="Title"><Input name="title" defaultValue={p.title} required readOnly={!canEdit} /></Field>
            <Field label="Body (markdown)"><Textarea name="body" defaultValue={p.body} readOnly={!canEdit} className="min-h-40 font-mono text-xs" /></Field>
            {canEdit && <SubmitButton variant="secondary" size="sm">Save</SubmitButton>}
          </form>
        </Card>
      ))}
      {canEdit && (
        <Card className="space-y-3">
          <SectionTitle title="New page" />
          <form action={savePageAction} className="space-y-2">
            <Field label="Slug"><Input name="slug" placeholder="about" required /></Field>
            <Field label="Title"><Input name="title" required /></Field>
            <Field label="Body (markdown)"><Textarea name="body" className="min-h-28 font-mono text-xs" /></Field>
            <SubmitButton variant="secondary" size="sm">Create</SubmitButton>
          </form>
        </Card>
      )}
    </div>
  );
}
