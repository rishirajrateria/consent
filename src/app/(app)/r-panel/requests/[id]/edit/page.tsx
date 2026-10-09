import { notFound, redirect } from "next/navigation";
import { requireRequester } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, Field, Input, Textarea, Select, SectionTitle, Alert, Divider } from "@/components/ui";
import { SubmitButton, ConfirmSubmit } from "@/components/form";
import { ErrorNote, SuccessNote } from "@/components/error-note";
import {
  saveScopeAction,
  saveDetailsAction,
  uploadRequestFileAction,
  deleteDraftFileAction,
  submitRequestAction,
  withdrawRequestAction,
} from "../../actions";
import { priceFor } from "@/lib/payments";
import { getSettings } from "@/lib/settings";
import { fmtMoney, fmtBytes } from "@/lib/utils";
import type { Selection } from "@/lib/rules";
import { Trash2, Check } from "lucide-react";

export const metadata = { title: "Compose request" };

const fileInputCls =
  "file:mr-3 file:rounded-lg file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white";

export default async function EditRequestPage({ params, searchParams }: PageProps<"/r-panel/requests/[id]/edit">) {
  const { id } = await params;
  const sp = await searchParams;
  const { requester } = await requireRequester();
  const request = await db.consentRequest.findUnique({
    where: { id },
    include: { consenter: true, files: true },
  });
  if (!request || request.requesterId !== requester.id) notFound();
  if (request.status !== "DRAFT") redirect(`/r-panel/requests/${id}`);

  const [platforms, assetTypes, intents, price, settings] = await Promise.all([
    db.platform.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, include: { formats: { where: { active: true } } } }),
    db.assetType.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    db.intentCategory.findMany({ where: { active: true } }),
    priceFor(requester.country),
    getSettings(),
  ]);

  const selections = (request.selections as Selection[]) ?? [];
  const selectedFormatIds = new Set(selections.map((s) => s.formatId));
  const durations = new Map(selections.map((s) => [s.formatId, s.durationSec]));
  const scopeDone = selections.length > 0 && request.assetTypeIds.length > 0;
  const onlyName = request.assetTypeNames.length === 1 && request.assetTypeNames[0]?.toLowerCase() === "name";
  const hasAssets = request.files.some((f) => f.kind === "ASSET");
  const hasRaw = request.files.some((f) => f.kind === "RAW_CONTENT");
  const hasThumb = request.files.some((f) => f.kind === "THUMBNAIL");
  const uploadsDone = (onlyName || hasAssets) && (!request.thumbnailUsed || hasThumb);
  const detailsDone = !!request.context && !!request.creativePlan && !!request.intentCategoryId;

  const steps = [
    ["Scope", scopeDone],
    ["Uploads", scopeDone && uploadsDone],
    ["Details", detailsDone],
    ["Submit", false],
  ] as const;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        kicker={`Request to ${request.consenter.displayName}`}
        title="Compose your request"
        desc="Fill every section. Approval will be bound to the exact files you upload."
      />
      <ErrorNote error={sp.error as string | undefined} />
      {sp.saved && <SuccessNote msg="Saved." />}

      {/* Progress */}
      <ol className="flex flex-wrap gap-2">
        {steps.map(([label, done], i) => (
          <li key={label} className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${done ? "bg-ink text-white" : "glass-subtle text-ink-soft"}`}>
            {done ? <Check className="size-3" aria-hidden /> : <span className="font-mono">{i + 1}</span>}
            {label}
          </li>
        ))}
      </ol>

      {/* Step 1: Scope */}
      <form action={saveScopeAction}>
        <input type="hidden" name="id" value={request.id} />
        <Card className="space-y-5">
          <SectionTitle title="1 · Platforms, formats & assets" desc="Where will it be published, and what of the consenter will you use?" />
          <div className="space-y-4">
            {platforms.map((p) => (
              <fieldset key={p.id}>
                <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-ink-faint">{p.name}</legend>
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  {p.formats.map((f) => (
                    <label key={f.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="formatIds"
                        value={f.id}
                        defaultChecked={selectedFormatIds.has(f.id)}
                        className="size-4 accent-black"
                      />
                      {f.name}
                      {f.isTimed && (
                        <input
                          type="number"
                          name={`duration_${f.id}`}
                          min={1}
                          defaultValue={durations.get(f.id) ?? ""}
                          placeholder="sec"
                          aria-label={`${p.name} ${f.name} duration in seconds`}
                          className="w-16 rounded-lg border border-ink/10 bg-white/70 px-2 py-1 text-xs focus:border-ink/40 focus:outline-none"
                        />
                      )}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
          <Divider />
          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-ink-faint">
              Asset types used
            </legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {assetTypes.map((a) => (
                <label key={a.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="assetTypeIds" value={a.id} defaultChecked={request.assetTypeIds.includes(a.id)} className="size-4 accent-black" />
                  {a.name}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="thumbnailUsed" defaultChecked={request.thumbnailUsed} className="size-4 accent-black" />
            A thumbnail uses the consenter (uploaded separately)
          </label>
          <SubmitButton variant="secondary">Save scope</SubmitButton>
        </Card>
      </form>

      {/* Step 2: Uploads */}
      <Card className="space-y-5" id="uploads">
        <SectionTitle title="2 · Uploads" desc="The exact files, hashed with SHA-256 on upload. For video/audio: the raw final file exactly as it will be published." />
        {([
          ["ASSET", "Assets of the consenter", onlyName ? "Optional (only the Name is used)." : "Required — the exact images/clips you will use.", request.files.filter((f) => f.kind === "ASSET")],
          ["RAW_CONTENT", "Raw final content file", "The full video/post/audio/article draft. You can submit without it, but a certificate is only issued once it's uploaded and approved.", request.files.filter((f) => f.kind === "RAW_CONTENT")],
          ["THUMBNAIL", "Thumbnail", request.thumbnailUsed ? "Required — you indicated the thumbnail uses the consenter." : "Only if the thumbnail uses the consenter.", request.files.filter((f) => f.kind === "THUMBNAIL")],
        ] as const).map(([kind, label, hint, files]) => (
          <div key={kind} className="space-y-2">
            <div className="text-sm font-medium">{label}</div>
            <p className="text-xs text-ink-faint">{hint}</p>
            {files.map((f) => (
              <div key={f.id} className="glass-subtle flex items-center gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="text-[10px] text-ink-faint">{fmtBytes(f.size)} · v{f.version}</span>
                <form action={deleteDraftFileAction}>
                  <input type="hidden" name="id" value={request.id} />
                  <input type="hidden" name="fileId" value={f.id} />
                  <button className="rounded-lg p-1 hover:bg-ink/5" aria-label={`Remove ${f.name}`}>
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </form>
              </div>
            ))}
            <form action={uploadRequestFileAction} className="flex items-center gap-2">
              <input type="hidden" name="id" value={request.id} />
              <input type="hidden" name="kind" value={kind} />
              <Input name="file" type="file" required className={fileInputCls} aria-label={`Upload ${label}`} />
              <SubmitButton variant="secondary" size="sm">Upload</SubmitButton>
            </form>
          </div>
        ))}
      </Card>

      {/* Step 3: Details */}
      <form action={saveDetailsAction}>
        <input type="hidden" name="id" value={request.id} />
        <Card className="space-y-4">
          <SectionTitle title="3 · Context, intent & validity" />
          <Field label="Context" required hint="What is the content about, and where does the consenter appear in it?">
            <Textarea name="context" required minLength={20} defaultValue={request.context} />
          </Field>
          <Field label="Creative plan & intent" required hint={`Min ${settings.minCreativePlanChars} characters — the creative idea and why you're using them (news, commentary, parody, promotion, tribute…).`}>
            <Textarea name="creativePlan" required minLength={settings.minCreativePlanChars} defaultValue={request.creativePlan} className="min-h-32" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Intent category" required>
              <Select name="intentCategoryId" required defaultValue={request.intentCategoryId ?? ""}>
                <option value="" disabled>Choose…</option>
                {intents.map((i) => (
                  <option key={i.id} value={i.id}>{i.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Planned publish date">
              <Input name="plannedPublishAt" type="date" defaultValue={request.plannedPublishAt?.toISOString().slice(0, 10) ?? ""} />
            </Field>
          </div>
          <Field label="Requested validity" required>
            <Select name="validityKind" defaultValue={request.validityKind}>
              <option value="SINGLE_PUBLICATION">Single publication</option>
              <option value="DATE_RANGE">Time window</option>
              <option value="PERPETUAL">Perpetual (consenter may refuse)</option>
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Window start (for time window)">
              <Input name="validFrom" type="date" defaultValue={request.validFrom?.toISOString().slice(0, 10) ?? ""} />
            </Field>
            <Field label="Window end">
              <Input name="validUntil" type="date" defaultValue={request.validUntil?.toISOString().slice(0, 10) ?? ""} />
            </Field>
          </div>
          <SubmitButton variant="secondary">Save details</SubmitButton>
        </Card>
      </form>

      {/* Step 4: Review & submit */}
      <Card strong className="space-y-4" id="review">
        <SectionTitle
          title="4 · Review & submit"
          desc={`Platform fee: ${fmtMoney(price.perRequestFee.toString(), price.currency)}${
            request.consenter.consentPrice
              ? ` + ${request.consenter.displayName}'s consent price: ${fmtMoney(request.consenter.consentPrice.toString(), request.consenter.consentPriceCurrency)} (credited to them, settled weekly)`
              : ""
          } — non-refundable in every outcome (approved, denied, closed, withdrawn or unanswered). The fee buys the ask, not the answer.`}
        />
        {!hasRaw && (
          <Alert tone="warn">
            No raw final content uploaded. You can still submit — if approved, it will be “approved in
            principle” and the certificate is issued only after the final file is uploaded and approved.
          </Alert>
        )}
        <form action={submitRequestAction} className="space-y-4">
          <input type="hidden" name="id" value={request.id} />
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" name="acceptTerms" required className="mt-0.5 size-4 accent-black" />
            <span>
              I accept the terms, including the <strong>mandatory consent-link rule</strong>: the
              verification link or badge must appear in the published content&apos;s
              description/caption/notes. I understand Consent never processes fees between parties and
              the per-request fee is non-refundable.
            </span>
          </label>
          <div className="flex flex-wrap gap-2">
            <SubmitButton disabled={!scopeDone || !detailsDone || !uploadsDone}>
              Pay {fmtMoney(price.perRequestFee.toString(), price.currency)}
              {request.consenter.consentPrice
                ? ` + ${fmtMoney(request.consenter.consentPrice.toString(), request.consenter.consentPriceCurrency)}`
                : ""}{" "}
              & submit
            </SubmitButton>
          </div>
          {(!scopeDone || !detailsDone || !uploadsDone) && (
            <p className="text-xs text-ink-faint">Complete all sections above to submit.</p>
          )}
        </form>
        <form action={withdrawRequestAction}>
          <input type="hidden" name="id" value={request.id} />
          <ConfirmSubmit confirm="Discard this draft?" variant="ghost" size="sm">Discard draft</ConfirmSubmit>
        </form>
      </Card>
    </div>
  );
}
