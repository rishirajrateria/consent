import Link from "next/link";
import { requireConsenter } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, Field, Input, Textarea, SectionTitle, Alert } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { ErrorNote, SuccessNote } from "@/components/error-note";
import { audit } from "@/lib/audit";
import { redirect } from "next/navigation";
import { Grid3x3, Zap, Ban, Users, Wallet, Megaphone, CreditCard } from "lucide-react";
import { OWNER_PCT, REFUND_PCT, CONSENT_PCT, PLATFORM_PCT } from "../requests/fee-split";
import { requestCapacity } from "@/lib/capacity";
import { getSettings } from "@/lib/settings";
import { notifyConsenterTeam } from "@/lib/notify";
import { pausedNotice, fmtUtc } from "@/lib/requests";
import { activeCurrencies } from "@/lib/currencies";
import { currencyForCountry } from "@/lib/currency-rules";
import { LIMIT_FIELDS, LIMITS_ERROR, MAX_LIMIT, readLimits } from "./limits";
import { readFeeForm, tierMode } from "./fee-form";
import { CapacityLine } from "./request-limits";
import { FeeFields } from "./fee-fields";

export const metadata = { title: "Profile, fee & limits" };

/** "About you" needs this many characters, as at onboarding. */
const MIN_BIO = 40;
const MAX_BIO = 2000;

function fail(error: string): never {
  redirect(`/c-panel/settings?error=${encodeURIComponent(error)}`);
}

async function saveAction(formData: FormData) {
  "use server";
  const { session, consenter, member } = await requireConsenter("canEditRules");
  // Check everything before saving anything, so a typo saves nothing.
  const category = String(formData.get("category") ?? "").trim().slice(0, 120);
  const bio = String(formData.get("bio") ?? "").trim();
  if (!category) fail("Say what you do, like actor, musician or TV show.");
  if (bio.length < MIN_BIO) fail(`Write at least ${MIN_BIO} characters in “About you”.`);
  if (bio.length > MAX_BIO) fail(`Keep “About you” under ${MAX_BIO.toLocaleString("en-US")} characters.`);
  const limits = readLimits(formData);
  if (!limits) fail(LIMITS_ERROR);
  const [currencies, intents] = await Promise.all([
    activeCurrencies(),
    db.intentCategory.findMany({ where: { active: true }, select: { id: true, name: true } }),
  ]);
  const read = readFeeForm(formData, currencies, intents);
  if (!read.ok) fail(read.error);
  const { fee } = read;

  const before = await requestCapacity(consenter.id).catch(() => null);
  // Where the money goes is the owner's call alone, whatever else a team member may edit.
  const isOwner = member.role === "OWNER";
  await db.$transaction(async (tx) => {
    await tx.consenterProfile.update({
      where: { id: consenter.id },
      data: {
        bio,
        category,
        ...limits,
        consentPrice: fee.consentPrice == null ? null : fee.consentPrice.toFixed(2),
        consentPriceCurrency: fee.currency,
        ...(isOwner ? { payoutDetails: String(formData.get("payoutDetails") ?? "").trim().slice(0, 300) || null } : {}),
      },
    });
    // The sending half shows the same description.
    await tx.requesterProfile.updateMany({
      where: { consenterId: consenter.id },
      data: { description: bio, categories: [category] },
    });
    // A fee per kind of consent: none (the profile's fee), 0 (free) or the fee.
    for (const [intentCategoryId, amount] of fee.tiers) {
      if (amount == null) {
        await tx.consentPriceTier.deleteMany({ where: { consenterId: consenter.id, intentCategoryId } });
      } else {
        await tx.consentPriceTier.upsert({
          where: { consenterId_intentCategoryId: { consenterId: consenter.id, intentCategoryId } },
          update: { amount: amount.toFixed(2) },
          create: { consenterId: consenter.id, intentCategoryId, amount: amount.toFixed(2) },
        });
      }
    }
  });
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: "consenter_settings_saved",
    module: "consent_settings",
    targetId: consenter.id,
    detail: {
      limits,
      consentPrice: fee.consentPrice,
      currency: fee.currency,
      tiers: Object.fromEntries([...fee.tiers].filter(([, v]) => v != null)),
    },
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
  const [intents, tiers, capacity, settings, currencies] = await Promise.all([
    db.intentCategory.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.consentPriceTier.findMany({ where: { consenterId: consenter.id } }),
    requestCapacity(consenter.id),
    getSettings(),
    activeCurrencies(),
  ]);
  const tierFor = new Map(tiers.map((t) => [t.intentCategoryId, t.amount]));
  // A currency people can no longer choose falls back to the country's (or the first one).
  const currency =
    [consenter.consentPriceCurrency, currencyForCountry(consenter.country)].find((c) => currencies.some((x) => x.code === c)) ??
    currencies[0]?.code ??
    "INR";
  // The stored fee's currency is no longer offered: never move the old numbers
  // into another currency on the next save. The fees have to be entered again.
  const paid = !!consenter.consentPrice && Number(consenter.consentPrice) > 0;
  const paidTiers = tiers.some((t) => Number(t.amount) > 0);
  const retired =
    (paid || paidTiers) && !currencies.some((c) => c.code === consenter.consentPriceCurrency)
      ? consenter.consentPriceCurrency
      : null;

  // The matrix is no longer in the bottom nav (Find took its place), so keep it the first shortcut.
  const shortcuts = [
    ["/c-panel/matrix", "Consent matrix", Grid3x3],
    ["/c-panel/rules", "Standing rules", Zap],
    ["/c-panel/lists", "Blacklist & whitelist", Ban],
    ["/c-panel/team", "Team", Users],
    ["/c-panel/earnings", "Earnings & payouts", Wallet],
    ["/r-panel/billing", "Payments & membership", CreditCard],
    ["/c-panel/tipoffs", "Tip-offs", Megaphone],
  ] as const;

  return (
    <div className="space-y-6">
      <PageHeader kicker={consenter.displayName} title="Profile, fee & limits" />
      {sp.saved && <SuccessNote msg="Settings saved." />}
      <ErrorNote error={sp.error} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {shortcuts.map(([href, label, Icon]) => (
          <Link key={href} href={href}>
            <Card className="flex h-full items-center gap-2.5 py-4 transition-all hover:shadow-glass-lg">
              <Icon className="size-4 shrink-0 text-ink-soft" aria-hidden />
              <span className="text-sm font-medium">{label}</span>
            </Card>
          </Link>
        ))}
      </div>

      <form action={saveAction}>
        <fieldset disabled={!canEdit} className="min-w-0 space-y-5">
          <Card className="space-y-4">
            <SectionTitle
              title="Public profile"
              desc="What people see on your public profile. Your name and photo come from your ID check."
            />
            <Field label="What you do" required>
              <Input
                name="category"
                required
                maxLength={120}
                defaultValue={consenter.category ?? ""}
                placeholder="actor, musician, TV drama…"
              />
            </Field>
            <Field label="About you" hint={`At least ${MIN_BIO} characters.`} required>
              <Textarea name="bio" required minLength={MIN_BIO} maxLength={MAX_BIO} defaultValue={consenter.bio ?? ""} />
            </Field>
          </Card>

          <Card className="space-y-4" id="fee">
            <SectionTitle
              title="Your consent request fee"
              desc={`What someone pays to send you a request. It's held until you answer. If you say yes, ${OWNER_PCT} is yours, paid out on Fridays. If you decline, or the request ends without a yes, ${REFUND_PCT} goes back to them. Consent keeps ${CONSENT_PCT}. They also pay a ${PLATFORM_PCT} platform fee on top. A fee filters out careless asks; free lets anyone verified ask.`}
            />
            {retired && (
              <Alert tone="warn">
                {retired} is no longer offered. Choose a currency and enter your fee again.
              </Alert>
            )}
            <FeeFields
              currencies={currencies.map((c) => ({ code: c.code, name: c.name, minConsentFee: c.minConsentFee }))}
              initial={{
                mode: paid ? "paid" : "free",
                amount: paid && !retired ? String(consenter.consentPrice) : "",
                currency,
              }}
              intents={intents.map((i) => {
                const amount = tierFor.get(i.id);
                const mode = tierMode(amount);
                return { id: i.id, name: i.name, mode, amount: mode === "paid" && amount && !retired ? amount.toString() : "" };
              })}
            />
            <p className="text-xs text-ink-faint">
              A request expires when neither side acts for {settings.slaDays} days. If it ends without a
              yes, {REFUND_PCT} of the consent request fee goes back to them, so silence never pays. See
              everything under{" "}
              <Link href="/c-panel/earnings" className="underline underline-offset-4">Earnings &amp; payouts</Link>.
            </p>
          </Card>

          <Card className="space-y-4" id="payout">
            <SectionTitle title="Payout details" desc={`Where your ${OWNER_PCT} of the fees you say yes to is paid, every Friday.`} />
            <Field
              label="Payout details"
              hint={
                isOwner
                  ? "Bank, UPI or PayPal. Only you and our finance team can see it."
                  : "Only the profile owner can see or change this."
              }
            >
              {isOwner ? (
                <Input
                  name="payoutDetails"
                  maxLength={300}
                  defaultValue={consenter.payoutDetails ?? ""}
                  placeholder="e.g. HDFC •• 4821 / name@upi"
                />
              ) : (
                <Input disabled placeholder={consenter.payoutDetails ? "Added (only the owner can see it)" : "Not added yet"} />
              )}
            </Field>
          </Card>

          <Card className="space-y-4" id="limits">
            <SectionTitle
              title="Request limits"
              desc="Pause new requests when you have too many to answer. While paused, nobody can send you a request or pay for one, and they see when it opens again. Requests resume as you answer. Leave a box empty for no limit."
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
              Answering a request (yes, an Ask or no) frees its place in &lsquo;Max waiting for your
              answer&rsquo;. When they answer your Ask, it waits for you again and counts. Day, week and
              month limits count requests sent in the last 24 hours, 7 days and 30 days.
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
