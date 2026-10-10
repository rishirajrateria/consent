import { revalidatePath } from "next/cache";
import { requireAdmin, hasAdminPerm } from "@/lib/auth";
import { ViewOnlyPage } from "../no-permission";
import { db } from "@/lib/db";
import { PageHeader, Card, Input, SectionTitle, StatusBadge } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { audit } from "@/lib/audit";
import { Prisma } from "@prisma/client";
import { fmtDate } from "@/lib/utils";
import { OWNER_SHARE, REFUND_SHARE } from "@/lib/escrow";

export const metadata = { title: "Pricing & coupons" };

async function savePriceAction(formData: FormData) {
  "use server";
  const session = await requireAdmin("pricing", "edit");
  const country = String(formData.get("country") ?? "").toUpperCase().trim();
  if (!country) return;
  const dec = (k: string) => new Prisma.Decimal(String(formData.get(k) || "0"));
  await db.priceConfig.upsert({
    where: { country },
    update: {
      currency: String(formData.get("currency") ?? "USD").toUpperCase(),
      onboardingFee: dec("onboardingFee"),
      yearlyFee: dec("yearlyFee"),
      perRequestFee: dec("perRequestFee"),
      taxLabel: String(formData.get("taxLabel") ?? "") || null,
      taxRate: formData.get("taxRate") ? dec("taxRate") : null,
    },
    create: {
      country,
      currency: String(formData.get("currency") ?? "USD").toUpperCase(),
      onboardingFee: dec("onboardingFee"),
      yearlyFee: dec("yearlyFee"),
      perRequestFee: dec("perRequestFee"),
      taxLabel: String(formData.get("taxLabel") ?? "") || null,
      taxRate: formData.get("taxRate") ? dec("taxRate") : null,
    },
  });
  await audit({ actorId: session.userId, actorName: session.user.name, action: "pricing_saved", module: "pricing", targetId: country });
  revalidatePath("/admin/pricing");
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

export default async function AdminPricing() {
  const session = await requireAdmin("pricing", "view");
  const canEdit = hasAdminPerm(session.user.adminRole, "pricing", "edit");
  const [prices, coupons] = await Promise.all([
    db.priceConfig.findMany({ orderBy: { country: "asc" } }),
    db.coupon.findMany({ orderBy: { code: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Admin"
        title="Pricing & coupons"
        desc={`Per-country platform fees. Consenters never pay; the platform fee is never refunded (goodwill credits via coupons). Owners set their own consent request fee. It is held until they answer: ${Math.round(OWNER_SHARE * 100)}% goes to them on a yes, ${Math.round(REFUND_SHARE * 100)}% is refunded otherwise, and Consent keeps ${Math.round((1 - OWNER_SHARE) * 100)}%.`}
      />
      {!canEdit && <ViewOnlyPage module="pricing" />}

      {/* View-only roles see the values but can't type into a form the server will refuse. */}
      <fieldset disabled={!canEdit} className="min-w-0 space-y-6">
        <Card className="space-y-4">
          <SectionTitle title="Price configurations" desc="DEFAULT applies to countries without a specific row." />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b hairline text-left text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                  <th className="py-2 pr-2">Country</th><th className="pr-2">Currency</th><th className="pr-2">Onboarding</th>
                  <th className="pr-2">Yearly</th><th className="pr-2">Platform fee</th><th className="pr-2">Tax</th><th />
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

        <Card className="space-y-3">
          <SectionTitle title="Coupons & goodwill credits" />
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

function PriceRow({ p }: { p?: { country: string; currency: string; onboardingFee: unknown; yearlyFee: unknown; perRequestFee: unknown; taxLabel: string | null; taxRate: unknown } }) {
  return (
    <td colSpan={7} className="py-1">
      <form action={savePriceAction} className="flex flex-wrap items-center gap-2">
        <Input name="country" defaultValue={p?.country ?? ""} placeholder="e.g. FR" className="w-24 py-1.5 text-xs uppercase" aria-label="Country" required readOnly={!!p} />
        <Input name="currency" defaultValue={p?.currency ?? ""} placeholder="EUR" className="w-20 py-1.5 text-xs uppercase" aria-label="Currency" required />
        <Input name="onboardingFee" defaultValue={String(p?.onboardingFee ?? "")} placeholder="49" className="w-24 py-1.5 text-xs" aria-label="Onboarding fee" required />
        <Input name="yearlyFee" defaultValue={String(p?.yearlyFee ?? "")} placeholder="99" className="w-24 py-1.5 text-xs" aria-label="Yearly fee" required />
        <Input name="perRequestFee" defaultValue={String(p?.perRequestFee ?? "")} placeholder="9" className="w-24 py-1.5 text-xs" aria-label="Platform fee" required />
        <Input name="taxLabel" defaultValue={p?.taxLabel ?? ""} placeholder="VAT/GST" className="w-24 py-1.5 text-xs" aria-label="Tax label" />
        <Input name="taxRate" defaultValue={p?.taxRate ? String(p.taxRate) : ""} placeholder="%" className="w-16 py-1.5 text-xs" aria-label="Tax rate" />
        <SubmitButton variant="ghost" size="sm">{p ? "Save" : "Add"}</SubmitButton>
      </form>
    </td>
  );
}
