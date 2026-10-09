import Link from "next/link";
import { Card, ButtonLink } from "@/components/ui";
import { ShieldCheck, FileCheck, Scale, Fingerprint, QrCode, Handshake, ArrowRight } from "lucide-react";

export const metadata = {
  title: "Consent — You set the terms now",
  description:
    "Consent is where people set the terms for their name, image, voice and likeness — and every approved use is signed, documented and verifiable forever.",
};

export default function HomePage() {
  return (
    <div className="space-y-16 pb-8">
      {/* Hero */}
      <section className="fade-up mx-auto max-w-3xl pt-10 text-center sm:pt-20">
        <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-ink/10 bg-white/50 px-3 py-1 text-xs font-medium text-ink-soft backdrop-blur">
          <ShieldCheck className="size-3.5" aria-hidden /> Permission infrastructure for identity
        </div>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">
          Your face. Your voice. Your story.
          <br />
          <span className="text-ink-faint">You set the terms now.</span>
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base text-ink-soft sm:text-lg">
          For decades, whoever hit publish decided how a face, a voice, a life got used. Consent
          reverses it: identity owners write binding, platform-by-platform terms, and every approved
          use becomes a tamper-proof record anyone can check, forever.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <ButtonLink href="/signup" className="px-6 py-3">
            Set your terms <ArrowRight className="size-4" aria-hidden />
          </ButtonLink>
          <ButtonLink href="/directory" variant="secondary" className="px-6 py-3">
            Create with permission
          </ButtonLink>
        </div>
      </section>

      {/* Manifesto */}
      <section className="glass mx-auto max-w-3xl space-y-4 px-8 py-12 text-center">
        {[
          "A face is property. A voice is property. A story is property.",
          "For decades, the person on screen had the least say in how the screen used them.",
          "Now the owner writes the terms — platform by platform, use by use.",
          "Every yes is sealed and locked to the exact files it approves. Anyone can check it, forever.",
          "A no needs no reason.",
          "Nothing moves without permission.",
        ].map((line) => (
          <p key={line} className="text-lg font-medium tracking-tight sm:text-xl">
            {line}
          </p>
        ))}
      </section>

      {/* How it works */}
      <section className="grid gap-4 sm:grid-cols-3">
        {[
          [Fingerprint, "1 · Verified, once.", "Every consenter is verified manually — real documents, a real meeting, one account per entity — so a yes is provably from its owner."],
          [Handshake, "2 · Ask. Decide. Agree.", "Requesters describe the exact intended use; owners approve, decline or set conditions, and the two parties settle terms directly between themselves."],
          [QrCode, "3 · On the record.", "Every approval becomes a tamper-proof certificate locked to the exact approved files — anyone can check it at the public link, forever."],
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

      {/* Two audiences */}
      <section className="grid gap-4 md:grid-cols-2">
        <Card strong className="space-y-3 p-8">
          <ShieldCheck className="size-7" strokeWidth={1.5} aria-hidden />
          <h2 className="text-xl font-semibold">Own your identity</h2>
          <p className="text-sm text-ink-soft">
            You have been filmed, quoted, memed and cloned on terms you never saw. Write your own:
            binding, platform-by-platform rules for your name, image, voice and likeness, where
            every approval becomes a signed certificate bound to the exact files you reviewed. You
            are verified once — real documents, a real meeting, one account that is provably you —
            and you never pay anything.
          </p>
          <ul className="space-y-1.5 text-sm text-ink-soft">
            <li>· Terms you wrote, not terms you tolerate</li>
            <li>· Every yes signed and bound to the exact files you reviewed</li>
            <li>· You never pay. A no needs no reason.</li>
          </ul>
          <ButtonLink href="/signup" variant="secondary">Set your terms</ButtonLink>
        </Card>
        <Card strong className="space-y-3 p-8">
          <FileCheck className="size-7" strokeWidth={1.5} aria-hidden />
          <h2 className="text-xl font-semibold">Create with permission</h2>
          <p className="text-sm text-ink-soft">
            Every upload used to be a bet on someone else&apos;s tolerance. Request the exact use on
            the exact platform, settle terms directly with the owner, and publish holding a
            tamper-proof certificate that proves exactly what was approved. When
            anyone asks whether you had permission, you don&apos;t argue — you point.
          </p>
          <ul className="space-y-1.5 text-sm text-ink-soft">
            <li>· Ask for the exact use, on the exact platform</li>
            <li>· Terms settled directly with the owner</li>
            <li>· Proof anyone can verify, forever</li>
          </ul>
          <ButtonLink href="/signup" variant="secondary">Create with permission</ButtonLink>
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
        Consent is not a payment intermediary and provides no legal advice.{" "}
        <Link href="/how-it-works" className="underline underline-offset-4">Learn how it works</Link>
      </p>
    </div>
  );
}
