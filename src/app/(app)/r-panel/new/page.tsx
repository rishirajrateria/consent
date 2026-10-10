import { requireRequester } from "@/lib/auth";
import { searchConsenters } from "@/lib/search";
import { PageHeader, Card, Input, VerifiedBadge, EmptyState, Alert } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { ErrorNote } from "@/components/error-note";
import { createDraftAction } from "../requests/actions";
import { requesterActive, consentPriceFor } from "@/lib/payments";
import { db } from "@/lib/db";
import { InvitePanel } from "@/components/invite-panel";
import { SuccessNote } from "@/components/error-note";
import { titleCase, fmtMoney } from "@/lib/utils";
import { Search, UserRound } from "lucide-react";

export const metadata = { title: "New request" };

export default async function NewRequestPage({ searchParams }: PageProps<"/r-panel/new">) {
  const sp = await searchParams;
  const { requester } = await requireRequester();
  const q = typeof sp.q === "string" ? sp.q : "";
  const preselect = typeof sp.consenter === "string" ? sp.consenter : "";
  const results = await searchConsenters(q || preselect);
  const active = requesterActive(requester);
  // The consent request fee can depend on what the request is for (per-intent tiers),
  // so show its range rather than only the base price.
  const [tiers, intents] = results.length
    ? await Promise.all([
        db.consentPriceTier.findMany({
          where: { consenterId: { in: results.map((c) => c.id) } },
          select: { consenterId: true, intentCategoryId: true, amount: true },
        }),
        db.intentCategory.findMany({ where: { active: true }, select: { id: true } }),
      ])
    : [[], []];
  const asks = new Map(
    results.map((c) => {
      const priceTiers = tiers
        .filter((t) => t.consenterId === c.id)
        .map((t) => ({ intentCategoryId: t.intentCategoryId, amount: t.amount.toString() }));
      const prices = priceTiers.length && intents.length
        ? intents.map((i) => Number(consentPriceFor({ consentPrice: c.consentPrice, priceTiers }, i.id) ?? 0))
        : [Number(c.consentPrice ?? 0)];
      const [min, max] = [Math.min(...prices), Math.max(...prices)];
      const money = (n: number) => fmtMoney(n, c.consentPriceCurrency);
      // Every request also carries the platform fee, so no line reads as free.
      const ask =
        min !== max
          ? { price: `${money(min)} to ${money(max)}`, note: " · depends on what it's for, plus the platform fee" }
          : max > 0
            ? { price: money(max), note: " · plus the platform fee" }
            : { price: null, note: " · plus the platform fee" };
      return [c.id, ask];
    })
  );

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="New consent request"
        title="Who do you want to feature?"
        desc="Every request is filled in manually — no templates, no duplicating previous requests."
      />
      <ErrorNote error={sp.error as string | undefined} />
      {!active && (
        <Alert tone="warn">Your account must be approved with an active subscription before you can send requests.</Alert>
      )}

      <form method="GET" className="relative max-w-xl">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
        <Input name="q" defaultValue={q} placeholder="Search verified people, shows, brands…" className="pl-10" aria-label="Search consenters" />
      </form>

      {sp.invited && (
        <SuccessNote
          msg={`Invite recorded for ${sp.invited}. You'll be notified when they join and when they're verified.`}
        />
      )}
      {results.length === 0 ? (
        <EmptyState icon={UserRound} title="No verified profiles found" desc="Try another name, alias or handle." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((c) => (
            <Card key={c.id} className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex size-11 items-center justify-center rounded-2xl bg-ink/5 text-lg font-semibold">
                  {c.displayName.charAt(0)}
                </div>
                <VerifiedBadge />
              </div>
              <div>
                <div className="font-semibold">{c.displayName}</div>
                <div className="text-xs text-ink-faint">
                  {titleCase(c.entityType)}{c.category ? ` · ${c.category}` : ""} · score {c.score}
                </div>
                <div className="mt-1 text-xs text-ink-soft">
                  {asks.get(c.id)?.price ? (
                    <>
                      Consent request fee <strong className="text-ink">{asks.get(c.id)?.price}</strong>
                    </>
                  ) : (
                    "No consent request fee"
                  )}
                  {asks.get(c.id)?.note}
                </div>
              </div>
              <form action={createDraftAction}>
                <input type="hidden" name="consenter" value={c.slug} />
                <SubmitButton variant="secondary" size="sm" disabled={!active}>Start request</SubmitButton>
              </form>
            </Card>
          ))}
        </div>
      )}

      <InvitePanel
        query={q}
        returnTo={q ? `/r-panel/new?q=${encodeURIComponent(q)}` : "/r-panel/new"}
      />
    </div>
  );
}
