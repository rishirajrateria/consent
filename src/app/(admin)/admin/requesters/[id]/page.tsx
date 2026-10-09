import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { PageHeader, Card, StatusBadge, KV, Field, Textarea, SectionTitle } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { SuccessNote } from "@/components/error-note";
import { decideRequesterAction } from "../actions";
import { fmtDateTime, titleCase, fmtBytes } from "@/lib/utils";
import { FileText, ExternalLink } from "lucide-react";

export const metadata = { title: "Review requester" };

export default async function RequesterDetail({ params, searchParams }: PageProps<"/admin/requesters/[id]">) {
  await requireAdmin("requesters", "view");
  const { id } = await params;
  const sp = await searchParams;
  const r = await db.requesterProfile.findUnique({
    where: { id },
    include: {
      members: { include: { user: true } },
      documents: true,
      socialAccounts: true,
      payments: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!r) notFound();
  const channels = (r.channels as { platform: string; url: string; followers: number }[]) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Requester application"
        title={r.displayName}
        desc={`${titleCase(r.type)} · ${r.country}`}
        action={<StatusBadge status={r.status} />}
      />
      {sp.done && <SuccessNote msg="Decision recorded and the applicant was notified." />}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-1">
          <SectionTitle title="Application" />
          <KV k="Legal name" v={r.legalName} />
          <KV k="Signatory" v={r.signatoryName ?? "—"} />
          <KV k="Categories" v={r.categories.join(", ") || "—"} />
          <KV k="Applied" v={fmtDateTime(r.createdAt)} />
          <KV k="Description" v={r.description ?? "—"} />
          <KV
            k="Owner"
            v={r.members.map((m) => `${m.user.name} (${m.user.email}) — ${titleCase(m.role)}`).join("; ")}
          />
        </Card>

        <Card className="space-y-3">
          <SectionTitle title="Channels" />
          {channels.map((c, i) => (
            <div key={i} className="flex items-center justify-between gap-2 text-sm">
              <span className="font-medium">{c.platform}</span>
              <a href={c.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 truncate text-ink-soft underline underline-offset-4">
                {c.url} <ExternalLink className="size-3 shrink-0" aria-hidden />
              </a>
              <span className="shrink-0 text-xs text-ink-faint">{c.followers.toLocaleString()} followers</span>
            </div>
          ))}
          <SectionTitle title="Social proof" />
          {r.socialAccounts.length === 0 && <p className="text-sm text-ink-faint">None connected.</p>}
          {r.socialAccounts.map((s) => (
            <div key={s.id} className="flex items-center justify-between text-sm">
              <span>{s.platformName} — {s.handle}</span>
              <StatusBadge status={s.verifiedAt ? "VERIFIED" : "PENDING"} />
            </div>
          ))}
        </Card>

        <Card className="space-y-3">
          <SectionTitle title="Documents" desc="Private; links expire in 10 minutes." />
          {r.documents.map((d) => (
            <a
              key={d.id}
              href={storage.signedUrl(d.storageKey, d.name, 600)}
              target="_blank"
              rel="noreferrer"
              className="glass-subtle flex items-center gap-2 px-4 py-3 text-sm hover:border-ink/20"
            >
              <FileText className="size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{d.name}</span>
              <span className="text-xs text-ink-faint">{fmtBytes(d.size)}</span>
            </a>
          ))}
          {r.documents.length === 0 && <p className="text-sm text-ink-faint">No documents uploaded.</p>}
        </Card>

        <Card className="space-y-4">
          <SectionTitle title="Decision" desc="The applicant is notified in-app and by email." />
          <form action={decideRequesterAction} className="space-y-3">
            <input type="hidden" name="id" value={r.id} />
            <Field label="Message to applicant" hint="Required for reject / more info.">
              <Textarea name="note" placeholder="e.g. Please upload a clearer scan of your registration certificate." />
            </Field>
            <div className="flex flex-wrap gap-2">
              <SubmitButton name="decision" value="approve">Approve</SubmitButton>
              <SubmitButton name="decision" value="more_info" variant="secondary">Ask for info</SubmitButton>
              <SubmitButton name="decision" value="under_review" variant="secondary">Mark under review</SubmitButton>
              <SubmitButton name="decision" value="reject" variant="danger">Reject</SubmitButton>
            </div>
          </form>
        </Card>

        {r.payments.length > 0 && (
          <Card className="space-y-2 lg:col-span-2">
            <SectionTitle title="Payments" />
            {r.payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 text-sm">
                <span>{titleCase(p.purpose)} · {p.currency} {p.amount.toString()} · {fmtDateTime(p.createdAt)}</span>
                <StatusBadge status={p.status} />
              </div>
            ))}
          </Card>
        )}
      </div>
    </div>
  );
}
