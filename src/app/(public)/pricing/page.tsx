import { db } from "@/lib/db";
import { PageHeader, Card, SectionTitle, Alert } from "@/components/ui";
import { Markdown } from "@/components/markdown";
import { fmtMoney } from "@/lib/utils";
import { countryName } from "@/lib/countries";
import { OWNER_PCT, REFUND_PCT, CONSENT_PCT } from "../fee-shares";

export const metadata = {
  title: "Pricing",
  description: "Consenters never pay anything. Requesters pay onboarding, a yearly subscription and a small platform fee on each request.",
};

export default async function PricingPage() {
  const [prices, note] = await Promise.all([
    db.priceConfig.findMany({ orderBy: { country: "asc" } }),
    db.cmsPage.findUnique({ where: { slug: "pricing-note" } }),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader kicker="consent." title="Pricing" desc="Consenters never pay anything. Requesters pay platform fees, plus an owner's consent request fee if they set one. Deal fees settle directly between the parties." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Card strong className="space-y-2 p-7">
          <SectionTitle title="Consenters" />
          <div className="text-4xl font-semibold tracking-tight">You never pay</div>
          <p className="text-sm text-ink-soft">
            Verification, consent matrix, standing rules, team seats, certificates, takedowns,
            dossier exports — control costs nothing, ever. A no needs no reason.
          </p>
        </Card>
        <Card strong className="space-y-3 p-7">
          <SectionTitle title="Requesters" />
          {prices.map((p) => (
            <div key={p.id} className="border-t hairline pt-2 first:border-t-0 first:pt-0">
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
                {p.country === "DEFAULT" ? "Everywhere else" : countryName(p.country)}
              </div>
              <ul className="mt-1 space-y-0.5 text-sm text-ink-soft">
                <li><strong className="text-ink">{fmtMoney(p.onboardingFee.toString(), p.currency)}</strong> one-time onboarding (after approval)</li>
                <li><strong className="text-ink">{fmtMoney(p.yearlyFee.toString(), p.currency)}</strong> / year subscription</li>
                <li><strong className="text-ink">{fmtMoney(p.perRequestFee.toString(), p.currency)}</strong> platform fee per request</li>
                {p.taxRate && Number(p.taxRate) > 0 ? <li className="text-xs">+ {p.taxLabel} {p.taxRate.toString()}%</li> : null}
              </ul>
            </div>
          ))}
        </Card>
      </div>
      <Alert>
        <strong>Owners can also set a consent request fee</strong>: what it costs to send them a
        request. It&apos;s paid when the request is submitted and held until the owner answers. If they
        say yes, {OWNER_PCT} goes to them, paid out on Fridays. If they decline, or the request ends
        without a yes, {REFUND_PCT} is refunded to the requester. Consent keeps {CONSENT_PCT}. It filters
        out careless asks. Any usage fee agreed after approval is settled directly between the parties;
        that money never moves through Consent.
      </Alert>
      <Alert>
        <strong>The platform fee is never refunded</strong>, whatever the outcome: approved, declined,
        closed, withdrawn or unanswered. Lapsed subscriptions keep read access to past grants and
        certificates.
      </Alert>
      {note && (
        <Card>
          <Markdown source={note.body} />
        </Card>
      )}
    </div>
  );
}
