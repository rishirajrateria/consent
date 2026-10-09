import Link from "next/link";
import { Card, ButtonLink } from "@/components/ui";
import { ShieldCheck, FileCheck, Scale, Fingerprint, QrCode, Handshake, ArrowRight } from "lucide-react";

export const metadata = {
  title: "Consent — permission, documented",
  description:
    "Famous people and IP owners record how their likeness may be used. Creators get documented, verifiable approval before publishing.",
};

export default function HomePage() {
  return (
    <div className="space-y-16 pb-8">
      {/* Hero */}
      <section className="fade-up mx-auto max-w-3xl pt-10 text-center sm:pt-20">
        <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-ink/10 bg-white/50 px-3 py-1 text-xs font-medium text-ink-soft backdrop-blur">
          <ShieldCheck className="size-3.5" aria-hidden /> The likeness & IP permission platform
        </div>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">
          Use their likeness.
          <br />
          <span className="text-ink-faint">With their consent.</span>
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-base text-ink-soft sm:text-lg">
          Public figures, shows and brands set the rules. Creators, news channels and podcasts get
          documented, verifiable approval — with a tamper-proof certificate for every grant.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <ButtonLink href="/signup" className="px-6 py-3">
            Get started <ArrowRight className="size-4" aria-hidden />
          </ButtonLink>
          <ButtonLink href="/directory" variant="secondary" className="px-6 py-3">
            Browse verified profiles
          </ButtonLink>
        </div>
      </section>

      {/* How it works */}
      <section className="grid gap-4 sm:grid-cols-3">
        {[
          [Fingerprint, "1 · Verified identities", "Every consenter is manually verified — documents, official accounts and a verification meeting. One entity, one account."],
          [Handshake, "2 · Ask, decide, agree", "Requesters describe exactly what they'll publish and upload the final file. Consenters approve, set conditions, ask a fee or deny — or let standing rules decide instantly."],
          [QrCode, "3 · Tamper-proof certificate", "Every approval is bound to the file's SHA-256 hash and signed by the platform. Anyone can verify it at the public link — forever."],
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
          <h2 className="text-xl font-semibold">For consenters</h2>
          <p className="text-sm text-ink-soft">
            Influencers, celebrities, TV shows, movies, brands, characters. Decide platform by
            platform what&apos;s allowed automatically, what needs your approval and what&apos;s never
            OK. Your team handles requests; every action is logged. Free, always.
          </p>
          <ul className="space-y-1.5 text-sm text-ink-soft">
            <li>· Consent matrix + standing rules with auto-decisions</li>
            <li>· Blacklist and whitelist requesters</li>
            <li>· Revocation and takedown requests</li>
          </ul>
          <ButtonLink href="/signup" variant="secondary">Protect your likeness</ButtonLink>
        </Card>
        <Card strong className="space-y-3 p-8">
          <FileCheck className="size-7" strokeWidth={1.5} aria-hidden />
          <h2 className="text-xl font-semibold">For requesters</h2>
          <p className="text-sm text-ink-soft">
            Creators, news channels, meme pages, podcasts, media houses. Stop guessing whether
            you&apos;re allowed to use someone&apos;s name, face or footage — get proof you were.
          </p>
          <ul className="space-y-1.5 text-sm text-ink-soft">
            <li>· Search verified people and IP, see what&apos;s generally allowed</li>
            <li>· Negotiate fees directly — Consent never touches the money</li>
            <li>· Signed certificate + public verification link for every grant</li>
          </ul>
          <ButtonLink href="/signup" variant="secondary">Request consent</ButtonLink>
        </Card>
      </section>

      {/* Trust strip */}
      <section className="glass flex flex-wrap items-center justify-center gap-x-10 gap-y-4 px-6 py-8 text-center">
        {[
          ["Ed25519-signed certificates", Scale],
          ["SHA-256 file binding", Fingerprint],
          ["Public Consent Scores", ShieldCheck],
          ["Hash-chained audit log", FileCheck],
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
