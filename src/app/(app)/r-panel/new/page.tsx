import { requireRequester } from "@/lib/auth";
import { searchConsenters } from "@/lib/search";
import { PageHeader, Card, Input, VerifiedBadge, EmptyState, Alert } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { ErrorNote } from "@/components/error-note";
import { createDraftAction } from "../requests/actions";
import { requesterActive } from "@/lib/payments";
import { titleCase } from "@/lib/utils";
import { Search, UserRound } from "lucide-react";

export const metadata = { title: "New request" };

export default async function NewRequestPage({ searchParams }: PageProps<"/r-panel/new">) {
  const sp = await searchParams;
  const { requester } = await requireRequester();
  const q = typeof sp.q === "string" ? sp.q : "";
  const preselect = typeof sp.consenter === "string" ? sp.consenter : "";
  const results = await searchConsenters(q || preselect);
  const active = requesterActive(requester);

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
              </div>
              <form action={createDraftAction}>
                <input type="hidden" name="consenter" value={c.slug} />
                <SubmitButton variant="secondary" size="sm" disabled={!active}>Start request</SubmitButton>
              </form>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
