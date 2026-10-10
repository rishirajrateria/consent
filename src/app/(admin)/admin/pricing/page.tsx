import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, hasAdminPerm } from "@/lib/auth";
import { ViewOnlyPage } from "../no-permission";
import { db } from "@/lib/db";
import { PageHeader, Card, Input, SectionTitle, StatusBadge } from "@/components/ui";
import { SubmitButton, ConfirmSubmit } from "@/components/form";
import { ErrorNote, SuccessNote } from "@/components/error-note";
import { audit } from "@/lib/audit";
import { Prisma } from "@prisma/client";
import { fmtDate, fmtMoney } from "@/lib/utils";
import { OWNER_SHARE, REFUND_SHARE } from "@/lib/escrow";
import { PLATFORM_PCT } from "@/lib/platform-fee";
import { getSettings, saveSettings } from "@/lib/settings";
import { allCurrencies, fmtPrice } from "@/lib/currencies";
import { DEFAULT_CURRENCIES } from "@/lib/currency-rules";

export const metadata = { title: "Pricing & coupons" };

const pct = (share: number) => `${Math.round(share * 100)}%`;
const MONEY = /^\d+(\.\d{1,2})?$/;

function fail(error: string): never {
  redirect(`/admin/pricing?error=${encodeURIComponent(error)}`);
}

/** A currency code Intl can format, e.g. "INR". */
function validCurrency(code: string) {
  if (!/^[A-Z]{3}$/.test(code)) return false;
  try {
    new Intl.NumberFormat("en-US", { style: "currency", currency: code });
    return true;
  } catch {
    return false;
  }
}

const TWO_DECIMALS = "Only currencies with two decimal places are supported.";

/**
 * True for a currency with two decimal places (INR, USD, CHF). All money code
 * charges and stores amounts to the cent, which a zero-decimal currency like
 * JPY or KRW can't be charged in.
 */
function twoDecimals(code: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).resolvedOptions().maximumFractionDigits === 2;
}

async function membershipAction(formData: FormData) {
  "use server";
  const session = await requireAdmin("pricing", "edit");
  const on = formData.get("on") === "1";
  const s = await getSettings();
  s.membershipFeeOn = on;
  await saveSettings(s);
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: on ? "membership_fee_on" : "membership_fee_off",
    module: "pricing",
  });
  revalidatePath("/admin/pricing");
  redirect(`/admin/pricing?saved=${on ? "membership-on" : "membership-off"}`);
}

async function savePriceAction(formData: FormData) {
  "use server";
  const session = await requireAdmin("pricing", "edit");
  const country = String(formData.get("country") ?? "").toUpperCase().trim();
  const currency = String(formData.get("currency") ?? "").toUpperCase().trim();
  const fee = String(formData.get("membershipFee") ?? "").trim();
  const taxLabel = String(formData.get("taxLabel") ?? "").trim().slice(0, 20) || null;
  const taxRaw = String(formData.get("taxRate") ?? "").trim();
  if (!/^([A-Z]{2}|DEFAULT)$/.test(country)) fail("Use a two-letter country code, like IN, or DEFAULT.");
  if (!validCurrency(currency)) fail("Use a three-letter currency code, like INR.");
  if (!twoDecimals(currency)) fail(TWO_DECIMALS);
  if (!MONEY.test(fee) || Number(fee) <= 0) fail("Enter the membership price as a number above 0, like 1000.");
  if (taxRaw && (!MONEY.test(taxRaw) || Number(taxRaw) > 100)) fail("Enter the tax rate as a percentage from 0 to 100, like 18.");
  const data = {
    currency,
    membershipFee: new Prisma.Decimal(fee),
    taxLabel,
    taxRate: taxRaw && Number(taxRaw) > 0 ? new Prisma.Decimal(taxRaw) : null,
  };
  await db.priceConfig.upsert({ where: { country }, update: data, create: { country, ...data } });
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: "pricing_saved",
    module: "pricing",
    targetId: country,
    detail: { currency, membershipFee: fee, taxLabel, taxRate: taxRaw || null },
  });
  revalidatePath("/admin/pricing");
  redirect("/admin/pricing?saved=price");
}

async function saveCurrencyAction(formData: FormData) {
  "use server";
  const session = await requireAdmin("pricing", "edit");
  const code = String(formData.get("code") ?? "").toUpperCase().trim();
  const name = String(formData.get("name") ?? "").trim().slice(0, 60);
  const min = String(formData.get("minConsentFee") ?? "").trim();
  const sortOrder = Number(String(formData.get("sortOrder") ?? "0").trim() || "0");
  const active = formData.get("active") === "on";
  if (!validCurrency(code)) fail("Use a three-letter currency code, like INR.");
  if (!twoDecimals(code)) fail(TWO_DECIMALS);
  if (!name) fail("Give the currency a name, like Indian rupee.");
  if (!MONEY.test(min) || Number(min) <= 0) fail("Enter the minimum paid fee as a number above 0, like 100.");
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 999) fail("Order is a whole number from 0 to 999.");
  // The first save stores the defaults too, so the list people choose from
  // doesn't shrink to the one row just edited.
  await db.currency.createMany({
    data: DEFAULT_CURRENCIES.map((c) => ({ code: c.code, name: c.name, minConsentFee: new Prisma.Decimal(c.minConsentFee), sortOrder: c.sortOrder })),
    skipDuplicates: true,
  });
  if (!active) {
    const others = await db.currency.count({ where: { active: true, code: { not: code } } });
    if (others === 0) fail("Keep at least one currency people can choose.");
  }
  const data = { name, minConsentFee: new Prisma.Decimal(min), sortOrder, active };
  await db.currency.upsert({ where: { code }, update: data, create: { code, ...data } });
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: "currency_saved",
    module: "pricing",
    targetId: code,
    detail: { name, minConsentFee: min, sortOrder, active },
  });
  revalidatePath("/admin/pricing");
  redirect("/admin/pricing?saved=currency");
}

async function couponAction(formData: FormData) {
  "use server";
  const session = await requireAdmin("pricing", "edit");
  const op = String(formData.get("op"));
  if (op === "add") {
    const code = String(formData.get("code") ?? "").toUpperCase().trim();
    const percentOff = Math.max(1, Math.min(100, parseInt(String(formData.get("percentOff")), 10) || 0));
    if (!code) return;
    await db.coupon.upsert({
      where: { code },
      update: { percentOff, active: true },
      create: {
        code,
        percentOff,
        maxUses: formData.get("maxUses") ? parseInt(String(formData.get("maxUses")), 10) : null,
        expiresAt: formData.get("expiresAt") ? new Date(String(formData.get("expiresAt"))) : null,
      },
    });
  }
  if (op === "toggle") {
    const id = String(formData.get("id"));
    const c = await db.coupon.findUnique({ where: { id } });
    if (c) await db.coupon.update({ where: { id }, data: { active: !c.active } });
  }
  await audit({ actorId: session.userId, actorName: session.user.name, action: `coupon_${op}`, module: "pricing" });
  revalidatePath("/admin/pricing");
}

const SAVED: Record<string, string> = {
  "membership-on": "The membership fee is on. Sending requests now needs a membership.",
  "membership-off": "The membership fee is off. Membership is free for now.",
  price: "Membership price saved.",
  currency: "Currency saved.",
};

export default async function AdminPricing({ searchParams }: PageProps<"/admin/pricing">) {
  const session = await requireAdmin("pricing", "view");
  const sp = await searchParams;
  const canEdit = hasAdminPerm(session.user.adminRole, "pricing", "edit");
  const [prices, coupons, currencies, savedRows, settings] = await Promise.all([
    db.priceConfig.findMany({ orderBy: { country: "asc" } }),
    db.coupon.findMany({ orderBy: { code: "asc" } }),
    allCurrencies(),
    db.currency.count(),
    getSettings(),
  ]);
  const feeOn = settings.membershipFeeOn;
  const home = prices.find((p) => p.country === "IN") ?? prices.find((p) => p.country === "DEFAULT");
  const yearly = home ? fmtPrice(home.membershipFee, home.currency) : "₹1,000";
  const saved = typeof sp.saved === "string" ? SAVED[sp.saved] : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Admin"
        title="Pricing & coupons"
        desc={`Membership, consent request fee minimums and coupons. The platform fee is ${PLATFORM_PCT} of the consent request fee, paid on top by the person asking, in the same currency, and never refunded. A consent request fee is held until the person asked answers: ${pct(OWNER_SHARE)} goes to them on a yes, ${pct(REFUND_SHARE)} is refunded otherwise, and Consent keeps ${pct(1 - OWNER_SHARE)}.`}
      />
      {!canEdit && <ViewOnlyPage module="pricing" />}
      <ErrorNote error={sp.error} />
      <SuccessNote msg={saved} />

      {/* View-only roles see the values but can't type into a form the server will refuse. */}
      <fieldset disabled={!canEdit} className="min-w-0 space-y-6">
        <Card className="space-y-3">
          <SectionTitle
            title="Membership"
            desc={`${yearly} a year, the same for every profile. While the fee is off, every verified profile sends requests for free. When it's on, sending needs a paid membership; receiving never does.`}
          />
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={feeOn ? "ACTIVE" : "CLOSED"} label={feeOn ? "Fee on" : "Fee off · Free for now"} />
            <form action={membershipAction} className="ml-auto">
              {feeOn ? (
                <>
                  <input type="hidden" name="on" value="0" />
                  <ConfirmSubmit
                    variant="secondary"
                    size="sm"
                    confirm="Make membership free? Every verified profile can send requests without paying."
                  >
                    Turn the fee off
                  </ConfirmSubmit>
                </>
              ) : (
                <>
                  <input type="hidden" name="on" value="1" />
                  <ConfirmSubmit
                    variant="secondary"
                    size="sm"
                    confirm="Turn the membership fee on? Profiles without a paid membership can no longer send requests until they pay."
                  >
                    Turn the fee on
                  </ConfirmSubmit>
                </>
              )}
            </form>
          </div>
        </Card>

        <Card className="space-y-4">
          <SectionTitle
            title="Membership price by country"
            desc="DEFAULT applies to countries without their own row. Tax is added to the membership and the platform fee, by the payer's country."
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b hairline text-left text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                  <th className="py-2 pr-2">Country · currency · membership a year · tax</th>
                </tr>
              </thead>
              <tbody>
                {prices.map((p) => (
                  <tr key={p.id} className="border-b hairline last:border-b-0">
                    <PriceRow p={p} />
                  </tr>
                ))}
                <tr>
                  <PriceRow />
                </tr>
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="space-y-4">
          <SectionTitle
            title="Consent request fee minimums"
            desc={`The smallest paid consent request fee in each currency, about ₹100. A fee can always be free. Only active currencies can be chosen. Raising a minimum doesn't change fees already set.${savedRows === 0 ? " These are the defaults: saving any row stores them all." : ""}`}
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b hairline text-left text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                  <th className="py-2 pr-2">Code · name · minimum paid fee · order · active</th>
                </tr>
              </thead>
              <tbody>
                {currencies.map((c) => (
                  <tr key={c.code} className="border-b hairline last:border-b-0">
                    <CurrencyRow c={c} />
                  </tr>
                ))}
                <tr>
                  <CurrencyRow />
                </tr>
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="space-y-3">
          <SectionTitle
            title="Coupons & goodwill credits"
            desc="A coupon takes a percentage off the platform fee or the membership, never off the consent request fee."
          />
          {coupons.map((c) => (
            <form key={c.id} action={couponAction} className="flex flex-wrap items-center gap-2 border-t hairline py-2 text-sm first:border-t-0">
              <input type="hidden" name="id" value={c.id} />
              <span className="font-mono font-semibold">{c.code}</span>
              <span>{c.percentOff}% off</span>
              <span className="text-xs text-ink-faint">
                used {c.usedCount}{c.maxUses ? `/${c.maxUses}` : ""}{c.expiresAt ? ` · expires ${fmtDate(c.expiresAt)}` : ""}
              </span>
              <StatusBadge status={c.active ? "ACTIVE" : "CLOSED"} className="ml-auto" />
              <SubmitButton name="op" value="toggle" variant="ghost" size="sm">{c.active ? "Disable" : "Enable"}</SubmitButton>
            </form>
          ))}
          <form action={couponAction} className="flex flex-wrap items-end gap-2 border-t hairline pt-3">
            <Input name="code" placeholder="CODE" className="w-32 uppercase" aria-label="Coupon code" required />
            <Input name="percentOff" type="number" min={1} max={100} placeholder="% off" className="w-24" aria-label="Percent off" required />
            <Input name="maxUses" type="number" min={1} placeholder="Max uses" className="w-28" aria-label="Max uses" />
            <Input name="expiresAt" type="date" className="w-40" aria-label="Expires" />
            <SubmitButton name="op" value="add" variant="secondary" size="sm">Add coupon</SubmitButton>
          </form>
        </Card>
      </fieldset>
    </div>
  );
}

function PriceRow({
  p,
}: {
  p?: { country: string; currency: string; membershipFee: Prisma.Decimal; taxLabel: string | null; taxRate: Prisma.Decimal | null };
}) {
  return (
    <td className="py-1">
      <form action={savePriceAction} className="flex flex-wrap items-center gap-2">
        <Input name="country" defaultValue={p?.country ?? ""} placeholder="e.g. FR" className="w-24 py-1.5 text-xs uppercase" aria-label="Country" required readOnly={!!p} />
        <Input name="currency" defaultValue={p?.currency ?? ""} placeholder="EUR" maxLength={3} className="w-20 py-1.5 text-xs uppercase" aria-label="Currency" required />
        <Input
          name="membershipFee"
          type="number"
          min={0.01}
          step="0.01"
          defaultValue={p ? p.membershipFee.toString() : ""}
          placeholder="1000"
          className="w-28 py-1.5 text-xs"
          aria-label="Membership a year"
          required
        />
        <Input name="taxLabel" defaultValue={p?.taxLabel ?? ""} placeholder="VAT/GST" className="w-24 py-1.5 text-xs" aria-label="Tax label" />
        <Input
          name="taxRate"
          type="number"
          min={0}
          max={100}
          step="0.01"
          defaultValue={p?.taxRate ? p.taxRate.toString() : ""}
          placeholder="%"
          className="w-20 py-1.5 text-xs"
          aria-label="Tax rate (%)"
        />
        {p && <span className="text-xs text-ink-faint">{fmtMoney(p.membershipFee.toString(), p.currency)} a year</span>}
        <SubmitButton variant="ghost" size="sm" className="ml-auto">{p ? "Save" : "Add"}</SubmitButton>
      </form>
    </td>
  );
}

function CurrencyRow({ c }: { c?: { code: string; name: string; minConsentFee: number; sortOrder: number; active: boolean } }) {
  return (
    <td className="py-1">
      <form action={saveCurrencyAction} className="flex flex-wrap items-center gap-2">
        <Input name="code" defaultValue={c?.code ?? ""} placeholder="e.g. CHF" maxLength={3} className="w-20 py-1.5 text-xs uppercase" aria-label="Currency code" required readOnly={!!c} />
        <Input name="name" defaultValue={c?.name ?? ""} placeholder="Swiss franc" maxLength={60} className="w-40 py-1.5 text-xs" aria-label="Currency name" required />
        <Input
          name="minConsentFee"
          type="number"
          min={0.01}
          step="0.01"
          defaultValue={c ? String(c.minConsentFee) : ""}
          placeholder="100"
          className="w-24 py-1.5 text-xs"
          aria-label={c ? `Minimum paid fee in ${c.code}` : "Minimum paid fee"}
          required
        />
        <Input
          name="sortOrder"
          type="number"
          min={0}
          max={999}
          step={1}
          defaultValue={c ? String(c.sortOrder) : ""}
          placeholder="Order"
          className="w-20 py-1.5 text-xs"
          aria-label="Order"
        />
        <label className="flex items-center gap-1.5 text-xs text-ink-soft">
          <input type="checkbox" name="active" defaultChecked={c ? c.active : true} className="size-4 accent-black" /> Active
        </label>
        {c && <span className="text-xs text-ink-faint">At least {fmtMoney(c.minConsentFee, c.code)}</span>}
        <SubmitButton variant="ghost" size="sm" className="ml-auto">{c ? "Save" : "Add"}</SubmitButton>
      </form>
    </td>
  );
}
