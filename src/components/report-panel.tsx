import { Card, SectionTitle, Field, Input, Textarea, Select, StatusBadge } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { fileReportAction, respondReportAction } from "@/app/(app)/requests/report-actions";
import { ViewOnlyNote, type FullRequest } from "@/components/request-view";
import { fmtDateTime } from "@/lib/utils";
import { Flag } from "lucide-react";

const REASONS = [
  "Used without consent",
  "Exceeded approved scope",
  "Used after expiry/revocation",
  "Missing consent link",
  "Misrepresentation",
  "Harassment",
  "Other",
];

const fileInputCls =
  "file:mr-3 file:rounded-lg file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white";

/** Breach reports on this request: list, respond, and file a new one. */
export function ReportPanel({
  request,
  side,
  canAct = true,
}: {
  request: FullRequest;
  side: "consenter" | "requester";
  /** False for read-only seats (requester viewers): the reports only, no forms. */
  canAct?: boolean;
}) {
  const reports = request.reports ?? [];
  return (
    <Card className="space-y-4" id="report">
      <SectionTitle
        title="Breach reports"
        desc="Upheld reports affect the public Consent Score. Consent takes no further enforcement action — legal matters stay between the parties."
      />
      {reports.map((r) => (
        <div key={r.id} className="glass-subtle space-y-2 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Flag className="size-4" aria-hidden />
            <span className="font-medium">{r.reason}</span>
            <span className="text-xs text-ink-faint">by {r.bySide} · {fmtDateTime(r.createdAt)}</span>
            <StatusBadge status={r.status} className="ml-auto" />
          </div>
          <p className="text-xs text-ink-soft">{r.description}</p>
          {r.evidenceLinks.length > 0 && (
            <p className="text-xs text-ink-faint">Links: {r.evidenceLinks.join(" · ")}</p>
          )}
          {r.response && <p className="text-xs text-ink-soft"><strong>Response:</strong> {r.response}</p>}
          {canAct && !r.response && r.bySide !== side && (r.status === "OPEN" || r.status === "UNDER_REVIEW") && (
            <form action={respondReportAction} className="flex flex-wrap items-end gap-2 border-t hairline pt-2">
              <input type="hidden" name="reportId" value={r.id} />
              <div className="min-w-48 flex-1">
                <Field label="Your response">
                  <Input name="response" placeholder="Your side of the story for the review team" required />
                </Field>
              </div>
              <SubmitButton variant="secondary" size="sm">Respond</SubmitButton>
            </form>
          )}
        </div>
      ))}

      {!canAct && <ViewOnlyNote />}
      {canAct && (
        <details>
          <summary className="cursor-pointer text-sm font-medium text-ink-soft hover:text-ink">
            <Flag className="mr-1 inline size-4" aria-hidden /> Report a breach on this {side === "consenter" ? "requester" : "consenter"}
          </summary>
          <form action={fileReportAction} className="mt-3 space-y-3 border-l-2 border-ink/10 pl-4">
            <input type="hidden" name="id" value={request.id} />
            <Field label="Category" required>
              <Select name="reason" required defaultValue="">
                <option value="" disabled>Choose…</option>
                {REASONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </Select>
            </Field>
            <Field label="Description" required hint="What happened? Min 20 characters.">
              <Textarea name="description" required minLength={20} className="min-h-20" />
            </Field>
            <Field label="Evidence links" hint="One per line.">
              <Textarea name="links" className="min-h-14" placeholder="https://…" />
            </Field>
            <Field label="Evidence file (screenshot, export)">
              <Input name="evidence" type="file" className={fileInputCls} />
            </Field>
            <SubmitButton variant="secondary">File report</SubmitButton>
          </form>
        </details>
      )}
    </Card>
  );
}
