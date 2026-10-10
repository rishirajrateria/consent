import Link from "next/link";
import { signupAction } from "../actions";
import { Card, Field, Input } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { ErrorNote } from "@/components/error-note";
import { safeNext } from "@/lib/auth";

export const metadata = { title: "Create account" };

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  return (
    <Card strong className="fade-up space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Create your account</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Ask anyone for consent, and decide who can use yours.
        </p>
      </div>
      <ErrorNote error={sp.error as string | undefined} />
      <form action={signupAction} className="space-y-4">
        {next && <input type="hidden" name="next" value={next} />}
        <Field label="Full name" required>
          <Input name="name" required minLength={2} placeholder="Your name" autoComplete="name" />
        </Field>
        <Field label="Email" required>
          <Input name="email" type="email" required placeholder="you@example.com" autoComplete="email" />
        </Field>
        <Field label="Phone" required hint="Used for OTP and critical alerts.">
          <Input name="phone" type="tel" required placeholder="+1 555 000 1234" autoComplete="tel" />
        </Field>
        <Field label="Password" required hint="At least 8 characters.">
          <Input name="password" type="password" required minLength={8} autoComplete="new-password" placeholder="••••••••" />
        </Field>
        <p className="text-xs text-ink-faint">
          By creating an account you agree to the{" "}
          <Link href="/terms" className="underline underline-offset-4">Terms</Link> and{" "}
          <Link href="/privacy" className="underline underline-offset-4">Privacy policy</Link>.
        </p>
        <SubmitButton className="w-full">Create account</SubmitButton>
      </form>
      <p className="text-center text-sm text-ink-soft">
        Already registered?{" "}
        <Link href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"} className="font-medium text-ink underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </Card>
  );
}
