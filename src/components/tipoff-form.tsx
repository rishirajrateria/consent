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
 * Public tip-off: anyone (fan, journalist, bystander) can report use of this
 * profile's name, image or work without permission. No account needed. The
 * profile's whole team is told.
 */
export function TipOffForm({
  profileId,
  slug,
  displayName,
  sent,
  error,
}: {
  /** The profile (its id, the receiving half's). */
  profileId: string;
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
        consenterId: profileId,
        links,
        description: description.slice(0, 2000),
        reporterName: String(formData.get("reporterName") ?? "").trim().slice(0, 100) || null,
        reporterEmail: String(formData.get("reporterEmail") ?? "").trim().slice(0, 200) || null,
      },
    });
    await notifyConsenterTeam(profileId, {
      title: "Public tip-off: possible use without permission",
      body: `Someone reported you being used at ${links[0]}. Review it under Tip-offs.`,
      href: "/c-panel/tipoffs",
      critical: true,
    });
    redirect(`${back}?tipped=1#tipoff`);
  }

  return (
    <Card className="space-y-4" id="tipoff">
      <SectionTitle
        title={`Seen ${displayName} used without permission?`}
        desc="Report it. No account needed. They and the Consent team are told. Approved uses carry a verification link; if there isn't one, that's a signal."
      />
      {sent && <SuccessNote msg="Thank you. They have been told." />}
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
