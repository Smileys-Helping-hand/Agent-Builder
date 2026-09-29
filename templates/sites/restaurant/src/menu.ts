/** The menu and reservation rules, as plain functions the tests call directly. */

export type Diet = "vegetarian" | "vegan" | "gluten-free" | "spicy";

export interface Dish {
  name: string;
  description: string;
  price: number;
  diet?: Diet[];
  /** Shown as a small highlight, e.g. "Chef's pick". */
  badge?: string;
}

export interface MenuSection {
  title: string;
  note?: string;
  dishes: Dish[];
}

/** Sections holding at least one dish that meets every chosen need; empty sections are dropped. */
export function filterMenu(menu: MenuSection[], needs: Diet[]): MenuSection[] {
  if (needs.length === 0) return menu;
  return menu
    .map((section) => ({
      ...section,
      dishes: section.dishes.filter((dish) => needs.every((need) => dish.diet?.includes(need)))
    }))
    .filter((section) => section.dishes.length > 0);
}

export interface ReservationRules {
  minParty: number;
  maxParty: number;
  /** Seatings offered, e.g. ["12:00", "12:30", …]. */
  times: string[];
  /** Weekdays closed for reservations: 0 is Sunday. */
  closedDays: number[];
}

/** The problems with a reservation request, or an empty list if it can be taken. */
export function checkReservation(
  request: { date: string; time: string; party: number },
  rules: ReservationRules,
  now = new Date()
): string[] {
  const problems: string[] = [];
  if (!Number.isInteger(request.party) || request.party < rules.minParty) {
    problems.push(`We take bookings for ${rules.minParty} or more.`);
  } else if (request.party > rules.maxParty) {
    problems.push(`For more than ${rules.maxParty} guests, please call us to arrange a group booking.`);
  }

  const [year, month, day] = request.date.split("-").map(Number);
  if (!year || !month || !day) {
    problems.push("Choose a date.");
    return problems;
  }
  const date = new Date(year, month - 1, day);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (date < today) problems.push("That date has passed.");
  if (rules.closedDays.includes(date.getDay())) problems.push("We are closed that day.");
  if (!rules.times.includes(request.time)) problems.push("Choose one of the listed times.");
  return problems;
}

/** The table number in a QR address like #/table/12, or null. */
export function tableFromRoute(route: string): string | null {
  const match = /^\/table\/([A-Za-z0-9-]{1,8})$/.exec(route);
  return match ? match[1] : null;
}
