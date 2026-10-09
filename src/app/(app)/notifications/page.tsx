import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, EmptyState, Card } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { markNotificationsReadAction } from "../actions";
import { fmtDateTime, cn } from "@/lib/utils";
import { Bell } from "lucide-react";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const session = await requireUser();
  const notifications = await db.notification.findMany({
    where: { userId: session.userId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Notification centre"
        title="Notifications"
        action={
          notifications.some((n) => !n.readAt) ? (
            <form action={markNotificationsReadAction}>
              <SubmitButton variant="secondary" size="sm">Mark all read</SubmitButton>
            </form>
          ) : undefined
        }
      />
      {notifications.length === 0 ? (
        <EmptyState icon={Bell} title="Nothing yet" desc="State changes, requests and reminders will appear here." />
      ) : (
        <Card className="divide-y divide-ink/5 p-0 sm:p-0">
          {notifications.map((n) => {
            const inner = (
              <div className={cn("px-5 py-4", !n.readAt && "bg-ink/[0.025]")}>
                <div className="flex items-center gap-2">
                  {!n.readAt && <span className="size-1.5 rounded-full bg-ink" aria-label="Unread" />}
                  <div className="text-sm font-medium text-ink">{n.title}</div>
                </div>
                <div className="mt-0.5 text-sm text-ink-soft">{n.body}</div>
                <div className="mt-1 text-xs text-ink-faint">{fmtDateTime(n.createdAt)}</div>
              </div>
            );
            return n.href ? (
              <Link key={n.id} href={n.href} className="block transition-colors hover:bg-ink/[0.03]">
                {inner}
              </Link>
            ) : (
              <div key={n.id}>{inner}</div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
