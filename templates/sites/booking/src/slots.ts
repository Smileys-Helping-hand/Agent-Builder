/**
 * Working out which appointment times can be offered. Plain functions, so the
 * rules are tested directly rather than through the page.
 */
export interface Service {
  id: string;
  name: string;
  minutes: number;
  price: number;
  description: string;
}

/** Opening hours for one weekday: 0 is Sunday. Leave a day out to close it. */
export interface DayHours {
  day: number;
  open: string;
  close: string;
  /** A break when nothing is booked, e.g. lunch. */
  breakFrom?: string;
  breakTo?: string;
}

export interface Booking {
  date: string;
  time: string;
  minutes: number;
}

const toMinutes = (time: string): number => {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
};

const toTime = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** "2026-03-14" for a date, in local time — not UTC, which shifts the day near midnight. */
export const isoDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const overlaps = (startA: number, endA: number, startB: number, endB: number): boolean => startA < endB && startB < endA;

/**
 * Start times on a date that fit a service of `minutes`, at `step` intervals,
 * inside opening hours, outside the break, not clashing with a booking, and —
 * on today's date — not already past (with `leadMinutes` notice).
 */
export function availableSlots(options: {
  date: string;
  minutes: number;
  hours: DayHours[];
  bookings: Booking[];
  step?: number;
  now?: Date;
  leadMinutes?: number;
}): string[] {
  const { date, minutes, hours, bookings, step = 30, now = new Date(), leadMinutes = 60 } = options;
  const [year, month, day] = date.split("-").map(Number);
  const weekday = new Date(year, month - 1, day).getDay();
  const today = hours.find((entry) => entry.day === weekday);
  if (!today) return [];

  const open = toMinutes(today.open);
  const close = toMinutes(today.close);
  const breakFrom = today.breakFrom ? toMinutes(today.breakFrom) : null;
  const breakTo = today.breakTo ? toMinutes(today.breakTo) : null;
  const taken = bookings.filter((booking) => booking.date === date);
  const isToday = date === isoDate(now);
  const earliest = isToday ? now.getHours() * 60 + now.getMinutes() + leadMinutes : -1;

  const slots: string[] = [];
  for (let start = open; start + minutes <= close; start += step) {
    const end = start + minutes;
    if (start < earliest) continue;
    if (breakFrom !== null && breakTo !== null && overlaps(start, end, breakFrom, breakTo)) continue;
    if (taken.some((booking) => overlaps(start, end, toMinutes(booking.time), toMinutes(booking.time) + booking.minutes))) continue;
    slots.push(toTime(start));
  }
  return slots;
}

/** The next `count` days that are open, starting from `from`. */
export function openDays(hours: DayHours[], count: number, from = new Date()): string[] {
  const days: string[] = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  for (let guard = 0; days.length < count && guard < 60; guard++) {
    if (hours.some((entry) => entry.day === cursor.getDay())) days.push(isoDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

export function describeDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" });
}
