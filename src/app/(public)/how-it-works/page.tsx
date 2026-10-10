import { PageHeader, Card, Divider } from "@/components/ui";
import { Search, Scale, QrCode, ShieldOff, Flag, Users, Wallet } from "lucide-react";
import { OWNER_PCT, REFUND_PCT, CONSENT_PCT, PLATFORM_PCT } from "../fee-shares";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { fmtPrice } from "@/lib/currencies";

export const metadata = {
  title: "How it works",
  description: "One verified account to ask anyone for consent and to decide who can use yours. Every yes becomes a certificate anyone can check.",
};

const steps = (membership: string, days: number) => [
  [Users, "One account, verified once", `Every account is the same, and every account can ask and be asked. Everyone goes through one ID check: legal documents, your channels, one account per person or name. Our review team may ask for a short video call. Brands and shows can run a team profile that works the same way. ${membership}`],
  [Search, "Ask for the exact use", `Describe the exact use: platforms and formats, duration in seconds for timed formats, what of theirs you use, the final content file, a thumbnail if it features them, the context, your plan, and how long you need it. Many people are free to ask. Others set a consent request fee, from about ₹100 in the currency they choose. You pay it when you send, plus a ${PLATFORM_PCT} platform fee. The fee is held until they answer: if they say yes, ${OWNER_PCT} goes to them; if not, ${REFUND_PCT} comes back to you. Consent keeps ${CONSENT_PCT}. The platform fee isn't refunded. A free ask has no platform fee and is sent at once.`],
  [Scale, "They decide, or their terms do", `The terms they wrote answer first: allow, ask first or never, per platform, format and what is used, plus standing rules that can approve or decline on their own. Otherwise their team approves (with optional limits), asks you a question, or declines. A no needs no reason. Each step has ${days} days: a request nobody acts on ends, and one left unanswered lowers the Consent Score of the person asked. People can also limit how many requests they take; new requests pause until they catch up.`],
  [QrCode, "A certificate, and the matter is closed", "A yes becomes a tamper-proof certificate locked to the exact approved files and sealed by Consent. It can't be faked or quietly edited. The public page checks the seal every time it loads and can tell anyone whether a file is one of the approved originals. Put the verification link in the published content. Once the certificate is issued, the matter is closed."],
  [ShieldOff, "A yes can become a no", "The person who said yes can revoke future use (content already published within the approved scope stays covered) and ask for a takedown, which the other side confirms. Everything is recorded on the certificate."],
  [Flag, "Reports and the Consent Score", "Either side can put a breach on the record, with evidence. Upheld reports, ignored takedowns and unanswered requests all feed the public 0–1000 Consent Score. Consent takes no further action. You can export the Consent History Dossier of any request as your record."],
  [Wallet, "Where the money goes", `Consent request fees are held until the answer and paid out on Fridays: ${OWNER_PCT} to the person who said yes. The platform fee and the membership are Consent's.`],
] as const;

export default async function HowItWorksPage() {
  const [settings, india] = await Promise.all([
    getSettings(),
    db.priceConfig.findUnique({ where: { country: "IN" } }),
  ]);
  const price = fmtPrice(india?.membershipFee ?? 1000, india?.currency ?? "INR");
  const STEPS = steps(
    settings.membershipFeeOn
      ? `Membership is ${price} a year, the same for everyone. You need it to send requests; being asked never needs it.`
      : `Membership is ${price} a year, the same for everyone, and free for now.`,
    settings.slaDays,
  );
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader kicker="consent." title="How it works" desc="Ask anyone for consent. Decide who can use yours. Every yes goes on the record." />
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
