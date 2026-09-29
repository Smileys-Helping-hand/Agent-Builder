import { describe, expect, it } from "vitest";

import App from "./App";
import { site } from "./content";
import { can, changeRole, linePath, metrics, paginate, queryCustomers, type Customer } from "./data";
import { formatMoney } from "./lib/site";
import { esc, renderAt } from "./lib/testing";

describe("permissions", () => {
  it("gives each role exactly its powers", () => {
    expect(can("owner", "manage-billing")).toBe(true);
    expect(can("admin", "manage-billing")).toBe(false);
    expect(can("admin", "manage-team")).toBe(true);
    expect(can("member", "manage-team")).toBe(false);
    expect(can("member", "edit-customers")).toBe(true);
    expect(can("viewer", "edit-customers")).toBe(false);
    expect(can("viewer", "view")).toBe(true);
  });

  it("never lets the workspace lose its last owner", () => {
    expect(() => changeRole(site.team, "owner@demo.example", "admin")).toThrow(/at least one owner/);
    const promoted = changeRole(site.team, "finance@demo.example", "owner");
    expect(changeRole(promoted, "owner@demo.example", "admin").filter((member) => member.role === "owner")).toHaveLength(1);
  });
});

describe("metrics", () => {
  const sample: Customer[] = [
    { id: "a", name: "A", plan: "Starter", mrr: 500, status: "active", joined: "2025-01-01" },
    { id: "b", name: "B", plan: "Growth", mrr: 1500, status: "active", joined: "2025-01-01" },
    { id: "c", name: "C", plan: "Starter", mrr: 500, status: "churned", joined: "2025-01-01" },
    { id: "d", name: "D", plan: "Starter", mrr: 500, status: "trial", joined: "2025-01-01" }
  ];

  it("counts only active customers towards revenue", () => {
    const numbers = metrics(sample, [
      { month: "Jan", mrr: 1000 },
      { month: "Feb", mrr: 2000 }
    ]);
    expect(numbers).toEqual({ mrr: 2000, customers: 2, trials: 1, churnRate: 33.3, arpa: 1000, growth: 100 });
  });

  it("the sample history ends where the sample customers are, so the demo agrees with itself", () => {
    expect(site.history[site.history.length - 1].mrr).toBe(metrics(site.customers, site.history).mrr);
  });

  it("does not divide by zero with no customers or history", () => {
    expect(metrics([], [])).toEqual({ mrr: 0, customers: 0, trials: 0, churnRate: 0, arpa: 0, growth: 0 });
  });
});

describe("customer table", () => {
  it("searches, filters by status and sorts either way", () => {
    expect(queryCustomers(site.customers, { search: "dental" }).map((customer) => customer.name)).toEqual(["Drakensberg Dental"]);
    expect(queryCustomers(site.customers, { status: "churned" }).every((customer) => customer.status === "churned")).toBe(true);
    const byMrr = queryCustomers(site.customers, { sort: "mrr", descending: true });
    expect(byMrr[0].mrr).toBeGreaterThanOrEqual(byMrr[byMrr.length - 1].mrr);
  });

  it("pages, clamping out-of-range pages", () => {
    const items = Array.from({ length: 13 }, (_, index) => index);
    expect(paginate(items, 1, 6)).toEqual({ rows: [0, 1, 2, 3, 4, 5], page: 1, pages: 3 });
    expect(paginate(items, 9, 6)).toEqual({ rows: [12], page: 3, pages: 3 });
    expect(paginate([], 1, 6)).toEqual({ rows: [], page: 1, pages: 1 });
  });

  it("draws a chart path through every point", () => {
    const path = linePath([1, 2, 3], 100, 50, 0);
    expect(path).toBe("M0.0,50.0 L50.0,25.0 L100.0,0.0");
    expect(linePath([], 100, 50)).toBe("");
  });
});

describe("pages", () => {
  it("the public site shows features and prices", () => {
    const html = renderAt(<App />);
    for (const feature of site.features) expect(html).toContain(esc(feature.title));
    for (const plan of site.plans) expect(html).toContain(formatMoney(plan.price));
  });

  it("the dashboard asks you to sign in when nobody is", () => {
    expect(renderAt(<App />, "#/app/overview")).toContain("Choose who to sign in as");
  });

  it("signed in, it shows revenue and the customers the role may edit", () => {
    const signedIn = { session: "owner@demo.example" };
    const overview = renderAt(<App />, "#/app/overview", signedIn);
    expect(overview).toContain(formatMoney(metrics(site.customers, site.history).mrr));

    const customers = renderAt(<App />, "#/app/customers", signedIn);
    expect(customers).toContain(esc(site.customers[0].name));
    expect(customers).toContain("Plan for");

    const asViewer = renderAt(<App />, "#/app/customers", { session: "viewer@demo.example" });
    expect(asViewer).not.toContain("Plan for");
    expect(asViewer).toContain("can view customers but not change them");
  });

  it("billing and team controls follow the role", () => {
    expect(renderAt(<App />, "#/app/billing", { session: "member@demo.example" })).toContain("Only the account owner can change the plan");
    expect(renderAt(<App />, "#/app/team", { session: "owner@demo.example" })).toContain("Role for");
    expect(renderAt(<App />, "#/app/team", { session: "member@demo.example" })).toContain("Only owners and admins can change roles");
  });
});
