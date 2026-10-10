import Link from "next/link";
import { requireConsenter } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, Field, Input, Textarea, SectionTitle, Alert } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { ErrorNote, SuccessNote } from "@/components/error-note";
import { audit } from "@/lib/audit";
import { redirect } from "next/navigation";
import { Grid3x3, Zap, Ban, Users, Wallet, Megaphone } from "lucide-react";
import { OWNER_PCT, REFUND_PCT, CONSENT_PCT } from "../requests/fee-split";
import { requestCapacity } from "@/lib/capacity";
import { getSettings } from "@/lib/settings";
import { notifyConsenterTeam } from "@/lib/notify";
import { pausedNotice, fmtUtc } from "@/lib/requests";
import { LIMIT_FIELDS, LIMITS_ERROR, MAX_LIMIT, readLimits } from "./limits";
import { CapacityLine } from "./request-limits";

export const metadata = { title: "Profile settings" };

async function saveAction(formData: FormData) {
  "use server";
  const { session, consenter, member } = await requireConsenter("canEditRules");
  // Check the request limits before saving anything, so a typo saves nothing.
  const limits = readLimits(formData);
  if (!limits) redirect(`/c-panel/settings?error=${encodeURIComponent(LIMITS_ERROR)}`);
  const before = await requestCapacity(consenter.id).catch(() => null);
  // Where the money goes is the owner's call alone, whatever else a team member may edit.
  const isOwner = member.role === "OWNER";
  await db.consenterProfile.update({
    where: { id: consenter.id },
    data: {
      bio: String(formData.get("bio") ?? "").trim() || null,
      category: String(formData.get("category") ?? "").trim() || null,
      shareEmail: formData.get("shareEmail") === "on",
      sharePhone: formData.get("sharePhone") === "on",
      shareAddress: formData.get("shareAddress") === "on",
      shareManager: formData.get("shareManager") === "on",
      contactEmail: String(formData.get("contactEmail") ?? "").trim() || null,
      contactPhone: String(formData.get("contactPhone") ?? "").trim() || null,
      contactAddress: String(formData.get("contactAddress") ?? "").trim().slice(0, 300) || null,
      managerContact: String(formData.get("managerContact") ?? "").trim() || null,
      ...limits,
      defaultRequireLegalAgreementForPaid: formData.get("defaultLegal") === "on",
      consentPrice: (() => {
        const v = parseFloat(String(formData.get("consentPrice") ?? ""));
        return v > 0 ? v.toFixed(2) : null;
      })(),
      consentPriceCurrency:
        String(formData.get("consentPriceCurrency") ?? "USD").toUpperCase().slice(0, 3) || "USD",
      ...(isOwner ? { payoutDetails: String(formData.get("payoutDetails") ?? "").trim() || null } : {}),
    },
  });
  // Per-intent consent request fees: empty field = fall back to the base fee.
  const intents = await db.intentCategory.findMany({ where: { active: true } });
  for (const intent of intents) {
    const raw = String(formData.get(`tier_${intent.id}`) ?? "").trim();
    const v = parseFloat(raw);
    if (raw !== "" && v >= 0) {
      await db.consentPriceTier.upsert({
        where: { consenterId_intentCategoryId: { consenterId: consenter.id, intentCategoryId: intent.id } },
        update: { amount: v.toFixed(2) },
        create: { consenterId: consenter.id, intentCategoryId: intent.id, amount: v.toFixed(2) },
      });
    } else {
      await db.consentPriceTier.deleteMany({
        where: { consenterId: consenter.id, intentCategoryId: intent.id },
      });
    }
  }
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: "consenter_settings_saved",
    module: "consent_settings",
    targetId: consenter.id,
    detail: { limits },
  });
  // Lowering a limit can pause new requests straight away: tell the whole team once.
  if (before && !before.paused) {
    const after = await requestCapacity(consenter.id).catch(() => null);
    if (after?.paused) {
      await notifyConsenterTeam(consenter.id, { ...pausedNotice(after, fmtUtc), href: "/c-panel" });
    }
  }
  redirect("/c-panel/settings?saved=1");
}

export default async function ConsenterSettingsPage({ searchParams }: PageProps<"/c-panel/settings">) {
  const sp = await searchParams;
  const { consenter, member } = await requireConsenter();
  const isOwner = member.role === "OWNER";
  const canEdit = isOwner || member.canEditRules;
  const [intents, tiers, capacity, settings] = await Promise.all([
    db.intentCategory.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.consentPriceTier.findMany({ where: { consenterId: consenter.id } }),
    requestCapacity(consenter.id),
    getSettings(),
  ]);
  const tierFor = new Map(tiers.map((t) => [t.intentCategoryId, t.amount.toString()]));

  // The matrix is no longer in the bottom nav (Find took its place), so keep it the first shortcut.
  const shortcuts = [
    ["/c-panel/matrix", "Consent matrix", Grid3x3],
    ["/c-panel/rules", "Standing rules", Zap],
    ["/c-panel/lists", "Blacklist & whitelist", Ban],
    ["/c-panel/team", "Team access", Users],
    ["/c-panel/earnings", "Earnings & settlements", Wallet],
    ["/c-panel/tipoffs", "Public tip-offs", Megaphone],
  ] as const;

  return (
    <div className="space-y-6">
      <PageHeader kicker={consenter.displayName} title="Profile settings" />
      {sp.saved && <SuccessNote msg="Settings saved." />}
      <ErrorNote error={sp.error} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {shortcuts.map(([href, label, Icon]) => (
          <Link key={href} href={href}>
            <Card className="flex items-center gap-2.5 py-4 transition-all hover:shadow-glass-lg">
              <Icon className="size-4 text-ink-soft" aria-hidden />
              <span className="text-sm font-medium">{label}</span>
            </Card>
          </Link>
        ))}
      </div>

      <form action={saveAction}>
        <fieldset disabled={!canEdit} className="min-w-0 space-y-5">
          <Card className="space-y-4">
            <SectionTitle title="Public profile" />
            <Field label="Category">
              <Input name="category" defaultValue={consenter.category ?? ""} placeholder="actor, musician, TV drama…" />
            </Field>
            <Field label="Bio">
              <Textarea name="bio" defaultValue={consenter.bio ?? ""} maxLength={2000} />
            </Field>
          </Card>

          <Card className="space-y-4">
            <SectionTitle
              title="Contact details you share"
              desc="Nothing is shared automatically. When you approve a request, or any time after, you tick which of these the requester sees. The ones you tick here start ticked."
            />
            <div className="space-y-2">
              <label className="flex items-center gap-3 text-sm">
                <input type="checkbox" name="shareEmail" defaultChecked={consenter.shareEmail} className="size-4 accent-black" /> Share email
              </label>
              <label className="flex items-center gap-3 text-sm">
                <input type="checkbox" name="sharePhone" defaultChecked={consenter.sharePhone} className="size-4 accent-black" /> Share phone
              </label>
              <label className="flex items-center gap-3 text-sm">
                <input type="checkbox" name="shareAddress" defaultChecked={consenter.shareAddress} className="size-4 accent-black" /> Share address
              </label>
              <label className="flex items-center gap-3 text-sm">
                <input type="checkbox" name="shareManager" defaultChecked={consenter.shareManager} className="size-4 accent-black" /> Share manager contact
              </label>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Contact email">
                <Input name="contactEmail" type="email" defaultValue={consenter.contactEmail ?? ""} />
              </Field>
              <Field label="Contact phone">
                <Input name="contactPhone" type="tel" defaultValue={consenter.contactPhone ?? ""} />
              </Field>
            </div>
            <Field label="Contact address" hint="A postal or office address, e.g. for in-person meetings or paperwork.">
              <Input
                name="contactAddress"
                maxLength={300}
                autoComplete="street-address"
                defaultValue={consenter.contactAddress ?? ""}
                placeholder="Street, city, postcode, country"
              />
            </Field>
            <Field label="Manager / agency contact">
              <Input name="managerContact" defaultValue={consenter.managerContact ?? ""} />
            </Field>
          </Card>

          <Card className="space-y-4">
            <SectionTitle
              title="Your consent request fee"
              desc={`What someone pays to send you a request. It's held until you answer. If you say yes, ${OWNER_PCT} is yours, paid out on Fridays. If you decline, or the request ends without a yes, ${REFUND_PCT} goes back to them. Consent keeps ${CONSENT_PCT}. It filters out careless asks. Leave empty to let anyone ask for free.`}
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Consent request fee" hint="0 or empty = free to ask.">
                <Input
                  name="consentPrice"
                  type="number"
                  min={0}
                  step="0.01"
                  defaultValue={consenter.consentPrice ? consenter.consentPrice.toString() : ""}
                  placeholder="25"
                />
              </Field>
              <Field label="Currency">
                <Input name="consentPriceCurrency" maxLength={3} defaultValue={consenter.consentPriceCurrency} className="uppercase" />
              </Field>
            </div>
            <Field
              label="Payout details"
              hint={
                isOwner
                  ? "Where your weekly settlements are paid (bank / UPI / PayPal). Visible only to you and finance admins."
                  : "Where weekly settlements are paid. Only the profile owner can see or change this."
              }
            >
              {isOwner ? (
                <Input name="payoutDetails" defaultValue={consenter.payoutDetails ?? ""} placeholder="e.g. HDFC •• 4821 / name@upi" />
              ) : (
                <Input disabled placeholder={consenter.payoutDetails ? "Added (only the owner can see it)" : "Not added yet"} />
              )}
            </Field>
            <div className="space-y-2 border-t hairline pt-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-soft">
                Fee by intent
              </div>
              <p className="text-xs text-ink-faint">
                Charge differently by why they&apos;re asking — e.g. News 0 (free), Promotion 250.
                Empty = your consent request fee above. 0 = free for that intent.
              </p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {intents.map((i) => (
                  <label key={i.id} className="flex items-center gap-2 text-sm">
                    <span className="w-28 shrink-0 truncate text-xs text-ink-soft">{i.name}</span>
                    <Input
                      name={`tier_${i.id}`}
                      type="number"
                      min={0}
                      step="0.01"
                      defaultValue={tierFor.get(i.id) ?? ""}
                      placeholder="base"
                      className="py-1.5 text-xs"
                      aria-label={`Consent request fee for ${i.name}`}
                    />
                  </label>
                ))}
              </div>
            </div>
            <p className="text-xs text-ink-faint">
              A request expires when neither side acts for {settings.slaDays} days. If it expires without a
              yes, {REFUND_PCT} of the consent request fee is refunded to the requester, so silence never
              pays. Any usage fee you negotiate after approval is still settled directly between you and
              the requester, never through Consent. Track everything under{" "}
              <Link href="/c-panel/earnings" className="underline underline-offset-4">Earnings & settlements</Link>.
            </p>
          </Card>

          <Card className="space-y-4" id="limits">
            <SectionTitle
              title="Request limits"
              desc="Pause new requests when you have too many to answer. While paused, nobody can send you a request or pay for one, and they see when it opens again. Leave a box empty for no limit."
            />
            <CapacityLine capacity={capacity} />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {LIMIT_FIELDS.map((f) => (
                <Field key={f.name} label={f.label} hint={f.hint}>
                  <Input
                    name={f.name}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={MAX_LIMIT}
                    step={1}
                    defaultValue={consenter[f.name] ?? ""}
                    placeholder="No limit"
                  />
                </Field>
              ))}
            </div>
            <p className="text-xs text-ink-faint">
              Answering a request (yes, a fee, an Ask or no) frees its place in &lsquo;Max waiting for your
              answer&rsquo;. When they answer your Ask, it waits for you again and counts. Day, week and
              month limits count requests sent in the last 24 hours, 7 days and 30 days.
            </p>
          </Card>

          <Card className="space-y-3">
            <SectionTitle title="Agreement preference" />
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" name="defaultLegal" defaultChecked={consenter.defaultRequireLegalAgreementForPaid} className="size-4 accent-black" />
              Propose a legally binding agreement for paid requests by default
            </label>
            <p className="text-xs text-ink-faint">
              When you approve a paid request, the box starts ticked, and you can untick it each time. If
              the requester accepts a fee you offered, we propose the agreement for you. Either way, the
              requester must still accept.
            </p>
          </Card>

          {canEdit ? (
            <SubmitButton>Save settings</SubmitButton>
          ) : (
            <Alert>You can view these settings. Editing needs the &lsquo;Edit matrix &amp; rules&rsquo; permission.</Alert>
          )}
        </fieldset>
      </form>
    </div>
  );
}
