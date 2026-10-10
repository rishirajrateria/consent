import { PageHeader, Card, Divider } from "@/components/ui";
import { Search, FileUp, Scale, Award, QrCode, ShieldOff, Flag, Users } from "lucide-react";
import { OWNER_PCT, REFUND_PCT, CONSENT_PCT } from "../fee-shares";

export const metadata = {
  title: "How it works",
  description: "How owners set the terms — and every approved use becomes a certificate anyone can check.",
};

const STEPS = [
  [Users, "Verified, once — on both sides", "Every consenter is verified manually — legal documents, official account proof (OAuth or manual), one entity = one account, and a mandatory verification meeting — so a yes is provably from its owner. Requesters are approval-gated with ID or business registration, then pay a one-time onboarding fee and a yearly subscription."],
  [Search, "Ask for the exact use", `Requesters describe the exact intended use, filled manually — no templates, no duplicates. Platform(s) and format(s), duration in seconds for timed formats, asset types, the exact assets used, the raw final content file, a separate thumbnail if it features the consenter, context, a creative plan with intent category, and the requested validity. A small platform fee is paid at submission and is never refunded. If the owner sets a consent request fee, it is paid at the same time and held until they answer. If they say yes, ${OWNER_PCT} goes to them; if not, ${REFUND_PCT} is refunded to the requester. Consent keeps ${CONSENT_PCT}.`],
  [Scale, "The owner decides — or their terms do", "The terms you wrote answer first: a consent matrix (allow / ask / never per platform × format × asset type) and prioritized standing rules can auto-approve, auto-deny or route requests. Otherwise the team approves (optionally with conditions), asks a question or for a change, sets a fee, or denies. A no needs no reason. An open request expires when neither side acts for a set number of days (7 by default); one left unanswered by the owner hurts their public Consent Score. Owners can also limit how many new requests they take; new requests pause until they catch up."],
  [FileUp, "Deal fees are settled directly", "Deal fees never move through Consent. If a fee is wanted, you negotiate it inside Consent — each side can send up to 3 counter-offers. When a deal is agreed, the owner picks which contact details to share (email, phone, address or manager), either side can schedule a meeting that goes into both calendars, and payment happens directly between the parties — Consent never processes, tracks or confirms it."],
  [Award, "You choose how formal the yes is", "The default is the in-app record. Either side can propose a legally binding agreement — platform-generated from jurisdiction templates and signed in-app (typed name + OTP + timestamp + IP), or your own signed contract uploaded and mutually confirmed."],
  [QrCode, "On the record, verifiable forever", "Every approval becomes a tamper-proof certificate locked to the exact approved files and sealed by Consent — it can't be faked, and it can't be quietly edited. The public page checks the seal every time it loads, and can tell anyone whether a file is one of the approved originals. The verification link must appear in the published content."],
  [ShieldOff, "A yes can become a no", "Owners can revoke future use (already-published content within scope stays covered) and raise takedown requests with a confirm-loop. Everything is recorded on the certificate."],
  [Flag, "Reports & the Consent Score", "Either side can put a breach on the record, with evidence. Upheld reports, ignored takedowns and unanswered requests all feed the public 0–1000 Consent Score. Consent takes no further enforcement action — for legal matters, export the signed Consent History Dossier."],
] as const;

export default function HowItWorksPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader kicker="consent." title="How it works" desc="You set the terms. This is how every yes goes on the record." />
      <div className="space-y-3">
        {STEPS.map(([Icon, title, body], i) => (
          <Card key={title} className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-xl bg-ink text-sm font-semibold text-white">{i + 1}</span>
              <Icon className="size-5 text-ink-soft" aria-hidden />
              <h2 className="font-semibold">{title}</h2>
            </div>
            <Divider />
            <p className="text-sm leading-relaxed text-ink-soft">{body}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
