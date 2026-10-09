import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, Field, Input, Textarea, SectionTitle, StatusBadge } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { audit } from "@/lib/audit";

export const metadata = { title: "Templates" };

async function saveAgreementTemplateAction(formData: FormData) {
  "use server";
  const session = await requireAdmin("templates", "edit");
  const id = String(formData.get("id") ?? "");
  const data = {
    name: String(formData.get("name") ?? "").trim(),
    jurisdiction: String(formData.get("jurisdiction") ?? "GLOBAL").toUpperCase().trim(),
    body: String(formData.get("body") ?? ""),
    disclaimer: String(formData.get("disclaimer") ?? ""),
  };
  if (!data.name || !data.body) return;
  if (id) await db.agreementTemplate.update({ where: { id }, data });
  else await db.agreementTemplate.create({ data: { ...data, optionalClauses: [] } });
  await audit({ actorId: session.userId, actorName: session.user.name, action: "agreement_template_saved", module: "templates", targetId: id || data.name });
  revalidatePath("/admin/templates");
}

async function toggleTemplateAction(formData: FormData) {
  "use server";
  await requireAdmin("templates", "edit");
  const id = String(formData.get("id"));
  const t = await db.agreementTemplate.findUnique({ where: { id } });
  if (t) await db.agreementTemplate.update({ where: { id }, data: { active: !t.active } });
  revalidatePath("/admin/templates");
}

async function saveMessageTemplateAction(formData: FormData) {
  "use server";
  const session = await requireAdmin("templates", "edit");
  const key = String(formData.get("key") ?? "").trim();
  if (!key) return;
  await db.messageTemplate.upsert({
    where: { key },
    update: {
      channel: String(formData.get("channel") ?? "email"),
      subject: String(formData.get("subject") ?? "") || null,
      body: String(formData.get("body") ?? ""),
    },
    create: {
      key,
      channel: String(formData.get("channel") ?? "email"),
      subject: String(formData.get("subject") ?? "") || null,
      body: String(formData.get("body") ?? ""),
    },
  });
  await audit({ actorId: session.userId, actorName: session.user.name, action: "message_template_saved", module: "templates", targetId: key });
  revalidatePath("/admin/templates");
}

export default async function AdminTemplates() {
  await requireAdmin("templates", "view");
  const [agreements, messages] = await Promise.all([
    db.agreementTemplate.findMany({ orderBy: { jurisdiction: "asc" } }),
    db.messageTemplate.findMany({ orderBy: { key: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader kicker="Admin" title="Templates" desc="Legal agreement templates per jurisdiction (with placeholders) and email/SMS message templates." />

      {agreements.map((t) => (
        <Card key={t.id} className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <SectionTitle title={`${t.name} (${t.jurisdiction})`} />
            <form action={toggleTemplateAction} className="flex items-center gap-2">
              <input type="hidden" name="id" value={t.id} />
              <StatusBadge status={t.active ? "ACTIVE" : "CLOSED"} />
              <SubmitButton variant="ghost" size="sm">{t.active ? "Disable" : "Enable"}</SubmitButton>
            </form>
          </div>
          <form action={saveAgreementTemplateAction} className="space-y-3">
            <input type="hidden" name="id" value={t.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name"><Input name="name" defaultValue={t.name} required /></Field>
              <Field label="Jurisdiction (country code or GLOBAL)"><Input name="jurisdiction" defaultValue={t.jurisdiction} required /></Field>
            </div>
            <Field label="Body" hint="Placeholders: {{consenterLegalName}} {{requesterLegalName}} {{date}} {{assetTypes}} {{scope}} {{validity}} {{fee}} {{conditions}} {{fileHashes}}">
              <Textarea name="body" defaultValue={t.body} className="min-h-48 font-mono text-xs" required />
            </Field>
            <Field label="Disclaimer (shown to both parties)">
              <Textarea name="disclaimer" defaultValue={t.disclaimer} className="min-h-16" />
            </Field>
            <SubmitButton variant="secondary" size="sm">Save template</SubmitButton>
          </form>
        </Card>
      ))}

      <Card className="space-y-3">
        <SectionTitle title="New agreement template" />
        <form action={saveAgreementTemplateAction} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><Input name="name" placeholder="India Likeness Licence" required /></Field>
            <Field label="Jurisdiction"><Input name="jurisdiction" placeholder="IN" required /></Field>
          </div>
          <Field label="Body"><Textarea name="body" className="min-h-32 font-mono text-xs" required /></Field>
          <Field label="Disclaimer"><Textarea name="disclaimer" className="min-h-16" /></Field>
          <SubmitButton variant="secondary" size="sm">Create</SubmitButton>
        </form>
      </Card>

      <Card className="space-y-4">
        <SectionTitle title="Email / SMS templates" desc="Override default notification copy by key (e.g. request_received, grant_issued)." />
        {messages.map((m) => (
          <form key={m.key} action={saveMessageTemplateAction} className="space-y-2 border-t hairline pt-3 first:border-t-0 first:pt-0">
            <div className="flex flex-wrap items-center gap-2">
              <code className="font-mono text-xs font-semibold">{m.key}</code>
              <span className="rounded-full bg-ink/5 px-2 py-0.5 text-[10px] uppercase">{m.channel}</span>
            </div>
            <input type="hidden" name="key" value={m.key} />
            <input type="hidden" name="channel" value={m.channel} />
            {m.channel === "email" && <Input name="subject" defaultValue={m.subject ?? ""} placeholder="Subject" />}
            <Textarea name="body" defaultValue={m.body} className="min-h-16" />
            <SubmitButton variant="ghost" size="sm">Save</SubmitButton>
          </form>
        ))}
        <form action={saveMessageTemplateAction} className="flex flex-wrap items-end gap-2 border-t hairline pt-3">
          <Input name="key" placeholder="template_key" className="w-44" aria-label="Template key" required />
          <select name="channel" className="input-glass w-28" aria-label="Channel">
            <option value="email">email</option>
            <option value="sms">sms</option>
          </select>
          <Input name="subject" placeholder="Subject (email)" className="min-w-40 flex-1" aria-label="Subject" />
          <Input name="body" placeholder="Body" className="min-w-40 flex-1" aria-label="Body" required />
          <SubmitButton variant="secondary" size="sm">Add</SubmitButton>
        </form>
      </Card>
    </div>
  );
}
