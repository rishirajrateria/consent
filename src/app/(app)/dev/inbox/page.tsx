import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { PageHeader, Card, EmptyState, Alert } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";
import { Mail, MessageSquare, InboxIcon } from "lucide-react";

export const metadata = { title: "Dev inbox" };
export const dynamic = "force-dynamic";

export default async function DevInboxPage() {
  const session = await requireUser();
  const targets = [session.user.email, session.user.phone].filter(Boolean) as string[];
  const messages = await db.outboxMessage.findMany({
    where: { to: { in: targets } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Development"
        title="Dev inbox"
        desc="Mock email and SMS provider output addressed to you. In production, these go through Resend / Twilio."
      />
      <Alert>OTP codes for email, phone and e-signature verification land here.</Alert>
      {messages.length === 0 ? (
        <EmptyState icon={InboxIcon} title="No messages yet" desc="Trigger an OTP or state change to see mail here." />
      ) : (
        <div className="space-y-3">
          {messages.map((m) => (
            <Card key={m.id} className="space-y-1 py-4">
              <div className="flex items-center gap-2 text-xs text-ink-faint">
                {m.channel === "email" ? <Mail className="size-3.5" aria-hidden /> : <MessageSquare className="size-3.5" aria-hidden />}
                <span className="font-semibold uppercase tracking-wider">{m.channel}</span>
                <span>→ {m.to}</span>
                <span className="ml-auto">{fmtDateTime(m.createdAt)}</span>
              </div>
              {m.subject && <div className="text-sm font-medium">{m.subject}</div>}
              <pre className="whitespace-pre-wrap font-sans text-sm text-ink-soft">{m.body}</pre>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
