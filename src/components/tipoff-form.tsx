import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/ratelimit";
import { notifyConsenterTeam } from "@/lib/notify";
import { Card, SectionTitle, Field, Input, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { SuccessNote, ErrorNote } from "@/components/error-note";
import { Megaphone } from "lucide-react";

/**
 * Public tip-off: anyone — fan, journalist, bystander — can report
 * unauthorized use of this consenter's likeness. No account needed.
 */
export function TipOffForm({
  consenterId,
  slug,
  displayName,
  sent,
  error,
}: {
  consenterId: string;
  slug: string;
  displayName: string;
  sent?: boolean;
  error?: string;
}) {
  async function tipOffAction(formData: FormData) {
    "use server";
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const back = `/c/${slug}`;
    if (!rateLimit("tipoff", ip, 3, 60 * 60_000))
      redirect(`${back}?tiperror=${encodeURIComponent("Too many reports from this connection — try again later")}#tipoff`);
    const description = String(formData.get("description") ?? "").trim();
    // Keep links typed without "https://" (e.g. "tiktok.com/@brand/video/1")
    // instead of silently dropping them.
    const links = String(formData.get("links") ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => (/^https?:\/\//i.test(l) ? l : /^[\w-]+(\.[\w-]+)+(\/|$)/.test(l) ? `https://${l}` : null))
      .filter((l): l is string => !!l)
      .slice(0, 10);
    if (description.length < 20 || links.length === 0)
      redirect(`${back}?tiperror=${encodeURIComponent("Add at least one link and a short description (min 20 characters)")}#tipoff`);
    await db.publicTipOff.create({
      data: {
        consenterId,
        links,
        description: description.slice(0, 2000),
        reporterName: String(formData.get("reporterName") ?? "").trim().slice(0, 100) || null,
        reporterEmail: String(formData.get("reporterEmail") ?? "").trim().slice(0, 200) || null,
      },
    });
    await notifyConsenterTeam(consenterId, {
      title: "Public tip-off: possible unauthorized use",
      body: `Someone reported your likeness being used at ${links[0]}. Review it under Tip-offs.`,
      href: "/c-panel/tipoffs",
      critical: true,
    });
    redirect(`${back}?tipped=1#tipoff`);
  }

  return (
    <Card className="space-y-4" id="tipoff">
      <SectionTitle
        title={`Seen ${displayName} used without permission?`}
        desc="Report it — no account needed. The owner and the Consent team are notified. Approved uses carry a verification link; if there isn't one, that's a signal."
      />
      {sent && <SuccessNote msg="Thank you. The owner has been notified." />}
      <ErrorNote error={error} />
      <form action={tipOffAction} className="space-y-3">
        <Field label="Where did you see it?" required hint="Links, one per line.">
          <Textarea name="links" required className="min-h-14" placeholder="tiktok.com/… or https://…" />
        </Field>
        <Field label="What did you see?" required>
          <Textarea name="description" required minLength={20} className="min-h-16" placeholder="e.g. An ad using their face with no consent link anywhere." />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Your name" hint="Optional.">
            <Input name="reporterName" placeholder="optional" />
          </Field>
          <Field label="Your email" hint="Optional — only if you want follow-up.">
            <Input name="reporterEmail" type="email" placeholder="optional" />
          </Field>
        </div>
        <SubmitButton variant="secondary">
          <Megaphone className="size-4" aria-hidden /> Send tip-off
        </SubmitButton>
      </form>
    </Card>
  );
}
