import Link from "next/link";
import { Card, ButtonLink } from "@/components/ui";
import { ShieldCheck, FileCheck, Scale, Fingerprint, QrCode, Send, ArrowRight } from "lucide-react";
import { OWNER_PCT, PLATFORM_PCT } from "../fee-shares";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { fmtPrice } from "@/lib/currencies";

export const metadata = {
  title: "Consent — Ask anyone for consent. Decide who can use yours.",
  description:
    "One verified account to ask anyone for consent to use their name, image, voice or work, and to decide who can use yours. Every yes is a certificate anyone can check.",
};

export default async function HomePage() {
  // The membership is the same for every account; it is free while the admin has it switched off.
  const [settings, india] = await Promise.all([
    getSettings(),
    db.priceConfig.findUnique({ where: { country: "IN" } }),
  ]);
  const membership = fmtPrice(india?.membershipFee ?? 1000, india?.currency ?? "INR");
  return (
    <div className="space-y-16 pb-8">
      {/* Hero */}
      <section className="fade-up mx-auto max-w-3xl pt-10 text-center sm:pt-20">
        <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-ink/10 bg-white/50 px-3 py-1 text-xs font-medium text-ink-soft backdrop-blur">
          <ShieldCheck className="size-3.5" aria-hidden /> Permission, on the record
        </div>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">
          Ask anyone for consent.
          <br />
          <span className="text-ink-faint">Decide who can use yours.</span>
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base text-ink-soft sm:text-lg">
          One verified account does both. Ask a person, a show or a brand before you use their name,
          face, voice or work. Set your own terms for yours. Every yes becomes a certificate anyone can
          check, forever.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <ButtonLink href="/directory" variant="secondary" className="px-6 py-3">
            See who&apos;s here
          </ButtonLink>
          <ButtonLink href="/signup?next=%2Fonboarding" className="px-6 py-3">
            Get verified <ArrowRight className="size-4" aria-hidden />
          </ButtonLink>
        </div>
      </section>

      {/* Manifesto */}
      <section className="glass mx-auto max-w-3xl space-y-4 px-8 py-12 text-center">
        {[
          "A face is yours. A voice is yours. A story is yours.",
          "Everyone can ask. Everyone can say no.",
          "You write the terms for your own name, platform by platform, use by use.",
          "Every yes is sealed and locked to the exact files it approves.",
          "A no needs no reason.",
          "Once the certificate is issued, the matter is closed.",
        ].map((line) => (
          <p key={line} className="text-lg font-medium tracking-tight sm:text-xl">
            {line}
          </p>
        ))}
      </section>

      {/* How it works */}
      <section className="grid gap-4 sm:grid-cols-3">
        {[
          [Fingerprint, "1 · Verified, once.", "Every account goes through the same ID check: real documents, real channels, one account per person or name. So a yes is provably from its owner."],
          [Send, "2 · Ask. Decide.", "Describe the exact use. They approve, ask you a question, or decline. Your own terms can answer for you."],
          [QrCode, "3 · On the record.", "A yes becomes a tamper-proof certificate locked to the approved files. Anyone can check it at its public link, forever."],
        ].map(([Icon, title, body]) => {
          const I = Icon as typeof Fingerprint;
          return (
            <Card key={String(title)} className="space-y-2.5">
              <I className="size-6" strokeWidth={1.5} aria-hidden />
              <h2 className="font-semibold">{String(title)}</h2>
              <p className="text-sm text-ink-soft">{String(body)}</p>
            </Card>
          );
        })}
      </section>

      {/* One account, both ways */}
      <section>
        <Card strong className="mx-auto max-w-3xl space-y-4 p-8">
          <ShieldCheck className="size-7" strokeWidth={1.5} aria-hidden />
          <h2 className="text-xl font-semibold">One account, both ways</h2>
          <p className="text-sm text-ink-soft">
            Every account is the same. Use it to ask others, and to answer the people who ask you.
            Brands and shows can run a team profile that works exactly the same way.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <ul className="space-y-1.5 text-sm text-ink-soft">
              <li className="font-medium text-ink">When you ask</li>
              <li>· Ask for the exact use, on the exact platform</li>
              <li>· Free to ask, or their consent request fee + {PLATFORM_PCT} platform fee</li>
              <li>· Publish with proof anyone can check</li>
            </ul>
            <ul className="space-y-1.5 text-sm text-ink-soft">
              <li className="font-medium text-ink">When you&apos;re asked</li>
              <li>· Terms you wrote, not terms you tolerate</li>
              <li>· Free to ask you, or charge a consent request fee; {OWNER_PCT} is yours on a yes</li>
              <li>· A no needs no reason</li>
            </ul>
          </div>
          <ButtonLink href="/signup?next=%2Fonboarding">Get verified</ButtonLink>
        </Card>
      </section>

      {/* Trust strip */}
      <section className="glass flex flex-wrap items-center justify-center gap-x-10 gap-y-4 px-6 py-8 text-center">
        {[
          ["Tamper-proof certificates", Scale],
          ["Locked to the exact files", Fingerprint],
          ["Public Consent Scores", ShieldCheck],
          ["Permanent audit trail", FileCheck],
        ].map(([label, Icon]) => {
          const I = Icon as typeof Scale;
          return (
            <div key={String(label)} className="flex items-center gap-2 text-sm font-medium text-ink-soft">
              <I className="size-4" aria-hidden /> {String(label)}
            </div>
          );
        })}
      </section>

      <p className="text-center text-xs text-ink-faint">
        {settings.membershipFeeOn ? `Membership is ${membership} a year.` : `Membership is ${membership} a year, and free for now.`}{" "}
        <Link href="/pricing" className="underline underline-offset-4">See pricing</Link>
        {" · "}
        <Link href="/how-it-works" className="underline underline-offset-4">Learn how it works</Link>
      </p>
    </div>
  );
}
