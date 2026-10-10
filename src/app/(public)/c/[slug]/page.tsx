import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { profilesOf } from "@/lib/profiles";
import { profileScore } from "@/lib/profiles-pure";
import { getSettings } from "@/lib/settings";
import { Card, VerifiedBadge, ScoreRing, ButtonLink, SectionTitle } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { ChannelLinks } from "@/components/channel-links";
import { titleCase, fmtMoney } from "@/lib/utils";
import { storage } from "@/lib/storage";
import { TipOffForm } from "@/components/tipoff-form";
import { Check, X, CircleDashed } from "lucide-react";
import { OWNER_PCT, REFUND_PCT, CONSENT_PCT, PLATFORM_PCT } from "../../fee-shares";
import { requestCapacity, pausedMessage, type Capacity } from "@/lib/capacity";
import { LocalTime } from "@/components/local-time";
import { askingState, type AskingState } from "@/app/(app)/find/asking";
import { askFromFindAction, membershipFromFindAction } from "@/app/(app)/find/actions";
import { activeSeat } from "@/app/(app)/dashboard/active";
import { switchProfileAction } from "@/app/(app)/actions";
import type { Metadata } from "next";

/**
 * The one-sentence "paused" note from the profile's request limits, with its
 * date shown in the viewer's own time zone.
 */
function PausedSentence({ name, capacity }: { name: string; capacity: Capacity }) {
  const DATE = "\u0000";
  const [head, tail] = pausedMessage(name, capacity, () => DATE).split(DATE);
  return (
    <>
      {head}
      {tail !== undefined && capacity.opensAt && (
        <>
          <LocalTime iso={capacity.opensAt.toISOString()} withZone />
          {tail}
        </>
      )}
    </>
  );
}

export async function generateMetadata({ params }: PageProps<"/c/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const c = await db.consenterProfile.findUnique({ where: { slug } });
  if (!c || c.status !== "APPROVED") return { title: "Profile" };
  return {
    title: `${c.displayName} — verified on Consent`,
    description: `Ask ${c.displayName} for consent to use their name, image, voice or work.`,
    openGraph: { title: c.displayName, description: c.bio ?? undefined, type: "profile" },
  };
}

/**
 * THE public profile. Every profile can be asked and can ask, so this is the
 * only public page a profile has (/r/<slug> redirects here). It shows the
 * profile's terms, its consent request fee (or that asking is free), its one
 * Consent Score, and the way to ask, except on your own profile.
 */
export default async function PublicProfilePage({ params, searchParams }: PageProps<"/c/[slug]">) {
  const { slug } = await params;
  const sp = await searchParams;
  const c = await db.consenterProfile.findUnique({
    where: { slug },
    include: {
      matrixEntries: true,
      priceTiers: { include: { intentCategory: true } },
      asker: { select: { id: true, score: true, channels: true } },
    },
  });
  if (!c || c.status !== "APPROVED") notFound();
  const photo = c.photoFileId ? await db.storedFile.findUnique({ where: { id: c.photoFileId } }) : null;
  const photoUrl = photo ? storage.signedUrl(photo.storageKey, photo.name, 3600) : null;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": c.entityType === "PERSON" || c.entityType === "FICTIONAL_CHARACTER" ? "Person" : "Organization",
    name: c.displayName,
    alternateName: c.aliases,
    description: c.bio ?? undefined,
    url: `${process.env.APP_URL ?? ""}/c/${c.slug}`,
  };
  const score = profileScore(c.score, c.asker?.score);

  // The consent request fee: the base fee, or per-use fees (tiers) over it. 0 = free.
  const base = Number(c.consentPrice?.toString() ?? 0);
  const tiers = [...c.priceTiers].sort((a, b) => Number(a.amount) - Number(b.amount));
  const amounts = tiers.length ? [...tiers.map((t) => Number(t.amount.toString())), base] : [base];
  const maxFee = Math.max(...amounts);
  const minFee = Math.min(...amounts);
  const free = maxFee === 0;
  const money = (n: number) => fmtMoney(n, c.consentPriceCurrency);
  const feeText = free ? null : minFee === maxFee ? money(maxFee) : minFee === 0 ? `up to ${money(maxFee)}` : `${money(minFee)} to ${money(maxFee)}`;

  const session = await getSession();
  const [decided, expired, decidedTimes, capacity, certificates, profiles, settings] = await Promise.all([
    db.consentRequest.count({ where: { consenterId: c.id, decidedAt: { not: null } } }),
    // Only the request window's expiries are the profile's silence. Older admin
    // force-expiries reused this status and don't count (as in the score).
    db.consentRequest.count({
      where: { consenterId: c.id, status: "EXPIRED_NO_RESPONSE", events: { none: { type: "admin_force_expired" } } },
    }),
    db.consentRequest.findMany({
      where: { consenterId: c.id, decidedAt: { not: null }, submittedAt: { not: null } },
      select: { submittedAt: true, decidedAt: true },
      take: 100,
      orderBy: { decidedAt: "desc" },
    }),
    // The profile's request limits: while any is reached, nobody can send a new request.
    requestCapacity(c.id),
    // What they asked for and got: certificates they hold.
    c.asker ? db.grant.count({ where: { request: { requesterId: c.asker.id } } }) : Promise.resolve(0),
    session ? profilesOf(session.userId) : Promise.resolve([]),
    getSettings(),
  ]);
  const total = decided + expired;
  const responseRate = total > 0 ? Math.round((decided / total) * 100) : null;
  let medianHours: number | null = null;
  if (decidedTimes.length) {
    const hours = decidedTimes
      .map((r) => (r.decidedAt!.getTime() - r.submittedAt!.getTime()) / 3600_000)
      .sort((a, b) => a - b);
    medianHours = Math.round(hours[Math.floor(hours.length / 2)]);
  }

  // Who is looking: their own profile, or someone who can (or can't yet) ask.
  const ownSeat = profiles.find((m) => m.consenterId === c.id) ?? null;
  const isOwn = ownSeat !== null;
  // Settings open on the ACTIVE profile, so another profile of theirs must be switched to first.
  const ownIsActive = isOwn && activeSeat(profiles, session?.activeProfile ?? null)?.consenterId === c.id;
  const canEditOwn = ownSeat !== null && (ownSeat.role === "OWNER" || ownSeat.canEditRules);
  const others = profiles.filter((m) => m.consenterId !== c.id);
  const activeProfileId = activeSeat(others, session?.activeProfile ?? null)?.consenterId ?? null;
  const asking = askingState(
    others.map((m) => ({
      profileId: m.consenterId,
      role: m.role,
      profile: {
        displayName: m.consenter.displayName,
        status: m.consenter.status,
        membershipEndsAt: m.consenter.asker?.membershipEndsAt ?? null,
      },
    })),
    activeProfileId,
    settings.membershipFeeOn,
  );
  const here = `/c/${c.slug}`;

  // Summarize the terms: platform → asset type → one policy across formats.
  const platforms = await db.platform.findMany({
    where: { id: { in: [...new Set(c.matrixEntries.map((e) => e.platformId))] } },
    orderBy: { sortOrder: "asc" },
  });
  const assetTypes = await db.assetType.findMany({ orderBy: { sortOrder: "asc" } });
  const assetName = new Map(assetTypes.map((a) => [a.id, a.name]));

  const summary = platforms.map((p) => {
    const entries = c.matrixEntries.filter((e) => e.platformId === p.id);
    const byAsset = new Map<string, string[]>();
    for (const e of entries) byAsset.set(e.assetTypeId, [...(byAsset.get(e.assetTypeId) ?? []), e.policy]);
    const chips = [...byAsset.entries()].map(([assetTypeId, policies]) => {
      // A mix that includes "never" must not read as a safe "ask first".
      const policy = policies.every((x) => x === "AUTO_APPROVE")
        ? "allowed"
        : policies.every((x) => x === "AUTO_DENY")
          ? "never"
          : policies.some((x) => x === "AUTO_DENY")
            ? "some-never"
            : "ask";
      return { name: assetName.get(assetTypeId) ?? "?", policy };
    });
    return { platform: p.name, chips: chips.filter((ch) => ch.policy !== "ask").concat(chips.filter((ch) => ch.policy === "ask")) };
  });

  const askDesc = free
    ? `Asking ${c.displayName} is free: no consent request fee and no platform fee. Uses marked never allowed are declined automatically.`
    : `When you send, you pay ${tiers.length ? "the consent request fee for what your request is for" : `${c.displayName}'s consent request fee`} plus a ${PLATFORM_PCT} platform fee. The consent request fee is held until they answer. If they say yes, ${OWNER_PCT} goes to them; if not, ${REFUND_PCT} comes back to you. Consent keeps ${CONSENT_PCT}. The platform fee isn't refunded.${minFee === 0 ? " Some uses are free to ask." : ""} Uses marked never allowed are declined automatically.`;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Card strong className="fade-up space-y-4 p-7">
        <div className="flex flex-wrap items-start gap-4">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt={`${c.displayName} profile photo`} className="size-16 rounded-3xl object-cover" width={64} height={64} />
          ) : (
            <div className="flex size-16 items-center justify-center rounded-3xl bg-ink/5 text-2xl font-semibold">
              {c.displayName.charAt(0)}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{c.displayName}</h1>
              <VerifiedBadge />
            </div>
            <div className="mt-0.5 text-sm text-ink-soft">
              {titleCase(c.entityType)}
              {c.category ? ` · ${c.category}` : ""} · {c.country}
              {c.aliases.length > 0 && <span className="text-ink-faint"> · aka {c.aliases.join(", ")}</span>}
            </div>
            {c.bio && <p className="mt-2 text-sm text-ink-soft">{c.bio}</p>}
            <ChannelLinks channels={c.asker?.channels ?? []} owner={c.displayName} className="mt-3" />
          </div>
          <ScoreRing score={score} />
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t hairline pt-3 text-xs text-ink-soft">
          {responseRate != null && <span>Answers <strong className="text-ink">{responseRate}%</strong> of requests</span>}
          {medianHours != null && <span>Median answer <strong className="text-ink">{medianHours < 48 ? `${medianHours}h` : `${Math.round(medianHours / 24)}d`}</strong></span>}
          <span><strong className="text-ink">{decided}</strong> requests answered</span>
          {certificates > 0 && <span><strong className="text-ink">{certificates}</strong> certificates held</span>}
          <span>
            {free ? (
              <strong className="text-ink">Free to ask</strong>
            ) : (
              <>
                Consent request fee <strong className="text-ink">{feeText}</strong>
                {" + "}
                <Link href="/pricing" className="underline underline-offset-4">{PLATFORM_PCT} platform fee</Link>
              </>
            )}
          </span>
        </div>
        {/* Review first: point at the terms, the ask comes after them. */}
        <a href="#terms" className="inline-flex min-h-10 items-center text-sm font-medium underline underline-offset-4">
          See their terms
        </a>
      </Card>

      {tiers.length > 0 && (
        <Card className="space-y-2" id="terms">
          <SectionTitle
            title="Consent request fee by use"
            desc={`What it costs to ask, depending on what it's for. A paid fee is held until they answer. If they say yes, ${OWNER_PCT} goes to them; if not, ${REFUND_PCT} comes back to you. Consent keeps ${CONSENT_PCT}.`}
          />
          <div className="flex flex-wrap gap-1.5">
            {tiers.map((t) => (
              <span key={t.id} className="rounded-full border border-ink/20 bg-white/60 px-2.5 py-1 text-xs font-medium">
                {t.intentCategory.name}: {Number(t.amount) === 0 ? "free" : money(Number(t.amount.toString()))}
              </span>
            ))}
            <span className="rounded-full bg-ink/5 px-2.5 py-1 text-xs">
              everything else: {base > 0 ? money(base) : "free"}
            </span>
          </div>
        </Card>
      )}

      <Card className="space-y-4" id={tiers.length > 0 ? undefined : "terms"}>
        <SectionTitle
          title="What's generally allowed"
          desc={`Defaults ${c.displayName} set. Your request may still be reviewed or declined.`}
        />
        {summary.length === 0 && (
          <p className="text-sm text-ink-faint">No public defaults yet. Every request is reviewed one by one.</p>
        )}
        <div className="space-y-4">
          {summary.map((row) => (
            <div key={row.platform}>
              <div className="mb-1.5 text-sm font-semibold">{row.platform}</div>
              <div className="flex flex-wrap gap-1.5">
                {row.chips.map((chip) => (
                  <span
                    key={chip.name}
                    className={
                      chip.policy === "allowed"
                        ? "inline-flex items-center gap-1 rounded-full bg-ink px-2.5 py-1 text-[11px] font-medium text-white"
                        : chip.policy === "never"
                          ? "inline-flex items-center gap-1 rounded-full border border-ink/15 px-2.5 py-1 text-[11px] text-ink-faint line-through"
                          : "inline-flex items-center gap-1 rounded-full border border-dashed border-ink/30 px-2.5 py-1 text-[11px] text-ink-soft"
                    }
                  >
                    {chip.policy === "allowed" ? <Check className="size-3" aria-hidden /> : chip.policy === "ask" ? <CircleDashed className="size-3" aria-hidden /> : <X className="size-3" aria-hidden />}
                    {chip.policy === "some-never" ? `${chip.name} · some formats never` : chip.name}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-ink-faint">
          Solid = allowed without asking · dashed = ask first · dashed with ✕ = never on some formats · crossed = never allowed.
        </p>
      </Card>

      {/* Decide last: the ask comes after the fee and the allowed / never terms. */}
      {isOwn ? (
        <Card strong className="space-y-3" id="ask">
          <SectionTitle title="This is your profile" desc="This is how others see you. You can't send a request to yourself." />
          {ownSeat?.role === "VIEWER" && <p className="text-sm text-ink-soft">You have view-only access to this profile.</p>}
          {!ownIsActive ? (
            <form action={switchProfileAction}>
              <input type="hidden" name="profile" value={c.id} />
              <SubmitButton variant="secondary" className="w-full justify-center sm:w-auto">
                Switch to {c.displayName}
              </SubmitButton>
            </form>
          ) : canEditOwn ? (
            <ButtonLink href="/c-panel/settings" variant="secondary" className="w-full justify-center sm:w-auto">
              Edit your profile, fee &amp; limits
            </ButtonLink>
          ) : ownSeat?.role !== "VIEWER" ? (
            <p className="text-sm text-ink-soft">The owner sets this profile&apos;s fee and limits.</p>
          ) : null}
        </Card>
      ) : capacity.paused ? (
        <Card strong className="space-y-3" id="ask">
          <SectionTitle title="New requests are paused" />
          <p className="text-sm text-ink-soft">
            <PausedSentence name={c.displayName} capacity={capacity} />
          </p>
          <ButtonLink href="/directory" variant="secondary" className="w-full justify-center sm:w-auto">
            Find someone else
          </ButtonLink>
        </Card>
      ) : (
        <Card strong className="space-y-3" id="ask">
          <SectionTitle title="Ready to ask?" desc={askDesc} />
          {!session ? (
            <>
              <p className="text-sm text-ink-soft">
                You&apos;ll sign in first. New here?{" "}
                <Link href={`/signup?next=${encodeURIComponent(here)}`} className="font-medium text-ink underline underline-offset-4">
                  Create an account
                </Link>
              </p>
              <ButtonLink href={`/login?next=${encodeURIComponent(`${here}#ask`)}`} className="w-full justify-center sm:w-auto">
                Ask for permission
              </ButtonLink>
            </>
          ) : (
            <AskAction asking={asking} slug={c.slug} q={c.displayName} manyProfiles={others.length > 1} />
          )}
        </Card>
      )}

      <TipOffForm
        profileId={c.id}
        slug={c.slug}
        displayName={c.displayName}
        sent={!!sp.tipped}
        error={typeof sp.tiperror === "string" ? sp.tiperror : undefined}
      />
    </div>
  );
}

/** The one next step for a signed-in visitor, by where their own profiles stand. */
function AskAction({ asking, slug, q, manyProfiles }: { asking: AskingState; slug: string; q: string; manyProfiles: boolean }) {
  switch (asking.kind) {
    case "ready":
      return (
        <form action={askFromFindAction} className="space-y-2">
          {manyProfiles && (
            <p className="text-sm text-ink-soft">
              You ask as <strong className="text-ink">{asking.name}</strong>.
            </p>
          )}
          <input type="hidden" name="consenter" value={slug} />
          <input type="hidden" name="profile" value={asking.profileId} />
          {/* If the ask can't start, Find opens on this profile with the reason. */}
          <input type="hidden" name="q" value={q} />
          <SubmitButton className="w-full justify-center sm:w-auto">Ask for permission</SubmitButton>
        </form>
      );
    case "unverified":
      return (
        <div className="space-y-2">
          <p className="text-sm text-ink-soft">You can ask once your ID check is approved.</p>
          <ButtonLink href="/onboarding" variant="secondary" className="w-full justify-center sm:w-auto">
            See your ID check
          </ButtonLink>
        </div>
      );
    case "membership":
      return (
        <form action={membershipFromFindAction} className="space-y-2">
          <p className="text-sm text-ink-soft">Sending requests needs a membership.</p>
          <input type="hidden" name="profile" value={asking.profileId} />
          <input type="hidden" name="q" value={q} />
          <SubmitButton variant="secondary">Get a membership</SubmitButton>
        </form>
      );
    case "viewOnly":
      return (
        <p className="text-sm text-ink-soft">
          You have view-only access to {asking.name}. Ask the profile owner to send requests.
        </p>
      );
    case "none":
      return (
        <div className="space-y-2">
          <p className="text-sm text-ink-soft">To ask someone, get verified first. It&apos;s one ID check.</p>
          <ButtonLink href="/onboarding" className="w-full justify-center sm:w-auto">
            Get verified
          </ButtonLink>
        </div>
      );
  }
}
