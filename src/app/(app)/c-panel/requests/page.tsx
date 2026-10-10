import Link from "next/link";
import { requireConsenter } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, StatusBadge, EmptyState, ButtonLink } from "@/components/ui";
import { ErrorNote, SuccessNote } from "@/components/error-note";
import { LocalTime } from "@/components/local-time";
import { fmtDateTime, cn } from "@/lib/utils";
import { getSettings } from "@/lib/settings";
import { OPEN_STATUSES, requestWindows } from "@/lib/request-window";
import type { Prisma } from "@prisma/client";
import { Inbox, Search, Send, Timer } from "lucide-react";
import { ASKER_MOVE, actingFor, askerStep, askingSeats, madeBy, seatsQuery, sentInclude, type SentRequest } from "./sent-step";
import { SentLink, StepLine } from "./sent-list";

export const metadata = { title: "Requests" };

// "Received" sub-filters. Each adds its own filter on top of "sent to this
// profile". Drafts nobody sent yet (no submittedAt) are never shown here.
const TABS: [string, Prisma.ConsentRequestWhereInput][] = [
  // Waiting for this profile's answer. Same count as "Needs your answer" on Home.
  ["Needs you", { status: "PENDING" }],
  // Open, waiting on them: being decided automatically, a question to answer, or the final file to upload.
  ["In progress", { status: { in: ["SUBMITTED", "CHANGES_REQUESTED", "APPROVED_IN_PRINCIPLE"] } }],
  ["Finished", { status: { in: ["APPROVED", "DENIED", "CLOSED", "EXPIRED_NO_RESPONSE", "WITHDRAWN"] } }],
  ["All", { status: { not: "DRAFT" } }],
];

// ?tab=Sent shows the requests this person made; any other tab is a "Received" filter.
const SENT_TAB = "Sent";

export default async function RequestsPage({ searchParams }: PageProps<"/c-panel/requests">) {
  const sp = await searchParams;
  const { consenter, session } = await requireConsenter();
  const wanted = typeof sp.tab === "string" ? sp.tab.trim().toLowerCase() : "";
  const showSent = wanted === SENT_TAB.toLowerCase();
  const received = { consenterId: consenter.id, submittedAt: { not: null } };

  const [needsAction, yourMove, settings, asker] = await Promise.all([
    db.consentRequest.count({ where: { ...received, ...TABS[0][1] } }),
    // Only profiles where this person can act: a view-only seat never has a move.
    db.consentRequest.count({ where: { ...actingFor(session.userId), ...ASKER_MOVE } }),
    getSettings(),
    // The active profile's sending half: its rows open with a plain link.
    db.requesterProfile.findUnique({ where: { consenterId: consenter.id }, select: { id: true } }),
  ]);

  const sent = showSent ? await loadSent(session.userId, settings.slaDays, asker?.id ?? null) : null;
  const inbox = showSent ? null : await loadReceived(consenter.id, wanted, settings.slaDays);

  const views = [
    { label: "Received", href: "/c-panel/requests", count: needsAction, note: "need your answer", active: !showSent },
    { label: SENT_TAB, href: `/c-panel/requests?tab=${SENT_TAB}`, count: yourMove, note: "waiting on you", active: showSent },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        kicker={consenter.displayName}
        title="Requests"
        desc={
          sent
            ? `Requests you sent. Each open request expires ${settings.slaDays} days after its last action from either side.`
            : `Each open request expires ${settings.slaDays} days after its last action from either side. If it expires waiting for your answer, your Consent Score drops.`
        }
        action={
          sent && sent.rows.length > 0 ? (
            <ButtonLink href="/find" size="sm">
              <Search className="size-4" aria-hidden /> Find someone to ask
            </ButtonLink>
          ) : undefined
        }
      />

      <nav aria-label="Requests" className="flex gap-6 border-b hairline">
        {views.map((v) => (
          <Link
            key={v.label}
            href={v.href}
            aria-current={v.active ? "page" : undefined}
            className={cn(
              "-mb-px flex items-center gap-2 border-b-2 px-1 pb-2.5 text-sm font-semibold transition-colors",
              v.active ? "border-ink text-ink" : "border-transparent text-ink-soft hover:text-ink",
            )}
          >
            {v.label}
            {v.count > 0 && (
              <span className="rounded-full bg-ink/10 px-1.5 py-0.5 text-[11px] font-semibold leading-none tabular-nums text-ink">
                {v.count}
                <span className="sr-only"> {v.note}</span>
              </span>
            )}
          </Link>
        ))}
      </nav>

      <ErrorNote error={sp.error} />
      {sent && sp.discarded && <SuccessNote msg="Draft discarded." />}
      {inbox && <ReceivedList {...inbox} />}
      {sent && <SentList {...sent} />}
    </div>
  );
}

// ── Received: requests sent to this profile ────────────────────

async function loadReceived(consenterId: string, wanted: string, slaDays: number) {
  const [tab, tabWhere] = TABS.find(([t]) => t.toLowerCase() === wanted) ?? TABS[0];
  const rows = await db.consentRequest.findMany({
    where: { consenterId, submittedAt: { not: null }, ...tabWhere },
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: { requester: true },
  });
  // Each open request expires a set number of days after its last action from either side.
  const windows = await requestWindows(
    rows.filter((r) => OPEN_STATUSES.includes(r.status)),
    slaDays,
  );
  return { tab, rows, windows };
}

function ReceivedList({ tab, rows, windows }: Awaited<ReturnType<typeof loadReceived>>) {
  return (
    <>
      <nav aria-label="Filter received requests" className="flex gap-1 overflow-x-auto">
        {TABS.map(([t]) => (
          <Link
            key={t}
            href={`/c-panel/requests?tab=${encodeURIComponent(t)}`}
            aria-current={t === tab ? "page" : undefined}
            className={cn("flex min-h-10 items-center whitespace-nowrap rounded-xl px-3 py-1.5 text-sm font-medium", t === tab ? "bg-ink text-white" : "text-ink-soft hover:bg-ink/5")}
          >
            {t}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={tab === TABS[0][0] ? "Nothing needs your answer." : "Nothing here yet."}
          desc={tab === TABS[0][0] ? "New requests to this profile show up here." : undefined}
        />
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <Link key={r.id} href={`/c-panel/requests/${r.id}`} className="block">
              <Card className="flex flex-wrap items-center gap-3 py-4 transition-all hover:shadow-glass-lg">
                <div className="flex size-10 items-center justify-center rounded-xl bg-ink/5 font-semibold">
                  {r.requester.displayName.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">#{r.number} · {r.requester.displayName}</div>
                  <div className="text-xs text-ink-faint">
                    {r.assetTypeNames.slice(0, 3).join(", ")} · {fmtDateTime(r.updatedAt)}
                  </div>
                </div>
                <Expiry at={windows.get(r.id)?.expiresAt} />
                <StatusBadge status={r.status} />
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

// ── Sent: requests this person sent from any of their profiles ──

async function loadSent(userId: string, slaDays: number, activeAskerId: string | null) {
  const [rows, drafts, seats] = await Promise.all([
    // Everything sent from any profile this person is on, view-only seats included.
    db.consentRequest.findMany({
      where: { ...madeBy(userId), status: { not: "DRAFT" } },
      orderBy: { updatedAt: "desc" },
      take: 100,
      include: sentInclude,
    }),
    // Drafts only from profiles where this person can finish and send them.
    db.consentRequest.findMany({
      where: { ...actingFor(userId), status: "DRAFT" },
      orderBy: { updatedAt: "desc" },
      take: 20,
      include: sentInclude,
    }),
    db.requesterMember.findMany(seatsQuery(userId)),
  ]);
  const windows = await requestWindows(
    rows.filter((r) => OPEN_STATUSES.includes(r.status)),
    slaDays,
  );
  return { rows, drafts, windows, activeAskerId, ...askingSeats(seats) };
}

function SentList({ rows, drafts, windows, manyProfiles, viewOnly, activeAskerId }: Awaited<ReturnType<typeof loadSent>>) {
  return (
    <>
      {rows.length === 0 ? (
        <EmptyState
          icon={Send}
          title={drafts.length > 0 ? "Nothing sent yet." : "You haven't asked anyone yet."}
          desc={
            drafts.length > 0
              ? "Finish a draft below and send it, or find someone else to ask."
              : "Search for someone by name, then ask for their permission."
          }
          action={
            <ButtonLink href="/find">
              <Search className="size-4" aria-hidden /> Find someone to ask
            </ButtonLink>
          }
        />
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <SentRow
              key={r.id}
              r={r}
              manyProfiles={manyProfiles}
              canAct={!viewOnly.has(r.requesterId)}
              direct={r.requesterId === activeAskerId}
              expiresAt={windows.get(r.id)?.expiresAt}
            />
          ))}
        </div>
      )}
      {drafts.length > 0 && (
        <section aria-labelledby="drafts-title" className="space-y-2">
          <div>
            <h2 id="drafts-title" className="text-sm font-semibold">Drafts</h2>
            <p className="text-xs text-ink-faint">Nobody sees these until you send them.</p>
          </div>
          {drafts.map((r) => (
            <SentRow key={r.id} r={r} manyProfiles={manyProfiles} canAct direct={r.requesterId === activeAskerId} />
          ))}
        </section>
      )}
    </>
  );
}

function SentRow({
  r,
  manyProfiles,
  canAct,
  direct,
  expiresAt,
}: {
  r: SentRequest;
  manyProfiles: boolean;
  canAct: boolean;
  /** Sent from the active profile: a plain link. */
  direct: boolean;
  expiresAt?: Date;
}) {
  const owner = r.consenter.displayName;
  return (
    <SentLink request={r} label={`Open request #${r.number} to ${owner}`} direct={direct}>
      <Card className="flex flex-wrap items-center gap-3 py-4 transition-all group-hover:shadow-glass-lg">
        <div className="flex size-10 items-center justify-center rounded-xl bg-ink/5 font-semibold">{owner.charAt(0)}</div>
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="truncate text-sm font-medium">#{r.number} · {owner}</div>
          <StepLine step={askerStep(r)} canAct={canAct} />
          <div className="text-xs text-ink-faint">
            {[
              r.assetTypeNames.slice(0, 3).join(", "),
              fmtDateTime(r.updatedAt),
              manyProfiles ? `as ${r.requester.displayName}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        <Expiry at={expiresAt} />
        <StatusBadge status={r.status} />
      </Card>
    </SentLink>
  );
}

function Expiry({ at }: { at?: Date }) {
  if (!at) return null;
  return (
    <span className="flex items-center gap-1 text-xs text-ink-soft">
      <Timer className="size-3.5 shrink-0" aria-hidden />
      <span>
        Expires <LocalTime iso={at.toISOString()} />
      </span>
    </span>
  );
}
