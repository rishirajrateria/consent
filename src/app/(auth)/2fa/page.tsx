import { totpAction, logoutAction } from "../actions";
import { Card, Field, Input } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { ErrorNote } from "@/components/error-note";

export const metadata = { title: "Two-factor authentication" };

export default async function TwoFactorPage({ searchParams }: PageProps<"/2fa">) {
  const sp = await searchParams;
  return (
    <Card strong className="fade-up space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Two-factor authentication</h1>
        <p className="mt-1 text-sm text-ink-soft">Enter the 6-digit code from your authenticator app.</p>
      </div>
      <ErrorNote error={sp.error as string | undefined} />
      <form action={totpAction} className="space-y-4">
        <Field label="Authenticator code" required>
          <Input name="code" required inputMode="numeric" pattern="\d{6}" maxLength={6} placeholder="000000" className="text-center text-lg tracking-[0.5em]" autoFocus />
        </Field>
        <SubmitButton className="w-full">Verify</SubmitButton>
      </form>
      <form action={logoutAction}>
        <SubmitButton variant="ghost" className="w-full">Use a different account</SubmitButton>
      </form>
    </Card>
  );
}
