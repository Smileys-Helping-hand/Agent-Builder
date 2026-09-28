import { useState } from "react";

import { site } from "./content";
import { can, changeRole, linePath, metrics, paginate, queryCustomers, type Customer, type Member, type Role, type SortKey } from "./data";
import { DemoBanner, Footer, Header, Section, SmartForm, brandStyle, formatMoney, usePersistentState, useHashRoute } from "./lib/site";

const PER_PAGE = 6;

function Landing() {
  return (
    <>
      <section className="hero">
        <div className="container hero-grid">
          <div>
            <p className="eyebrow">{site.hero.eyebrow}</p>
            <h1>{site.hero.title}</h1>
            <p className="lead muted">{site.hero.subtitle}</p>
            <div className="btn-row">
              <a className="btn" href="#/login">
                Try the demo
              </a>
              <a className="btn btn-ghost" href="#pricing">
                See pricing
              </a>
            </div>
          </div>
          <MiniChart />
        </div>
      </section>
      <Section id="features" eyebrow="Features" title="Everything you need to run the numbers">
        <div className="grid grid-4">
          {site.features.map((feature) => (
            <article key={feature.title} className="card">
              <div className="card-icon" aria-hidden="true">
                {feature.icon}
              </div>
              <h3>{feature.title}</h3>
              <p className="muted">{feature.text}</p>
            </article>
          ))}
        </div>
      </Section>
      <Section id="pricing" eyebrow="Pricing" title="Simple monthly plans" intro="Prices in rand, excluding VAT. Cancel any time." tone="tinted">
        <div className="grid grid-3">
          {site.plans.map((plan) => (
            <article key={plan.name} className={`card ${plan.featured ? "card-featured" : ""}`}>
              <h3>{plan.name}</h3>
              <p className="price">
                {formatMoney(plan.price)}
                <span className="muted per-month"> /month</span>
              </p>
              <ul className="tick-list">
                {plan.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </Section>
      <Section eyebrow="Talk to us" title="Book a walkthrough">
        <SmartForm
          subject={`Demo request — ${site.business.name}`}
          settings={site.forms}
          fallbackEmail={site.business.email}
          submitLabel="Request a walkthrough"
          fields={[
            { name: "name", label: "Name", required: true },
            { name: "email", label: "Work email", type: "email", required: true },
            { name: "company", label: "Company" },
            { name: "customers", label: "How many customers?", type: "select", options: ["Under 100", "100 – 2 000", "Over 2 000"] }
          ]}
        />
      </Section>
    </>
  );
}

function MiniChart() {
  const values = site.history.map((point) => point.mrr);
  return (
    <div className="card chart-card" aria-label="Revenue over the last months">
      <p className="muted chart-label">Monthly recurring revenue</p>
      <p className="price">{formatMoney(values[values.length - 1] ?? 0)}</p>
      <svg viewBox="0 0 320 120" className="chart" role="img" aria-label="MRR trend">
        <path d={linePath(values, 320, 120)} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function Login({ onSignIn }: { onSignIn: (email: string) => void }) {
  return (
    <Section eyebrow="Demo" title="Choose who to sign in as" intro="This preview has no passwords — pick an account to see the dashboard from that person's side.">
      <div className="grid grid-3">
        {site.demoAccounts.map((account) => (
          <button key={account.email} className="card account" onClick={() => onSignIn(account.email)}>
            <strong>{account.name}</strong>
            <span className="chip">{account.role}</span>
            <span className="muted">{account.email}</span>
          </button>
        ))}
      </div>
    </Section>
  );
}

function Overview({ customers }: { customers: Customer[] }) {
  const numbers = metrics(customers, site.history);
  const values = site.history.map((point) => point.mrr);
  const cards = [
    { label: "MRR", value: formatMoney(numbers.mrr) },
    { label: "Paying customers", value: String(numbers.customers) },
    { label: "In trial", value: String(numbers.trials) },
    { label: "Churn", value: `${numbers.churnRate}%` },
    { label: "Avg. per account", value: formatMoney(numbers.arpa) },
    { label: "Growth last month", value: `${numbers.growth > 0 ? "+" : ""}${numbers.growth}%` }
  ];
  return (
    <>
      <div className="grid grid-3 kpis">
        {cards.map((card) => (
          <div key={card.label} className="card kpi">
            <p className="muted">{card.label}</p>
            <p className="price">{card.value}</p>
          </div>
        ))}
      </div>
      <div className="card chart-card">
        <p className="muted chart-label">MRR, last {site.history.length} months</p>
        <svg viewBox="0 0 640 200" className="chart" role="img" aria-label="MRR by month">
          <path d={linePath(values, 640, 200, 16)} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <div className="chart-months muted">
          {site.history.map((point) => (
            <span key={point.month}>{point.month}</span>
          ))}
        </div>
      </div>
    </>
  );
}

function Customers({ customers, role, onChange }: { customers: Customer[]; role: Role; onChange: (next: Customer[]) => void }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<Customer["status"] | "all">("all");
  const [sort, setSort] = useState<SortKey>("name");
  const [descending, setDescending] = useState(false);
  const [page, setPage] = useState(1);

  const matching = queryCustomers(customers, { search, status, sort, descending });
  const view = paginate(matching, page, PER_PAGE);
  const editable = can(role, "edit-customers");

  const sortBy = (key: SortKey) => {
    if (key === sort) setDescending(!descending);
    else {
      setSort(key);
      setDescending(key === "mrr");
    }
  };
  const header = (key: SortKey, label: string) => (
    <th>
      <button className="sort" onClick={() => sortBy(key)} aria-sort={sort === key ? (descending ? "descending" : "ascending") : "none"}>
        {label} {sort === key ? (descending ? "↓" : "↑") : ""}
      </button>
    </th>
  );

  return (
    <div className="card">
      <div className="table-tools">
        <input
          className="search"
          type="search"
          placeholder="Search customers"
          aria-label="Search customers"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
        <select
          value={status}
          aria-label="Status"
          onChange={(event) => {
            setStatus(event.target.value as Customer["status"] | "all");
            setPage(1);
          }}
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="trial">Trial</option>
          <option value="churned">Churned</option>
        </select>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {header("name", "Customer")}
              {header("plan", "Plan")}
              {header("mrr", "MRR")}
              {header("joined", "Joined")}
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((customer) => (
              <tr key={customer.id}>
                <td>{customer.name}</td>
                <td>
                  {editable ? (
                    <select
                      aria-label={`Plan for ${customer.name}`}
                      value={customer.plan}
                      onChange={(event) => {
                        const plan = event.target.value as Customer["plan"];
                        const price = site.plans.find((entry) => entry.name === plan)?.price ?? customer.mrr;
                        onChange(customers.map((entry) => (entry.id === customer.id ? { ...entry, plan, mrr: price } : entry)));
                      }}
                    >
                      {site.plans.map((entry) => (
                        <option key={entry.name}>{entry.name}</option>
                      ))}
                    </select>
                  ) : (
                    customer.plan
                  )}
                </td>
                <td>{formatMoney(customer.mrr)}</td>
                <td>{customer.joined}</td>
                <td>
                  <span className={`status status-${customer.status}`}>{customer.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pager">
        <span className="muted">
          {matching.length} customer{matching.length === 1 ? "" : "s"} · page {view.page} of {view.pages}
        </span>
        <div className="btn-row">
          <button className="btn btn-ghost btn-small" disabled={view.page <= 1} onClick={() => setPage(view.page - 1)}>
            Previous
          </button>
          <button className="btn btn-ghost btn-small" disabled={view.page >= view.pages} onClick={() => setPage(view.page + 1)}>
            Next
          </button>
        </div>
      </div>
      {!editable ? <p className="muted note">Your role can view customers but not change them.</p> : null}
    </div>
  );
}

function Team({ role, team, onChange }: { role: Role; team: Member[]; onChange: (next: Member[]) => void }) {
  const [problem, setProblem] = useState<string | null>(null);
  const manage = can(role, "manage-team");
  return (
    <div className="card">
      {problem ? (
        <div className="notice notice-bad" role="alert">
          {problem}
        </div>
      ) : null}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            {team.map((member) => (
              <tr key={member.email}>
                <td>{member.name}</td>
                <td>{member.email}</td>
                <td>
                  {manage ? (
                    <select
                      aria-label={`Role for ${member.name}`}
                      value={member.role}
                      onChange={(event) => {
                        try {
                          onChange(changeRole(team, member.email, event.target.value as Role));
                          setProblem(null);
                        } catch (error) {
                          setProblem(error instanceof Error ? error.message : String(error));
                        }
                      }}
                    >
                      {(["owner", "admin", "member", "viewer"] as Role[]).map((option) => (
                        <option key={option}>{option}</option>
                      ))}
                    </select>
                  ) : (
                    member.role
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!manage ? <p className="muted note">Only owners and admins can change roles.</p> : null}
    </div>
  );
}

function Billing({ role }: { role: Role }) {
  const current = site.plans[1];
  return (
    <div className="grid grid-2">
      <div className="card">
        <p className="muted">Current plan</p>
        <h3>{current.name}</h3>
        <p className="price">
          {formatMoney(current.price)}
          <span className="muted per-month"> /month</span>
        </p>
        <p className="muted">Renews on the 1st. Invoices go to the account owner.</p>
      </div>
      <div className="card">
        <p className="muted">Change plan</p>
        {can(role, "manage-billing") ? (
          <div className="btn-row">
            {site.plans.map((plan) => (
              <button key={plan.name} className={`btn btn-small ${plan.name === current.name ? "" : "btn-ghost"}`}>
                {plan.name}
              </button>
            ))}
          </div>
        ) : (
          <p className="muted note">Only the account owner can change the plan.</p>
        )}
      </div>
    </div>
  );
}

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "customers", label: "Customers" },
  { id: "billing", label: "Billing" },
  { id: "team", label: "Team" }
];

export default function App() {
  const route = useHashRoute();
  const [session, setSession] = usePersistentState<string | null>("session", null);
  const [customers, setCustomers] = usePersistentState<Customer[]>("customers", site.customers);
  const [team, setTeam] = usePersistentState<Member[]>("team", site.team);

  const user = site.demoAccounts.find((account) => account.email === session) ?? null;
  // The team page can change the signed-in person's role, so read it from there.
  const role: Role = team.find((member) => member.email === session)?.role ?? user?.role ?? "viewer";
  const [, area, sectionId] = route.split("/");

  const signIn = (email: string) => {
    setSession(email);
    window.location.hash = "#/app/overview";
  };

  if (area === "app" && user) {
    const section = SECTIONS.find((entry) => entry.id === sectionId) ?? SECTIONS[0];
    return (
      <div className="site app-shell" style={brandStyle(site.brand)}>
        <DemoBanner show={site.demo} label="SaaS Dashboard" />
        <div className="app-layout">
          <aside className="sidebar">
            <a href="#/" className="brand">
              <span className="brand-mark" aria-hidden="true">
                {site.business.name.slice(0, 1)}
              </span>
              {site.business.name}
            </a>
            <nav aria-label="Dashboard">
              {SECTIONS.map((entry) => (
                <a key={entry.id} href={`#/app/${entry.id}`} className={entry.id === section.id ? "active" : ""}>
                  {entry.label}
                </a>
              ))}
            </nav>
            <div className="who">
              <strong>{user.name}</strong>
              <span className="chip">{role}</span>
              <button
                className="btn btn-ghost btn-small"
                onClick={() => {
                  setSession(null);
                  window.location.hash = "#/";
                }}
              >
                Sign out
              </button>
            </div>
          </aside>
          <main className="app-main">
            <h1 className="app-title">{section.label}</h1>
            {section.id === "overview" ? <Overview customers={customers} /> : null}
            {section.id === "customers" ? <Customers customers={customers} role={role} onChange={setCustomers} /> : null}
            {section.id === "billing" ? <Billing role={role} /> : null}
            {section.id === "team" ? <Team role={role} team={team} onChange={setTeam} /> : null}
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="site" style={brandStyle(site.brand)}>
      <DemoBanner show={site.demo} label="SaaS Dashboard" />
      <Header business={site.business} nav={site.nav} cta={{ label: user ? "Open dashboard" : "Sign in", href: user ? "#/app/overview" : "#/login" }} />
      <main>{area === "login" || area === "app" ? <Login onSignIn={signIn} /> : <Landing />}</main>
      <Footer business={site.business} />
    </div>
  );
}
