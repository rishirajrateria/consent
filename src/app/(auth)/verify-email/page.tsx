import { verifyEmailAction, resendEmailOtpAction } from "../actions";
import { Card, Field, Input } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { ErrorNote, SuccessNote } from "@/components/error-note";
import Link from "next/link";

export const metadata = { title: "Verify email" };

export default async function VerifyEmailPage({ searchParams }: PageProps<"/verify-email">) {
  const sp = await searchParams;
  return (
    <Card strong className="fade-up space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Check your email</h1>
        <p className="mt-1 text-sm text-ink-soft">
          We sent a 6-digit code to your email. In this demo environment, codes arrive in the{" "}
          <Link href="/dev/inbox" className="underline underline-offset-4">dev inbox</Link>.
        </p>
      </div>
      <ErrorNote error={sp.error as string | undefined} />
      {sp.sent && <SuccessNote msg="A new code was sent." />}
      <form action={verifyEmailAction} className="space-y-4">
        <Field label="Verification code" required>
          <Input name="code" required inputMode="numeric" pattern="\d{6}" maxLength={6} placeholder="123456" className="text-center text-lg tracking-[0.5em]" />
        </Field>
        <SubmitButton className="w-full">Verify email</SubmitButton>
      </form>
      <form action={resendEmailOtpAction}>
        <SubmitButton variant="ghost" className="w-full">Resend code</SubmitButton>
      </form>
    </Card>
  );
}
