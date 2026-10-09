import Link from "next/link";
import { requireConsenter } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, Field, Input, Textarea, SectionTitle } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { SuccessNote } from "@/components/error-note";
import { audit } from "@/lib/audit";
import { redirect } from "next/navigation";
import { Grid3x3, Zap, Ban, Users, Wallet } from "lucide-react";

export const metadata = { title: "Profile settings" };

async function saveAction(formData: FormData) {
  "use server";
  const { session, consenter } = await requireConsenter("canEditRules");
  await db.consenterProfile.update({
    where: { id: consenter.id },
    data: {
      bio: String(formData.get("bio") ?? "").trim() || null,
      category: String(formData.get("category") ?? "").trim() || null,
      shareEmail: formData.get("shareEmail") === "on",
      sharePhone: formData.get("sharePhone") === "on",
      shareManager: formData.get("shareManager") === "on",
      contactEmail: String(formData.get("contactEmail") ?? "").trim() || null,
      contactPhone: String(formData.get("contactPhone") ?? "").trim() || null,
      managerContact: String(formData.get("managerContact") ?? "").trim() || null,
      defaultRequireLegalAgreementForPaid: formData.get("defaultLegal") === "on",
      consentPrice: (() => {
        const v = parseFloat(String(formData.get("consentPrice") ?? ""));
        return v > 0 ? v.toFixed(2) : null;
      })(),
      consentPriceCurrency:
        String(formData.get("consentPriceCurrency") ?? "USD").toUpperCase().slice(0, 3) || "USD",
      payoutDetails: String(formData.get("payoutDetails") ?? "").trim() || null,
    },
  });
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: "consenter_settings_saved",
    module: "consent_settings",
    targetId: consenter.id,
  });
  redirect("/c-panel/settings?saved=1");
}

export default async function ConsenterSettingsPage({ searchParams }: PageProps<"/c-panel/settings">) {
  const sp = await searchParams;
  const { consenter } = await requireConsenter();

  const shortcuts = [
    ["/c-panel/matrix", "Consent matrix", Grid3x3],
    ["/c-panel/rules", "Standing rules", Zap],
    ["/c-panel/lists", "Blacklist & whitelist", Ban],
    ["/c-panel/team", "Team access", Users],
    ["/c-panel/earnings", "Earnings & settlements", Wallet],
  ] as const;

  return (
    <div className="space-y-6">
      <PageHeader kicker={consenter.displayName} title="Profile settings" />
      {sp.saved && <SuccessNote msg="Settings saved." />}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {shortcuts.map(([href, label, Icon]) => (
          <Link key={href} href={href}>
            <Card className="flex items-center gap-2.5 py-4 transition-all hover:shadow-glass-lg">
              <Icon className="size-4 text-ink-soft" aria-hidden />
              <span className="text-sm font-medium">{label}</span>
            </Card>
          </Link>
        ))}
      </div>

      <form action={saveAction} className="space-y-5">
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
            title="Contact sharing on deal agreed"
            desc="Revealed to the requester only after a paid deal is agreed. Consent never processes the payment."
          />
          <div className="space-y-2">
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" name="shareEmail" defaultChecked={consenter.shareEmail} className="size-4 accent-black" /> Share email
            </label>
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" name="sharePhone" defaultChecked={consenter.sharePhone} className="size-4 accent-black" /> Share phone
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
          <Field label="Manager / agency contact">
            <Input name="managerContact" defaultValue={consenter.managerContact ?? ""} />
          </Field>
        </Card>

        <Card className="space-y-4">
          <SectionTitle
            title="Your consent price"
            desc="What it costs to ask you. Paid in-app when a request is submitted, credited to you, and settled weekly. It filters out careless asks — and it buys the ask, not the answer. Leave empty to let anyone ask for free."
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Price per request" hint="0 or empty = free to ask.">
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
          <Field label="Payout details" hint="Where your weekly settlements are paid (bank / UPI / PayPal). Visible only to you and finance admins.">
            <Input name="payoutDetails" defaultValue={consenter.payoutDetails ?? ""} placeholder="e.g. HDFC •• 4821 / name@upi" />
          </Field>
          <p className="text-xs text-ink-faint">
            An unanswered request that auto-expires never pays out — no reward for silence. Any usage
            fee you negotiate after approval is still settled directly between you and the requester,
            never through Consent. Track everything under{" "}
            <Link href="/c-panel/earnings" className="underline underline-offset-4">Earnings & settlements</Link>.
          </p>
        </Card>

        <Card className="space-y-3">
          <SectionTitle title="Agreement preference" />
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" name="defaultLegal" defaultChecked={consenter.defaultRequireLegalAgreementForPaid} className="size-4 accent-black" />
            Always propose a legally binding agreement for paid requests
          </label>
          <p className="text-xs text-ink-faint">The requester must still accept — it only applies if both sides agree.</p>
        </Card>

        <SubmitButton>Save settings</SubmitButton>
      </form>
    </div>
  );
}
