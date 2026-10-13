/**
 * "Open now · until 22:00" or "Closed · opens Tue 17:30", worked out from the
 * opening hours as the business writes them in content.ts:
 *
 *   { days: "Tue – Thu", time: "17:30 – 22:00" }
 *   { days: "Saturday", time: "09:00 – 13:00" }
 *   { days: "Mon – Fri", time: "08:00 – 17:00" }
 *
 * Rows it cannot read are skipped rather than guessed at; with none it can
 * read, there is no status to show (null).
 */
export interface HoursRow {
  days: string;
  time: string;
}

export interface OpenStatus {
  open: boolean;
  label: string;
}

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const dayIndex = (word: string): number => DAY_NAMES.indexOf(word.trim().slice(0, 3).toLowerCase());

/** The days a row covers, 0 = Sunday. "Daily"/"Every day" is all of them. */
export function daysOf(text: string): number[] {
  const clean = text.trim().toLowerCase();
  if (/^(daily|every ?day|7 days|mon(day)?\s*[–-]\s*sun(day)?)$/.test(clean)) return [0, 1, 2, 3, 4, 5, 6];
  const days = new Set<number>();
  for (const part of clean.split(/,|&|\band\b/)) {
    const range = part.split(/\s*[–—-]\s*|\s+to\s+/);
    if (range.length === 2) {
      const from = dayIndex(range[0]);
      const to = dayIndex(range[1]);
      if (from < 0 || to < 0) continue;
      for (let day = from; ; day = (day + 1) % 7) {
        days.add(day);
        if (day === to) break;
      }
    } else {
      const day = dayIndex(part);
      if (day >= 0) days.add(day);
    }
  }
  return [...days];
}

/** Minutes after midnight for "17:30", or null. */
const minutes = (text: string): number | null => {
  const match = /^(\d{1,2})[:h.](\d{2})$/.exec(text.trim());
  if (!match) return null;
  const value = Number(match[1]) * 60 + Number(match[2]);
  return value <= 24 * 60 ? value : null;
};

/** Opening and closing minutes for "17:30 – 22:00"; null for "Closed" or anything unreadable. */
export function spanOf(text: string): { from: number; to: number } | null {
  const parts = text.split(/\s*[–—-]\s*|\s+to\s+/);
  if (parts.length !== 2) return null;
  const from = minutes(parts[0]);
  const to = minutes(parts[1]);
  return from === null || to === null ? null : { from, to: to <= from ? to + 24 * 60 : to };
}

const clock = (value: number): string => {
  const wrapped = value % (24 * 60);
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
};

export function openStatus(hours: HoursRow[] | undefined, now: Date): OpenStatus | null {
  const slots = (hours ?? [])
    .map((row) => ({ days: daysOf(row.days), span: spanOf(row.time) }))
    .filter((row): row is { days: number[]; span: { from: number; to: number } } => row.days.length > 0 && row.span !== null);
  if (slots.length === 0) return null;
  const today = now.getDay();
  const at = now.getHours() * 60 + now.getMinutes();

  for (const slot of slots) {
    // Open today, or still open from a late night that started yesterday.
    if (slot.days.includes(today) && at >= slot.span.from && at < slot.span.to) return { open: true, label: `Open now · until ${clock(slot.span.to)}` };
    const yesterday = (today + 6) % 7;
    if (slot.days.includes(yesterday) && slot.span.to > 24 * 60 && at < slot.span.to - 24 * 60) return { open: true, label: `Open now · until ${clock(slot.span.to)}` };
  }

  // The next opening, within a week.
  for (let ahead = 0; ahead < 8; ahead++) {
    const day = (today + ahead) % 7;
    const opening = slots
      .filter((slot) => slot.days.includes(day) && (ahead > 0 || slot.span.from > at))
      .map((slot) => slot.span.from)
      .sort((a, b) => a - b)[0];
    if (opening !== undefined) {
      const when = ahead === 0 ? "today" : ahead === 1 ? "tomorrow" : SHORT[day];
      return { open: false, label: `Closed · opens ${when} ${clock(opening)}` };
    }
  }
  return { open: false, label: "Closed" };
}
