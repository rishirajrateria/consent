import { db } from "@/lib/db";
import { PageHeader, Card, SectionTitle, Alert } from "@/components/ui";
import { Markdown } from "@/components/markdown";
import { fmtMoney } from "@/lib/utils";
import { countryName } from "@/lib/countries";

export const metadata = {
  title: "Pricing",
  description: "Consenters never pay anything. Requesters pay onboarding, a yearly subscription and a small per-request fee.",
};

export default async function PricingPage() {
  const [prices, note] = await Promise.all([
    db.priceConfig.findMany({ orderBy: { country: "asc" } }),
    db.cmsPage.findUnique({ where: { slug: "pricing-note" } }),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader kicker="consent." title="Pricing" desc="Consenters never pay anything. Requesters pay platform fees only — fees between parties settle directly, theirs alone." />
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
                <li><strong className="text-ink">{fmtMoney(p.perRequestFee.toString(), p.currency)}</strong> per consent request</li>
                {p.taxRate && Number(p.taxRate) > 0 ? <li className="text-xs">+ {p.taxLabel} {p.taxRate.toString()}%</li> : null}
              </ul>
            </div>
          ))}
        </Card>
      </div>
      <Alert>
        <strong>Owners can also set a consent price</strong> — what it costs just to ask them. It is
        paid in-app at submission, credited to the owner, and settled weekly. It filters out careless
        asks; it buys the ask, not the answer. Any usage fee agreed after approval is settled
        directly between the parties — that money never moves through Consent.
      </Alert>
      <Alert>
        <strong>Per-request fees and consent prices are non-refundable</strong> in every outcome —
        approved, denied, closed, withdrawn or unanswered. Lapsed subscriptions keep read access to
        past grants and certificates.
      </Alert>
      {note && (
        <Card>
          <Markdown source={note.body} />
        </Card>
      )}
    </div>
  );
}
