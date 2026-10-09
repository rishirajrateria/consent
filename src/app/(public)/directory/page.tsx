import Link from "next/link";
import { searchConsenters } from "@/lib/search";
import { PageHeader, Card, Input, VerifiedBadge, EmptyState } from "@/components/ui";
import { titleCase, scoreBand } from "@/lib/utils";
import { Search, UserRound } from "lucide-react";

export const metadata = {
  title: "Verified directory",
  description: "Search verified people, shows, brands and IP on Consent.",
};

export default async function DirectoryPage({ searchParams }: PageProps<"/directory">) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const results = await searchConsenters(q);

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Directory"
        title="Verified consenters"
        desc="People, shows, movies, brands and characters who manage their likeness through Consent."
      />
      <form method="GET" className="relative max-w-xl">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
        <Input
          name="q"
          defaultValue={q}
          placeholder="Search by name, alias, handle, category…"
          className="pl-10"
          aria-label="Search consenters"
        />
      </form>

      {results.length === 0 ? (
        <EmptyState
          icon={UserRound}
          title={q ? `No verified profiles match “${q}”` : "No verified profiles yet"}
          desc="Only manually verified consenters appear here."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((c) => (
            <Link key={c.id} href={`/c/${c.slug}`}>
              <Card className="h-full space-y-2 transition-all hover:shadow-glass-lg">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex size-11 items-center justify-center rounded-2xl bg-ink/5 text-lg font-semibold">
                    {c.displayName.charAt(0)}
                  </div>
                  <VerifiedBadge />
                </div>
                <div>
                  <div className="font-semibold">{c.displayName}</div>
                  <div className="text-xs text-ink-faint">
                    {titleCase(c.entityType)}
                    {c.category ? ` · ${c.category}` : ""} · {c.country}
                  </div>
                </div>
                <div className="text-xs text-ink-soft">
                  Consent Score <span className="font-semibold text-ink">{c.score}</span> · {scoreBand(c.score)}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
