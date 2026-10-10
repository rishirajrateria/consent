import { notFound, redirect } from "next/navigation";
import { requireRequester } from "@/lib/auth";
import { db } from "@/lib/db";
import type { ReactNode } from "react";
import { PageHeader, Card, Field, Input, Textarea, Select, SectionTitle, Alert, Divider, ButtonLink, KV } from "@/components/ui";
import { SubmitButton, ConfirmSubmit } from "@/components/form";
import { ErrorNote, SuccessNote } from "@/components/error-note";
import {
  saveScopeAction,
  saveDetailsAction,
  uploadRequestFileAction,
  deleteDraftFileAction,
  submitRequestAction,
  discardDraftAction,
} from "../../actions";
import { consentPriceFor, requestChargesFor } from "@/lib/payments";
import { splitConsentFee } from "@/lib/escrow";
import { PLATFORM_PCT } from "@/lib/platform-fee";
import { MoneyRows, MoneyRow } from "@/components/request-view";
import { openAsRightProfile, pathWithQuery } from "@/app/(app)/requests/open-as";
import { blockedCombinations, blockedPayNote } from "@/lib/precheck";
import { getSettings } from "@/lib/settings";
import { requestCapacity } from "@/lib/capacity";
import { PausedSentence } from "../../../paused-sentence";
import { fmtMoney, fmtBytes, fmtDate } from "@/lib/utils";
import type { Selection } from "@/lib/rules";
import { Trash2, Check } from "lucide-react";
import { UnsavedGuard, TrackedForm, UnsavedNote, PayButton } from "./unsaved-guard";

export const metadata = { title: "Compose request" };

const fileInputCls =
  "file:mr-3 file:rounded-lg file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white";

export default async function EditRequestPage({ params, searchParams }: PageProps<"/r-panel/requests/[id]/edit">) {
  const { id } = await params;
  const sp = await searchParams;
  const { requester, session } = await requireRequester();
  const request = await db.consentRequest.findUnique({
    where: { id },
    include: {
      consenter: { include: { priceTiers: true } },
      files: true,
      requester: { select: { id: true, consenterId: true } },
    },
  });
  if (!request) notFound();
  // A draft of another profile this person is on: switch to it first.
  if (request.requesterId !== requester.id)
    await openAsRightProfile(session.userId, request, "sent", pathWithQuery(`/r-panel/requests/${id}/edit`, sp));
  if (request.status !== "DRAFT") redirect(`/r-panel/requests/${id}`);

  const [platforms, assetTypes, intents, charges, settings, capacity] = await Promise.all([
    db.platform.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, include: { formats: { where: { active: true } } } }),
    db.assetType.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    db.intentCategory.findMany({ where: { active: true } }),
    // What sending it costs, worked out exactly as checkout will charge it.
    requestChargesFor(request.id),
    getSettings(),
    // The owner's request limits: while paused, the draft is kept but can't be sent.
    requestCapacity(request.consenterId),
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
  const name = request.consenter.displayName;
  // Pairs the owner's public matrix never allows: found now, before any money moves.
  const blocked = await blockedCombinations({
    consenterId: request.consenterId,
    requester,
    selections,
    assetTypeIds: request.assetTypeIds,
  });
  // The consent request fee for the chosen intent (a tier, or the profile's fee); null when free.
  const askCurrency = request.consenter.consentPriceCurrency;
  const intentPrices = new Map(intents.map((i) => [i.id, consentPriceFor(request.consenter, i.id)]));
  const showIntentPrices = [...intentPrices.values()].some(Boolean);
  const money = (n: number) => fmtMoney(n, charges.currency);
  // What comes back if they don't say yes (80%; Consent keeps 20%).
  const refundText = money(splitConsentFee(charges.consentFee).refund);
  const totalText = money(charges.total);
  const payReason = blocked.length
    ? blockedPayNote(name)
    : !scopeDone || !detailsDone || !uploadsDone
      ? "Complete every section above to send it."
      : capacity.paused
        ? `Your draft is kept. Send it once ${name} opens new requests again.`
        : null;
  const reviewFiles = (["ASSET", "RAW_CONTENT", "THUMBNAIL"] as const).flatMap((kind) =>
    request.files.filter((f) => f.kind === kind).sort((a, b) => b.version - a.version)
  );

  const steps = [
    ["Scope", scopeDone && blocked.length === 0],
    ["Uploads", scopeDone && uploadsDone],
    ["Details", detailsDone],
    ["Send", false],
  ] as const;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        kicker={`Request to ${request.consenter.displayName}`}
        title="Compose your request"
        desc="Fill every section. Approval will be bound to the exact files you upload."
        action={
          // Up here, away from Send: the last control on the page is the one that sends it.
          <form action={discardDraftAction}>
            <input type="hidden" name="id" value={request.id} />
            <ConfirmSubmit confirm="Discard this draft? Its text and files will be deleted." variant="ghost" size="sm">
              Discard draft
            </ConfirmSubmit>
          </form>
        }
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

      <UnsavedGuard className="space-y-6">
        {/* Step 1: Scope */}
        <TrackedForm section="scope" label="section 1" action={saveScopeAction}>
          <input type="hidden" name="id" value={request.id} />
          <Card className="space-y-5" id="scope">
            <SectionTitle title="1 · Platforms, formats & assets" desc={`Where will it be published, and what of ${name} will you use?`} />
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
              A thumbnail shows {name} (uploaded separately)
            </label>
            {blocked.length > 0 && (
              <Alert tone="warn">
                <ul className="space-y-1">
                  {blocked.map((b, i) => (
                    <li key={i}>
                      {name} never allows {b.platformName} → {b.formatName} with {b.assetName}.
                    </li>
                  ))}
                </ul>
                <p className="mt-1">Remove {blocked.length === 1 ? "it" : "them"} to continue.</p>
              </Alert>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <SubmitButton variant="secondary">Save scope</SubmitButton>
              <UnsavedNote section="scope" />
            </div>
          </Card>
        </TrackedForm>

        {/* Step 2: Uploads */}
        <Card className="space-y-5" id="uploads">
          <SectionTitle title="2 · Uploads" desc="The exact files, fingerprinted (SHA-256) on upload. For video or audio: the final file exactly as it will be published." />
          {([
            ["ASSET", `Assets of ${name}`, onlyName ? "Optional (only their name is used)." : "Required: the exact images or clips you will use.", request.files.filter((f) => f.kind === "ASSET")],
            ["RAW_CONTENT", "Final content file", "The full video, post, audio or article. You can send without it; the certificate is issued once it's uploaded after a yes.", request.files.filter((f) => f.kind === "RAW_CONTENT")],
            ["THUMBNAIL", "Thumbnail", request.thumbnailUsed ? `Required: you said the thumbnail shows ${name}.` : `Only if the thumbnail shows ${name}.`, request.files.filter((f) => f.kind === "THUMBNAIL")],
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
        <TrackedForm section="details" label="section 3" action={saveDetailsAction}>
          <input type="hidden" name="id" value={request.id} />
          <Card className="space-y-4" id="details">
            <SectionTitle title="3 · Context, intent & validity" />
            <Field label="Context" required hint={`What is the content about, and where does ${name} appear in it?`}>
              <Textarea name="context" required minLength={20} defaultValue={request.context} />
            </Field>
            <Field label="Creative plan & intent" required hint={`Min ${settings.minCreativePlanChars} characters — the creative idea and why you're using them (news, commentary, parody, promotion, tribute…).`}>
              <Textarea name="creativePlan" required minLength={settings.minCreativePlanChars} defaultValue={request.creativePlan} className="min-h-32" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Intent category" required>
                <Select name="intentCategoryId" required defaultValue={request.intentCategoryId ?? ""}>
                  <option value="" disabled>Choose…</option>
                  {intents.map((i) => {
                    const p = intentPrices.get(i.id);
                    return (
                      <option key={i.id} value={i.id}>
                        {i.name}
                        {showIntentPrices
                          ? ` — ${p ? `${fmtMoney(p.toString(), askCurrency)} consent request fee` : "free to ask"}`
                          : ""}
                      </option>
                    );
                  })}
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
                <option value="PERPETUAL">Perpetual (they may refuse)</option>
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
            <div className="flex flex-wrap items-center gap-3">
              <SubmitButton variant="secondary">Save details</SubmitButton>
              <UnsavedNote section="details" />
            </div>
          </Card>
        </TrackedForm>

        {/* Step 4: Review & send */}
        <Card strong className="space-y-4" id="review">
          <SectionTitle
            title="4 · Review & send"
            desc={
              charges.free
                ? `Asking ${name} is free. Nothing is charged, and the request is sent straight away.`
                : `Paid once, when you send it. ${name}'s consent request fee is held until they answer.`
            }
          />
          {!charges.free && (
            <MoneyRows>
              <MoneyRow
                label="Consent request fee"
                amount={money(charges.consentFee)}
                note={`If ${name} says yes, 80% goes to them. If not, 80% (${refundText}) comes back to you. Consent keeps 20%.`}
              />
              <MoneyRow
                label={`Platform fee (${PLATFORM_PCT})`}
                amount={money(charges.platformFee)}
                note={`${PLATFORM_PCT} of the consent request fee. Never refunded.`}
              />
              {charges.tax > 0 && (
                <MoneyRow
                  label={charges.taxLabel ?? "Tax"}
                  amount={money(charges.tax)}
                  note="On the platform fee only."
                />
              )}
              <MoneyRow label="Total" amount={totalText} strong />
            </MoneyRows>
          )}
          {capacity.paused && (
            <Alert tone="warn">
              <PausedSentence name={name} capacity={capacity} />
            </Alert>
          )}
          {/* Sent back from an old checkout whose consent request fee no longer matched. */}
          {sp.changed && (
            <Alert tone="warn">
              Your request changed after checkout opened. Check the total and press Pay &amp; send again.
            </Alert>
          )}
          <p className="text-sm font-medium text-ink">This is exactly what {name} will see.</p>
          <div className="space-y-3">
            <ReviewGroup title="Where and what" href="#scope">
              {selections.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {selections.map((s) => (
                    <span key={s.formatId} className="rounded-full border border-ink/20 bg-white/60 px-2.5 py-1 text-xs font-medium">
                      {s.platformName} → {s.formatName}
                      {s.durationSec ? ` · ${s.durationSec}s` : ""}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-ink-faint">No platforms chosen yet.</p>
              )}
              {request.assetTypeNames.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {request.assetTypeNames.map((a) => (
                    <span key={a} className="rounded-full bg-ink/5 px-2.5 py-1 text-xs">{a}</span>
                  ))}
                  {request.thumbnailUsed && <span className="rounded-full bg-ink/5 px-2.5 py-1 text-xs">+ Thumbnail</span>}
                </div>
              ) : (
                <p className="text-sm text-ink-faint">No asset types chosen yet.</p>
              )}
            </ReviewGroup>
            <ReviewGroup title="Files" href="#uploads">
              {reviewFiles.length > 0 ? (
                <ul className="space-y-2">
                  {reviewFiles.map((f) => (
                    <li key={f.id} className="min-w-0 text-sm">
                      <span className="font-medium break-all">{f.name}</span>{" "}
                      <span className="text-xs text-ink-faint">
                        · {FILE_KIND_LABEL[f.kind as keyof typeof FILE_KIND_LABEL]} · v{f.version}
                      </span>
                      <div className="font-mono text-[10px] text-ink-faint break-all">sha256: {f.sha256}</div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-faint">No files uploaded yet.</p>
              )}
            </ReviewGroup>
            <ReviewGroup title="Details" href="#details">
              <KV k="Intent" v={request.intentCategoryName ?? "Not chosen yet"} />
              <KV
                k="Validity"
                v={
                  request.validityKind === "SINGLE_PUBLICATION"
                    ? "Single publication"
                    : request.validityKind === "PERPETUAL"
                      ? "Perpetual"
                      : `${fmtDate(request.validFrom)} → ${fmtDate(request.validUntil)}`
                }
              />
              <KV k="Planned publish" v={request.plannedPublishAt ? fmtDate(request.plannedPublishAt) : "Not set"} />
              <ReviewText label="Context" text={request.context} />
              <ReviewText label="Creative plan" text={request.creativePlan} />
            </ReviewGroup>
          </div>
          {!hasRaw && (
            <Alert tone="warn">
              No final content file yet. You can still send it. If {name} says yes, upload the final file
              then to get your certificate.
            </Alert>
          )}
          <form action={submitRequestAction} className="space-y-4">
            <input type="hidden" name="id" value={request.id} />
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" name="acceptTerms" required className="mt-0.5 size-4 accent-black" />
              <span>
                I accept the terms, including the <strong>consent-link rule</strong>: the verification link or
                badge must appear in the published content&apos;s description, caption or notes.
                {charges.free
                  ? ""
                  : ` The platform fee isn't refunded. If ${name} doesn't say yes, 80% of their consent request fee is refunded to me; Consent keeps 20%.`}
              </span>
            </label>
            <PayButton reason={payReason}>{charges.free ? "Send request" : `Pay ${totalText} & send`}</PayButton>
          </form>
        </Card>
      </UnsavedGuard>
    </div>
  );
}

const FILE_KIND_LABEL = { ASSET: "Asset", RAW_CONTENT: "Final content", THUMBNAIL: "Thumbnail" } as const;

/** One part of the review, with a way back to the section that sets it. */
function ReviewGroup({ title, href, children }: { title: string; href: string; children: ReactNode }) {
  return (
    <div className="glass-subtle space-y-2 px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-ink-faint">{title}</div>
        <ButtonLink href={href} variant="ghost" size="sm" className="min-h-10">
          Edit<span className="sr-only"> {title.toLowerCase()}</span>
        </ButtonLink>
      </div>
      {children}
    </div>
  );
}

function ReviewText({ label, text }: { label: string; text: string }) {
  return (
    <div className="py-2">
      <div className="text-xs font-medium uppercase tracking-wider text-ink-faint">{label}</div>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink">{text || "Not written yet."}</p>
    </div>
  );
}
