/** Time until the event, in whole days, hours and minutes. Null once it has started. */
export function timeUntil(startsAt: string, now: number): { days: number; hours: number; minutes: number } | null {
  const left = new Date(startsAt).getTime() - now;
  if (!Number.isFinite(left) || left <= 0) return null;
  const minutes = Math.floor(left / 60_000);
  return { days: Math.floor(minutes / 1440), hours: Math.floor((minutes % 1440) / 60), minutes: minutes % 60 };
}

/** A calendar file for "Add to calendar": works with Google, Apple and Outlook calendars. */
export function calendarFile(event: { title: string; startsAt: string; hours: number; location: string; description: string }): string {
  const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const start = new Date(event.startsAt).getTime();
  const text = (value: string) => value.replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ARP Cloud Solutions//Invitation//EN",
    "BEGIN:VEVENT",
    `UID:${start}-${text(event.title).replace(/\s+/g, "-")}@invitation`,
    `DTSTAMP:${stamp(start)}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(start + event.hours * 3_600_000)}`,
    `SUMMARY:${text(event.title)}`,
    `LOCATION:${text(event.location)}`,
    `DESCRIPTION:${text(event.description)}`,
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");
}
