import { db } from "@/lib/db";
import { PageHeader, Card, SectionTitle, Alert } from "@/components/ui";
import { Markdown } from "@/components/markdown";
import { countryName } from "@/lib/countries";
import { getSettings } from "@/lib/settings";
import { activeCurrencies, fmtPrice } from "@/lib/currencies";
import { platformFeeFor } from "@/lib/platform-fee";
import { OWNER_PCT, REFUND_PCT, CONSENT_PCT, PLATFORM_PCT } from "../fee-shares";

export const metadata = {
  title: "Pricing",
  description:
    "One account for everyone. Asking can be free; otherwise you pay the consent request fee they set plus a 20% platform fee. Membership is free for now.",
};

export default async function PricingPage() {
  const [prices, note, settings, currencies] = await Promise.all([
    db.priceConfig.findMany({ orderBy: { country: "asc" } }),
    db.cmsPage.findUnique({ where: { slug: "pricing-note" } }),
    getSettings(),
    activeCurrencies(),
  ]);
  // Countries first, "everywhere else" last.
  const rows = [...prices.filter((p) => p.country !== "DEFAULT"), ...prices.filter((p) => p.country === "DEFAULT")];
  const exampleFee = 500;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        kicker="consent."
        title="Pricing"
        desc={`One account for everyone. Asking can be free. When it isn't, you pay the consent request fee they set plus a ${PLATFORM_PCT} platform fee.`}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Card strong className="space-y-2 p-7">
          <SectionTitle title="When you ask" />
          <div className="text-2xl font-semibold tracking-tight">Free, or their fee + {PLATFORM_PCT}</div>
          <p className="text-sm text-ink-soft">
            Many people are free to ask: no fee, no checkout, your request is sent at once. Others set a
            consent request fee. You pay it when you send, plus a platform fee of {PLATFORM_PCT} of it, in
            the same currency. For a {fmtPrice(exampleFee, "INR")} fee you pay {fmtPrice(exampleFee, "INR")} +{" "}
            {fmtPrice(platformFeeFor(exampleFee), "INR")}.
          </p>
        </Card>
        <Card strong className="space-y-2 p-7">
          <SectionTitle title="When you're asked" />
          <div className="text-2xl font-semibold tracking-tight">{OWNER_PCT} of your fee is yours</div>
          <p className="text-sm text-ink-soft">
            Being asked is always free. Choose your consent request fee: free, or an amount in the currency
            you pick. It&apos;s held until you answer. On a yes, {OWNER_PCT} is yours, paid out on Fridays.
            Without a yes, {REFUND_PCT} goes back to the person who asked. Consent keeps {CONSENT_PCT}.
          </p>
        </Card>
      </div>

      <Card className="space-y-3">
        <SectionTitle
          title="Membership"
          desc={
            settings.membershipFeeOn
              ? "The same for every account, team profiles included. You need it to send requests; being asked never needs it."
              : "The same for every account, team profiles included. It's free for now: nobody pays it yet."
          }
        />
        {rows.map((p) => (
          <div key={p.id} className="flex flex-wrap items-baseline justify-between gap-2 border-t hairline pt-2 text-sm first:border-t-0 first:pt-0">
            <span className="text-ink-soft">{p.country === "DEFAULT" ? "Everywhere else" : countryName(p.country)}</span>
            <span>
              <strong className={settings.membershipFeeOn ? "text-ink" : "text-ink-faint line-through"}>
                {fmtPrice(p.membershipFee, p.currency)} / year
              </strong>
              {!settings.membershipFeeOn && <strong className="ml-2 text-ink">Free for now</strong>}
              {p.taxRate && Number(p.taxRate) > 0 ? (
                <span className="ml-2 text-xs text-ink-faint">+ {p.taxLabel ?? "tax"} {p.taxRate.toString()}%</span>
              ) : null}
            </span>
          </div>
        ))}
      </Card>

      <Card className="space-y-3">
        <SectionTitle
          title="Smallest paid consent request fee"
          desc="A fee is free, or at least about ₹100 in the currency it's set in."
        />
        <div className="flex flex-wrap gap-1.5">
          {currencies.map((c) => (
            <span key={c.code} className="rounded-full border border-ink/15 bg-white/60 px-2.5 py-1 text-xs">
              {c.code} <strong className="text-ink">{fmtPrice(c.minConsentFee, c.code)}</strong>
            </span>
          ))}
        </div>
      </Card>

      <Alert>
        <strong>The platform fee is never refunded</strong>, whatever the answer: approved, declined, closed,
        withdrawn or unanswered. Where your country charges tax, it&apos;s added to the platform fee and the
        membership, never to the consent request fee.
      </Alert>
      {note && (
        <Card>
          <Markdown source={note.body} />
        </Card>
      )}
    </div>
  );
}
