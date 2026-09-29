/**
 * The dashboard's logic: permissions, metrics, tables and the chart.
 * Plain functions over plain data, so each rule has a test.
 */

export type Role = "owner" | "admin" | "member" | "viewer";

export type Action = "view" | "edit-customers" | "manage-team" | "manage-billing";

/**
 * Who may do what. This decides what the page shows; a real build must also
 * enforce it on the server, where a visitor cannot change it.
 */
const PERMISSIONS: Record<Role, Action[]> = {
  owner: ["view", "edit-customers", "manage-team", "manage-billing"],
  admin: ["view", "edit-customers", "manage-team"],
  member: ["view", "edit-customers"],
  viewer: ["view"]
};

export const can = (role: Role, action: Action): boolean => PERMISSIONS[role].includes(action);

export interface Customer {
  id: string;
  name: string;
  plan: "Starter" | "Growth" | "Scale";
  mrr: number;
  status: "active" | "trial" | "churned";
  joined: string;
}

export interface Member {
  email: string;
  name: string;
  role: Role;
}

export interface MonthPoint {
  month: string;
  mrr: number;
}

export interface Metrics {
  mrr: number;
  customers: number;
  trials: number;
  churnRate: number;
  arpa: number;
  growth: number;
}

export function metrics(customers: Customer[], history: MonthPoint[]): Metrics {
  const active = customers.filter((customer) => customer.status === "active");
  const mrr = active.reduce((sum, customer) => sum + customer.mrr, 0);
  const churned = customers.filter((customer) => customer.status === "churned").length;
  const everPaid = active.length + churned;
  const previous = history.length >= 2 ? history[history.length - 2].mrr : 0;
  const latest = history.length >= 1 ? history[history.length - 1].mrr : 0;
  return {
    mrr,
    customers: active.length,
    trials: customers.filter((customer) => customer.status === "trial").length,
    churnRate: everPaid === 0 ? 0 : Math.round((churned / everPaid) * 1000) / 10,
    arpa: active.length === 0 ? 0 : Math.round(mrr / active.length),
    growth: previous === 0 ? 0 : Math.round(((latest - previous) / previous) * 1000) / 10
  };
}

export type SortKey = "name" | "plan" | "mrr" | "joined";

export function queryCustomers(
  customers: Customer[],
  options: { search?: string; status?: Customer["status"] | "all"; sort?: SortKey; descending?: boolean }
): Customer[] {
  const { search = "", status = "all", sort = "name", descending = false } = options;
  const needle = search.trim().toLowerCase();
  const rows = customers.filter(
    (customer) => (status === "all" || customer.status === status) && (!needle || customer.name.toLowerCase().includes(needle))
  );
  rows.sort((a, b) => {
    const left = a[sort];
    const right = b[sort];
    const order = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right));
    return descending ? -order : order;
  });
  return rows;
}

export function paginate<T>(rows: T[], page: number, perPage: number): { rows: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const current = Math.min(Math.max(1, page), pages);
  return { rows: rows.slice((current - 1) * perPage, current * perPage), page: current, pages };
}

/** An SVG path for a line chart that fills a width × height box, with padding. */
export function linePath(values: number[], width: number, height: number, padding = 8): string {
  if (values.length === 0) return "";
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const step = values.length === 1 ? 0 : (width - padding * 2) / (values.length - 1);
  return values
    .map((value, index) => {
      const x = padding + index * step;
      const y = height - padding - ((value - min) / span) * (height - padding * 2);
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

/** Change a teammate's role, refusing to leave the workspace without an owner. */
export function changeRole(team: Member[], email: string, role: Role): Member[] {
  const next = team.map((member) => (member.email === email ? { ...member, role } : member));
  if (!next.some((member) => member.role === "owner")) throw new Error("A workspace needs at least one owner.");
  return next;
}
