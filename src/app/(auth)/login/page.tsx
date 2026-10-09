import Link from "next/link";
import { loginAction } from "../actions";
import { Card, Field, Input } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { ErrorNote } from "@/components/error-note";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  return (
    <Card strong className="fade-up space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Welcome back</h1>
        <p className="mt-1 text-sm text-ink-soft">Sign in to your Consent account.</p>
      </div>
      <ErrorNote error={sp.error as string | undefined} />
      <form action={loginAction} className="space-y-4">
        <Field label="Email" required>
          <Input name="email" type="email" autoComplete="email" required placeholder="you@example.com" />
        </Field>
        <Field label="Password" required>
          <Input name="password" type="password" autoComplete="current-password" required placeholder="••••••••" />
        </Field>
        <SubmitButton className="w-full">Sign in</SubmitButton>
      </form>
      <p className="text-center text-sm text-ink-soft">
        New here?{" "}
        <Link href="/signup" className="font-medium text-ink underline underline-offset-4">
          Create an account
        </Link>
      </p>
    </Card>
  );
}
