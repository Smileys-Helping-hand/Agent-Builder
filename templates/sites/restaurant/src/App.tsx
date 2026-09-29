import { useState } from "react";

import { site } from "./content";
import { DemoBanner, Footer, Header, Section, SmartForm, WhatsAppButton, brandStyle, formatMoney, useHashRoute } from "./lib/site";
import { checkReservation, filterMenu, tableFromRoute, type Diet, type MenuSection } from "./menu";

const DIETS: { id: Diet; label: string }[] = [
  { id: "vegetarian", label: "Vegetarian" },
  { id: "vegan", label: "Vegan" },
  { id: "gluten-free", label: "Gluten-free" },
  { id: "spicy", label: "Spicy" }
];

function Menu({ menu }: { menu: MenuSection[] }) {
  const [needs, setNeeds] = useState<Diet[]>([]);
  const shown = filterMenu(menu, needs);
  const toggle = (diet: Diet) => setNeeds(needs.includes(diet) ? needs.filter((entry) => entry !== diet) : [...needs, diet]);

  return (
    <>
      <div className="chip-row diet-filter" role="group" aria-label="Dietary needs">
        {DIETS.map((diet) => (
          <button
            key={diet.id}
            className={`diet ${needs.includes(diet.id) ? "diet-on" : ""}`}
            aria-pressed={needs.includes(diet.id)}
            onClick={() => toggle(diet.id)}
          >
            {diet.label}
          </button>
        ))}
      </div>
      {shown.length === 0 ? <p className="muted">Nothing on the menu meets all of those — ask your server, we can often adapt a dish.</p> : null}
      <div className="menu-sections">
        {shown.map((section) => (
          <div key={section.title} className="menu-section">
            <h3>{section.title}</h3>
            {section.note ? <p className="muted menu-note">{section.note}</p> : null}
            {section.dishes.map((dish) => (
              <div key={dish.name} className="dish">
                <div className="dish-head">
                  <strong>
                    {dish.name}
                    {dish.badge ? <span className="chip dish-badge">{dish.badge}</span> : null}
                  </strong>
                  <span className="dish-dots" aria-hidden="true" />
                  <strong>{formatMoney(dish.price)}</strong>
                </div>
                <p className="muted dish-text">
                  {dish.description}
                  {dish.diet?.length ? <span className="dish-diet"> · {dish.diet.join(", ")}</span> : null}
                </p>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

function Reservation() {
  const [request, setRequest] = useState({ date: "", time: site.reservations.times[0], party: 2 });
  const [confirmed, setConfirmed] = useState(false);
  const problems = request.date ? checkReservation(request, site.reservations) : [];
  const ready = Boolean(request.date) && problems.length === 0;
  const summary = `Table for ${request.party} on ${request.date} at ${request.time}`;

  return (
    <div className="card reservation">
      <div className="form">
        <label className="field">
          <span>Date *</span>
          <input type="date" value={request.date} onChange={(event) => setRequest({ ...request, date: event.target.value })} />
        </label>
        <label className="field">
          <span>Time *</span>
          <select value={request.time} onChange={(event) => setRequest({ ...request, time: event.target.value })}>
            {site.reservations.times.map((time) => (
              <option key={time}>{time}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Guests *</span>
          <input
            type="number"
            min={site.reservations.minParty}
            max={site.reservations.maxParty}
            value={request.party}
            onChange={(event) => setRequest({ ...request, party: Number(event.target.value) })}
          />
        </label>
      </div>
      {problems.length > 0 ? (
        <div className="notice notice-bad" role="alert" style={{ marginTop: 16 }}>
          {problems.map((problem) => (
            <p key={problem}>{problem}</p>
          ))}
        </div>
      ) : null}
      {ready && !confirmed ? <p className="notice notice-ok" style={{ marginTop: 16 }}>{summary} — add your details to request it.</p> : null}
      {ready ? (
        <div style={{ marginTop: 16 }}>
          <SmartForm
            subject={`Reservation request — ${summary}`}
            settings={site.forms}
            fallbackEmail={site.business.email}
            submitLabel="Request this table"
            successMessage={`Thank you. ${summary} is requested — we will confirm by email or phone.`}
            extra={summary}
            onSubmitted={() => setConfirmed(true)}
            fields={[
              { name: "name", label: "Name", required: true },
              { name: "phone", label: "Phone", type: "tel", required: true },
              { name: "email", label: "Email", type: "email" },
              { name: "notes", label: "Occasion or dietary needs", type: "textarea" }
            ]}
          />
        </div>
      ) : null}
    </div>
  );
}

export default function App() {
  const route = useHashRoute();
  const table = tableFromRoute(route);
  const { business, hero } = site;

  // Scanned from a QR code on a table: just the menu, nothing to book.
  if (table) {
    return (
      <div className="site" style={brandStyle(site.brand)}>
        <DemoBanner show={site.demo} label="Restaurant / Hospitality" />
        <main>
          <Section eyebrow={`${business.name} · Table ${table}`} title="Menu" intro="Let your server know about any allergies.">
            <Menu menu={site.menu} />
          </Section>
        </main>
      </div>
    );
  }

  const mapUrl = business.address ? `https://maps.google.com/maps?q=${encodeURIComponent(business.address)}&output=embed` : null;

  return (
    <div className="site" style={brandStyle(site.brand)}>
      <DemoBanner show={site.demo} label="Restaurant / Hospitality" />
      <Header business={business} nav={site.nav} cta={{ label: "Book a table", href: "#book" }} />

      <main>
        <section className="hero restaurant-hero">
          <div className="container">
            <p className="eyebrow">{hero.eyebrow}</p>
            <h1>{hero.title}</h1>
            <p className="lead muted">{hero.subtitle}</p>
            <div className="btn-row">
              <a className="btn" href="#book">
                Book a table
              </a>
              <a className="btn btn-ghost" href="#menu">
                See the menu
              </a>
            </div>
          </div>
        </section>

        <Section id="menu" eyebrow="Menu" title="Tonight's menu" intro="Filter for what you can eat — the menu changes with the catch.">
          <Menu menu={site.menu} />
        </Section>

        <Section id="gallery" eyebrow="Gallery" title="A look inside" tone="tinted">
          <div className="grid grid-3">
            {site.gallery.map((item) => (
              <figure key={item.caption} className="gallery-item">
                <div className="gallery-art" aria-hidden="true">
                  {item.emoji}
                </div>
                <figcaption className="muted">{item.caption}</figcaption>
              </figure>
            ))}
          </div>
        </Section>

        <Section id="book" eyebrow="Reservations" title="Book a table">
          <Reservation />
        </Section>

        <Section id="visit" eyebrow="Visit" title="Find us" tone="tinted">
          <div className="grid grid-2">
            <div>
              <p className="lead">{business.address}</p>
              {business.hours?.map((row) => (
                <p key={row.days} className="hours-row">
                  <span>{row.days}</span>
                  <span className="muted">{row.time}</span>
                </p>
              ))}
            </div>
            {mapUrl ? <iframe className="map-frame" title={`Map to ${business.name}`} src={mapUrl} loading="lazy" /> : null}
          </div>
        </Section>
      </main>

      <Footer business={business} />
      <WhatsAppButton number={business.whatsapp} message={`Hi ${business.name}, I'd like to book a table.`} />
    </div>
  );
}
