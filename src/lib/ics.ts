/* iCalendar (.ics, RFC 5545) invites. Calendars such as Gmail, Outlook and
   Apple Calendar add an emailed invite to the recipient's calendar, and the
   same UID + a higher SEQUENCE updates or cancels that one event later. */

export type IcsEvent = {
  uid: string;
  sequence: number;
  start: Date;
  end: Date;
  title: string;
  description?: string;
  location?: string;
  url?: string;
  attendee: { name: string; email: string };
  cancelled?: boolean;
};

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const text = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Fold lines at 75 octets as the spec requires (continuation lines start with a space). */
function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    let end = Math.min(start + (parts.length ? 74 : 75), bytes.length);
    // don't split a multi-byte character
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
  }
  return parts.join("\r\n ");
}

/**
 * One invite per person: each side gets an event that lists only themselves,
 * so a meeting never reveals anyone's email to the other side.
 */
export function buildIcs(e: IcsEvent, organizerEmail = "meetings@consent.app"): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Consent//Request meetings//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${e.cancelled ? "CANCEL" : "REQUEST"}`,
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `SEQUENCE:${e.sequence}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(e.start)}`,
    `DTEND:${stamp(e.end)}`,
    `SUMMARY:${text(e.title)}`,
    ...(e.description ? [`DESCRIPTION:${text(e.description)}`] : []),
    ...(e.location ? [`LOCATION:${text(e.location)}`] : []),
    ...(e.url ? [`URL:${e.url}`] : []),
    `ORGANIZER;CN=Consent:mailto:${organizerEmail}`,
    `ATTENDEE;CN=${text(e.attendee.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED:mailto:${e.attendee.email}`,
    `STATUS:${e.cancelled ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** "Add to calendar" links for people who prefer one tap over the emailed invite. */
export function calendarLinks(e: Omit<IcsEvent, "attendee" | "sequence" | "uid">) {
  const g = new URLSearchParams({
    action: "TEMPLATE",
    text: e.title,
    dates: `${stamp(e.start)}/${stamp(e.end)}`,
    details: [e.description, e.url].filter(Boolean).join("\n\n"),
    location: e.location ?? "",
  });
  const o = new URLSearchParams({
    subject: e.title,
    startdt: e.start.toISOString(),
    enddt: e.end.toISOString(),
    body: [e.description, e.url].filter(Boolean).join("\n\n"),
    location: e.location ?? "",
    path: "/calendar/action/compose",
    rru: "addevent",
  });
  return {
    google: `https://calendar.google.com/calendar/render?${g.toString()}`,
    outlook: `https://outlook.live.com/calendar/0/deeplink/compose?${o.toString()}`,
  };
}
