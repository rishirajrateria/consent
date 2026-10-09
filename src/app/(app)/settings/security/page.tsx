import { requireUser, totpUri } from "@/lib/auth";
import { db } from "@/lib/db";
import QRCode from "qrcode";
import { Card, Field, Input, PageHeader, Alert } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { ErrorNote } from "@/components/error-note";
import { beginTotpSetupAction, confirmTotpAction } from "../actions";
import { redirect } from "next/navigation";

export const metadata = { title: "Set up 2FA" };

export default async function SecurityPage({ searchParams }: PageProps<"/settings/security">) {
  const sp = await searchParams;
  const session = await requireUser();
  const user = await db.user.findUnique({ where: { id: session.userId } });
  if (!user) redirect("/login");
  if (user.totpEnabled) redirect("/settings");

  // ensure a pending secret exists
  if (!user.totpSecret) {
    await beginTotpSetupAction();
  }
  const secret = user.totpSecret!;
  const qrDataUrl = await QRCode.toDataURL(totpUri(user.email, secret), {
    margin: 1,
    width: 220,
    color: { dark: "#111111", light: "#ffffff" },
  });

  return (
    <div className="mx-auto max-w-md space-y-6">
      <PageHeader kicker="Security" title="Set up two-factor authentication" />
      {sp.admin2fa && (
        <Alert tone="warn">Admin access and consenter team membership require 2FA. Finish this setup to continue.</Alert>
      )}
      <ErrorNote error={sp.error as string | undefined} />
      <Card strong className="space-y-5">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-soft">
          <li>Open Google Authenticator, 1Password or any TOTP app.</li>
          <li>Scan the QR code (or enter the secret manually).</li>
          <li>Enter the 6-digit code to confirm.</li>
        </ol>
        <div className="flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrDataUrl} alt="TOTP QR code" className="rounded-xl border hairline" width={220} height={220} />
        </div>
        <div className="text-center font-mono text-xs text-ink-soft break-all">{secret}</div>
        <form action={confirmTotpAction} className="space-y-3">
          <Field label="Code from your app" required>
            <Input name="code" required inputMode="numeric" maxLength={6} placeholder="000000" className="text-center text-lg tracking-[0.5em]" />
          </Field>
          <SubmitButton className="w-full">Enable 2FA</SubmitButton>
        </form>
      </Card>
    </div>
  );
}
