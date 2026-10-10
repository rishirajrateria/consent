import Link from "next/link";
import type { ReactNode } from "react";
import { requireConsenter } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { membershipOk } from "@/lib/membership";
import { profileScore } from "@/lib/profiles-pure";
import { PageHeader, Card, ScoreRing, StatusBadge, VerifiedBadge, ButtonLink } from "@/components/ui";
import { fmtDate } from "@/lib/utils";
import { feeLine } from "../find/asking";
import { idCheckNote } from "./id-check";
import {
  ArrowRight, Award, CreditCard, ExternalLink, Flag, Plus, ShieldCheck, SlidersHorizontal, UserCog, Users, Wallet,
  type LucideIcon,
} from "lucide-react";

export const metadata = { title: "Profile" };

/** A yearly price, without cents when it is a whole amount: "₹1,000". */
function yearly(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);
}

/** The membership price for a country (its PriceConfig, else the default one; ₹1,000 when none is set). */
async function membershipPrice(country: string) {
  const row =
    (await db.priceConfig.findUnique({ where: { country } })) ??
    (await db.priceConfig.findUnique({ where: { country: "DEFAULT" } }));
  return row ? yearly(Number(row.membershipFee.toString()), row.currency) : yearly(1000, "INR");
}

function HubCard({
  href,
  icon: Icon,
  title,
  children,
  links,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  children: ReactNode;
  /** Extra pages under this one. */
  links?: [string, string][];
}) {
  return (
    <Card className="flex flex-col gap-2">
      <Link href={href} className="group flex items-center gap-2 font-semibold">
        <Icon className="size-4 shrink-0 text-ink-soft" aria-hidden />
        <span className="group-hover:underline group-hover:underline-offset-4">{title}</span>
        <ArrowRight className="ml-auto size-4 text-ink-faint transition-transform group-hover:translate-x-0.5" aria-hidden />
      </Link>
      <div className="text-sm text-ink-soft">{children}</div>
      {links && (
        <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 pt-1 text-sm">
          {links.map(([to, label]) => (
            <Link key={to} href={to} className="font-medium underline underline-offset-4">
              {label}
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}

/** Everything about the active profile, one tap from the nav. */
export default async function ProfileHub() {
  const { consenter, member } = await requireConsenter();
  const [asker, settings, price, holding, tiers, intents] = await Promise.all([
    db.requesterProfile.findUnique({
      where: { consenterId: consenter.id },
      select: { id: true, score: true, membershipEndsAt: true },
    }),
    getSettings(),
    membershipPrice(consenter.country),
    db.grant.count({ where: { status: "ACTIVE", request: { requester: { consenterId: consenter.id } } } }),
    db.consentPriceTier.findMany({
      where: { consenterId: consenter.id },
      select: { intentCategoryId: true, amount: true },
    }),
    db.intentCategory.findMany({ where: { active: true }, select: { id: true } }),
  ]);
  const verifiedNow = consenter.status === "APPROVED";
  // The same wording and range rules as Find and the public profile.
  const line = feeLine(
    { consentPrice: consenter.consentPrice?.toString() ?? null, consentPriceCurrency: consenter.consentPriceCurrency },
    tiers.map((t) => ({ intentCategoryId: t.intentCategoryId, amount: t.amount.toString() })),
    intents.map((i) => i.id),
  );
  const fee = line.free ? "Free to ask" : `Consent request fee ${line.price}${line.note}`;
  const idCheck = idCheckNote(consenter.status, consenter.displayName, member.role === "OWNER");
  const paidUntil = asker?.membershipEndsAt ?? null;
  const membership = !settings.membershipFeeOn
    ? `${price} a year · free for now`
    : membershipOk({ membershipEndsAt: paidUntil }, true) && paidUntil
      ? `Membership paid until ${fmtDate(paidUntil)}`
      : `${price} a year · needed to send requests`;

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Profile"
        title={consenter.displayName}
        desc={verifiedNow ? <VerifiedBadge /> : <StatusBadge status={consenter.status} />}
        action={<ScoreRing score={profileScore(consenter.score, asker?.score)} />}
      />

      <Card strong className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold">Your public profile</h2>
          {verifiedNow ? (
            <p className="text-sm text-ink-soft">
              Your terms, your fee and your Consent Score. Share it so people know how to ask you.
            </p>
          ) : (
            <p className="text-sm text-ink-soft">
              {idCheck.link ? "It goes live once your ID check is approved." : `It goes live once the ID check is approved. ${idCheck.text}`}
            </p>
          )}
        </div>
        {verifiedNow ? (
          <ButtonLink href={`/c/${consenter.slug}`} variant="secondary">
            <ExternalLink className="size-4" aria-hidden /> View public profile
          </ButtonLink>
        ) : (
          idCheck.link && (
            <ButtonLink href={`/onboarding?profile=${consenter.id}`} variant="secondary">
              {idCheck.link} <ArrowRight className="size-4" aria-hidden />
            </ButtonLink>
          )
        )}
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <HubCard href="/c-panel/settings" icon={UserCog} title="Profile, fee & limits">
          {fee}. Your name, photo, payout details and how many requests you take.
        </HubCard>
        <HubCard
          href="/c-panel/matrix"
          icon={SlidersHorizontal}
          title="My terms"
          links={[
            ["/c-panel/matrix", "Matrix"],
            ["/c-panel/rules", "Rules"],
            ["/c-panel/lists", "Lists"],
          ]}
        >
          What&apos;s allowed at once, what needs your answer, and what&apos;s never allowed.
        </HubCard>
        <HubCard href="/r-panel/grants" icon={Award} title="Certificates you hold">
          {holding === 1 ? "1 active certificate" : `${holding} active certificates`}. Proof of every yes you got.
        </HubCard>
        <HubCard href="/c-panel/earnings" icon={Wallet} title="Earnings & payouts">
          What you earn from consent request fees, paid out on Fridays.
        </HubCard>
        <HubCard href="/r-panel/billing" icon={CreditCard} title="Payments & membership">
          {membership}. What you paid to ask.
        </HubCard>
        <HubCard href="/c-panel/team" icon={Users} title="Team">
          Who can answer, ask and manage this profile with you.
        </HubCard>
        <HubCard href="/c-panel/tipoffs" icon={Flag} title="Tip-offs">
          Reports from the public about possible use of your likeness without consent.
        </HubCard>
        <HubCard href="/settings" icon={ShieldCheck} title="Account & security">
          Your sign-in, two-step verification and notifications.
        </HubCard>
        <HubCard href="/onboarding?new=1" icon={Plus} title="Add a brand or show profile">
          Run a brand or a show? Give it its own verified profile. You can switch between them any time.
        </HubCard>
      </div>
    </div>
  );
}
