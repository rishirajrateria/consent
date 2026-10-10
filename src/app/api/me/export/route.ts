import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

/** GDPR/DPDP data export: everything linked to the signed-in user, as JSON. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.userId;
  const [user, consenterMembers, requesterMembers, notifications, messages] =
    await Promise.all([
      db.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, email: true, phone: true, createdAt: true },
      }),
      db.consenterMember.findMany({ where: { userId }, include: { consenter: true } }),
      db.requesterMember.findMany({ where: { userId }, include: { requester: true } }),
      db.notification.findMany({ where: { userId } }),
      db.requestMessage.findMany({ where: { senderId: userId } }),
    ]);
  return NextResponse.json(
    { exportedAt: new Date().toISOString(), user, consenterMembers, requesterMembers, notifications, messages },
    { headers: { "Content-Disposition": 'attachment; filename="consent-data-export.json"' } }
  );
}
