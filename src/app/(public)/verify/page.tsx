import { redirect } from "next/navigation";
import { PageHeader, Card, Field, Input } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { ErrorNote } from "@/components/error-note";
import { db } from "@/lib/db";

export const metadata = {
  title: "Verify a certificate",
  description: "Check any Consent certificate, grant link or certificate ID.",
};

async function verifyAction(formData: FormData) {
  "use server";
  const input = String(formData.get("q") ?? "").trim();
  const match = input.match(/\/v\/([a-z0-9]+)/i);
  const publicId = match ? match[1] : input;
  const grant = await db.grant.findFirst({
    where: { OR: [{ publicId }, { certificateId: { equals: publicId, mode: "insensitive" } }] },
  });
  if (!grant) redirect(`/verify?error=${encodeURIComponent("No certificate found for that link or ID")}`);
  redirect(`/v/${grant.publicId}`);
}

export default async function VerifyLanding({ searchParams }: PageProps<"/verify">) {
  const sp = await searchParams;
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <PageHeader
        kicker="Verification"
        title="Verify a consent certificate"
        desc="Paste a verification link (consent…/v/abc123) or a certificate ID (CERT-2026-…). On the certificate page you can also check whether a specific file is one of the approved originals."
      />
      <ErrorNote error={sp.error as string | undefined} />
      <Card strong>
        <form action={verifyAction} className="flex flex-wrap items-end gap-2">
          <div className="min-w-56 flex-1">
            <Field label="Link or certificate ID" required>
              <Input name="q" required placeholder="https://…/v/abc123 or CERT-2026-XXXXXXXX" />
            </Field>
          </div>
          <SubmitButton>Verify</SubmitButton>
        </form>
      </Card>
    </div>
  );
}
