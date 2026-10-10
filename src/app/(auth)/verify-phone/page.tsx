import { verifyPhoneAction, sendPhoneOtpAction, skipPhoneAction } from "../actions";
import { Card, Field, Input } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { ErrorNote, SuccessNote } from "@/components/error-note";
import Link from "next/link";
import { safeNext } from "@/lib/auth";

export const metadata = { title: "Verify phone" };

export default async function VerifyPhonePage({ searchParams }: PageProps<"/verify-phone">) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const keepNext = next ? <input type="hidden" name="next" value={next} /> : null;
  return (
    <Card strong className="fade-up space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Verify your phone</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Tap “Send code”, then enter the SMS code. Demo codes arrive in the{" "}
          <Link href="/dev/inbox" className="underline underline-offset-4">dev inbox</Link>.
        </p>
      </div>
      <ErrorNote error={sp.error as string | undefined} />
      {sp.sent && <SuccessNote msg="Code sent by SMS." />}
      <form action={sendPhoneOtpAction}>
        {keepNext}
        <SubmitButton variant="secondary" className="w-full">Send code</SubmitButton>
      </form>
      <form action={verifyPhoneAction} className="space-y-4">
        {keepNext}
        <Field label="SMS code" required>
          <Input name="code" required inputMode="numeric" pattern="\d{6}" maxLength={6} placeholder="123456" className="text-center text-lg tracking-[0.5em]" />
        </Field>
        <SubmitButton className="w-full">Verify phone</SubmitButton>
      </form>
      <form action={skipPhoneAction}>
        {keepNext}
        <SubmitButton variant="ghost" className="w-full">Skip for now</SubmitButton>
      </form>
    </Card>
  );
}
