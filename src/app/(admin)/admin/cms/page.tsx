import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, hasAdminPerm } from "@/lib/auth";
import { ViewOnlyPage } from "../no-permission";
import { db } from "@/lib/db";
import { PageHeader, Card, Field, Input, Textarea, SectionTitle, Alert } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { audit } from "@/lib/audit";
import { ErrorNote, SuccessNote } from "@/components/error-note";

export const metadata = { title: "Pages & messages" };

/** Message overrides were their own module ("templates") before; that permission still counts. */
const canEditMessages = (role: { isSuperAdmin: boolean; permissions: unknown } | null | undefined) =>
  hasAdminPerm(role, "cms", "edit") || hasAdminPerm(role, "templates", "edit");

/** Admin-editable email/SMS copy, by key (see lib/templates renderMessage). */
async function saveMessageTemplateAction(formData: FormData) {
  "use server";
  const session = await requireAdmin();
  if (!canEditMessages(session.user.adminRole)) redirect("/admin?denied=1");
  const key = String(formData.get("key") ?? "").trim();
  if (!key) redirect(`/admin/cms?error=${encodeURIComponent("Give the message a key.")}#messages`);
  const data = {
    channel: String(formData.get("channel") ?? "email") === "sms" ? "sms" : "email",
    subject: String(formData.get("subject") ?? "") || null,
    body: String(formData.get("body") ?? ""),
  };
  await db.messageTemplate.upsert({ where: { key }, update: data, create: { key, ...data } });
  await audit({ actorId: session.userId, actorName: session.user.name, action: "message_template_saved", module: "cms", targetId: key });
  revalidatePath("/admin/cms");
  redirect(`/admin/cms?done=${encodeURIComponent("Message saved.")}#messages`);
}

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

export default async function AdminCms({ searchParams }: PageProps<"/admin/cms">) {
  const session = await requireAdmin();
  // The retired "templates" key still opens the page (for its messages), as it still saves them.
  const role = session.user.adminRole;
  if (!(hasAdminPerm(role, "cms", "view") || hasAdminPerm(role, "templates", "view"))) redirect("/admin?denied=1");
  const canEdit = hasAdminPerm(role, "cms", "edit");
  const canEditMsgs = canEditMessages(role);
  const sp = await searchParams;
  const [pages, messages] = await Promise.all([
    db.cmsPage.findMany({ orderBy: { slug: "asc" } }),
    db.messageTemplate.findMany({ orderBy: { key: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Admin"
        title="Pages & messages"
        desc="Markdown content for the public pages (faq, terms, privacy, contact, pricing-note…) and the email/SMS copy you override."
      />
      {!canEdit && !canEditMsgs && <ViewOnlyPage module="cms" />}
      {!canEdit && canEditMsgs && <Alert>You can edit the email and SMS messages. The pages are view-only for your role.</Alert>}
      <ErrorNote error={sp.error} />
      {typeof sp.done === "string" && <SuccessNote msg={sp.done} />}
      {/* Pages need "edit" on Pages & messages; view-only roles can read them, with nothing to press. */}
      <fieldset disabled={!canEdit} className="min-w-0 space-y-6">
        {pages.map((p) => (
          <Card key={p.slug} className="space-y-3">
            <SectionTitle title={`/${p.slug}`} />
            <form action={savePageAction} className="space-y-2">
              <input type="hidden" name="slug" value={p.slug} />
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
      </fieldset>
      <Card className="space-y-4" id="messages">
        <SectionTitle
          title="Email and SMS messages"
          desc="Override the built-in copy by key (in use: otp_email, otp_sms, invite_email). {{placeholders}} are filled in."
        />
        {messages.length === 0 && <p className="text-sm text-ink-faint">No overrides yet. The built-in copy is used.</p>}
        <fieldset disabled={!canEditMsgs} className="min-w-0 space-y-4">
          {messages.map((m) => (
            <form key={m.key} action={saveMessageTemplateAction} className="space-y-2 border-t hairline pt-3 first:border-t-0 first:pt-0">
              <div className="flex flex-wrap items-center gap-2">
                <code className="font-mono text-xs font-semibold">{m.key}</code>
                <span className="rounded-full bg-ink/5 px-2 py-0.5 text-[10px] uppercase">{m.channel}</span>
              </div>
              <input type="hidden" name="key" value={m.key} />
              <input type="hidden" name="channel" value={m.channel} />
              {m.channel === "email" && <Input name="subject" defaultValue={m.subject ?? ""} placeholder="Subject" aria-label={`${m.key} subject`} />}
              <Textarea name="body" defaultValue={m.body} className="min-h-16" aria-label={`${m.key} body`} />
              <SubmitButton variant="ghost" size="sm">Save</SubmitButton>
            </form>
          ))}
          <form action={saveMessageTemplateAction} className="flex flex-wrap items-end gap-2 border-t hairline pt-3">
            <Input name="key" placeholder="template_key" className="w-44" aria-label="Message key" required />
            <select name="channel" className="input-glass w-28" aria-label="Channel">
              <option value="email">email</option>
              <option value="sms">sms</option>
            </select>
            <Input name="subject" placeholder="Subject (email)" className="min-w-40 flex-1" aria-label="Subject" />
            <Input name="body" placeholder="Body" className="min-w-40 flex-1" aria-label="Body" required />
            <SubmitButton variant="secondary" size="sm">Add</SubmitButton>
          </form>
        </fieldset>
      </Card>
    </div>
  );
}
