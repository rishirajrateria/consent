import { redirect } from "next/navigation";
import { verifyEmailAction, resendEmailOtpAction, changeEmailAction, logoutAction } from "../actions";
import { Card, Field, Input } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { ErrorNote, SuccessNote } from "@/components/error-note";
import { getSession, safeNext } from "@/lib/auth";
import { db } from "@/lib/db";

export const metadata = { title: "Verify email" };

export default async function VerifyEmailPage({ searchParams }: PageProps<"/verify-email">) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const session = await getSession();
  if (!session) redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  if (session.user.emailVerified) redirect(next ?? "/dashboard");
  const email = session.user.email;
  const keepNext = next ? <input type="hidden" name="next" value={next} /> : null;

  // Demo only: mail goes to the mock outbox, and the dev inbox sits behind
  // this very check, so show this account's own live code here.
  const demoCode = await db.otpCode.findFirst({
    where: { userId: session.userId, purpose: "EMAIL_VERIFY", target: email, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { code: true },
  });

  return (
    <Card strong className="fade-up space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Check your email</h1>
        <p className="mt-1 text-sm text-ink-soft">
          We sent a 6-digit code to <strong className="text-ink">{email}</strong>. You need it to use your account.
        </p>
      </div>
      <ErrorNote error={sp.error as string | undefined} />
      {sp.sent && <SuccessNote msg={`A new code was sent to ${email}.`} />}

      {/* The code is what the field below needs, so it comes first. */}
      <details className="glass-subtle px-4 py-3 text-sm">
        <summary className="flex min-h-10 cursor-pointer items-center font-medium">Demo inbox</summary>
        <p className="mt-1 text-xs text-ink-faint">This demo doesn&apos;t send real email, so your code is shown here.</p>
        <p className="mt-2 text-ink-soft">
          {demoCode ? (
            <>
              Your code: <strong className="font-mono text-ink">{demoCode.code}</strong>
            </>
          ) : (
            "No active code. Tap “Resend code”."
          )}
        </p>
      </details>

      <form action={verifyEmailAction} className="space-y-4">
        {keepNext}
        <Field label="Verification code" required>
          <Input name="code" required inputMode="numeric" pattern="\d{6}" maxLength={6} placeholder="123456" className="text-center text-lg tracking-[0.5em]" />
        </Field>
        <SubmitButton className="w-full">Verify email</SubmitButton>
      </form>
      <form action={resendEmailOtpAction}>
        {keepNext}
        <SubmitButton variant="ghost" className="w-full">Resend code</SubmitButton>
      </form>

      <details className="glass-subtle px-4 py-3 text-sm">
        <summary className="flex min-h-10 cursor-pointer items-center font-medium">Wrong address?</summary>
        <form action={changeEmailAction} className="mt-3 space-y-3">
          {keepNext}
          <Field label="Your email" required>
            <Input name="email" type="email" required autoComplete="email" defaultValue={email} />
          </Field>
          <SubmitButton variant="secondary" className="w-full">Send code to this address</SubmitButton>
        </form>
      </details>

      <form action={logoutAction}>
        {keepNext}
        <SubmitButton variant="ghost" className="w-full">Use a different account</SubmitButton>
      </form>
    </Card>
  );
}
