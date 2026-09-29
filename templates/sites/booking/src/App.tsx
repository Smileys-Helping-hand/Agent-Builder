import { useMemo, useState } from "react";

import { site } from "./content";
import { DemoBanner, Footer, Header, Section, SmartForm, WhatsAppButton, brandStyle, formatMoney, usePersistentState } from "./lib/site";
import { availableSlots, describeDate, openDays, type Booking } from "./slots";

export default function App() {
  const { business, hero } = site;
  const [serviceId, setServiceId] = useState(site.services[0].id);
  const days = useMemo(() => openDays(site.openingHours, site.bookingWindowDays), []);
  const [date, setDate] = useState(days[0] ?? "");
  const [time, setTime] = useState<string | null>(null);
  // Bookings made from this browser, so a slot just taken is not offered again.
  // A real calendar would come from the booking endpoint instead.
  const [booked, setBooked] = usePersistentState<Booking[]>("bookings", []);

  const service = site.services.find((entry) => entry.id === serviceId) ?? site.services[0];
  const slots = availableSlots({
    date,
    minutes: service.minutes,
    hours: site.openingHours,
    bookings: booked,
    leadMinutes: site.leadMinutes
  });

  const summary = time ? `${service.name} (${service.minutes} min, ${formatMoney(service.price)}) on ${describeDate(date)} at ${time}` : "";

  return (
    <div className="site" style={brandStyle(site.brand)}>
      <DemoBanner show={site.demo} label="Booking & Scheduling" />
      <Header business={business} nav={site.nav} cta={{ label: "Book now", href: "#book" }} />

      <main>
        <section className="hero">
          <div className="container hero-grid">
            <div>
              <p className="eyebrow">{hero.eyebrow}</p>
              <h1>{hero.title}</h1>
              <p className="lead muted">{hero.subtitle}</p>
              <div className="btn-row">
                <a className="btn" href="#book">
                  Book an appointment
                </a>
                <a className="btn btn-ghost" href="#services">
                  See prices
                </a>
              </div>
            </div>
            <div className="hero-art" aria-hidden="true">
              {hero.art}
            </div>
          </div>
        </section>

        <Section id="services" eyebrow="Services" title="What we do, and what it costs">
          <div className="grid grid-3">
            {site.services.map((entry) => (
              <article key={entry.id} className="card">
                <h3>{entry.name}</h3>
                <p className="muted">{entry.description}</p>
                <p className="service-meta">
                  <strong>{formatMoney(entry.price)}</strong>
                  <span className="muted">{entry.minutes} min</span>
                </p>
                <a
                  className="btn btn-small"
                  href="#book"
                  onClick={() => {
                    setServiceId(entry.id);
                    setTime(null);
                  }}
                >
                  Book this
                </a>
              </article>
            ))}
          </div>
        </Section>

        <Section id="team" eyebrow="Team" title="Who you'll see" tone="tinted">
          <div className="grid grid-3">
            {site.team.map((person) => (
              <article key={person.name} className="card team-card">
                <span className="team-face" aria-hidden="true">
                  {person.emoji}
                </span>
                <h3>{person.name}</h3>
                <p className="muted">{person.role}</p>
              </article>
            ))}
          </div>
        </Section>

        <Section id="book" eyebrow="Book" title="Choose a time">
          <div className="booking-steps">
            <div className="card">
              <h3>1. Service</h3>
              <div className="option-list">
                {site.services.map((entry) => (
                  <button
                    key={entry.id}
                    className={`option ${entry.id === serviceId ? "option-on" : ""}`}
                    onClick={() => {
                      setServiceId(entry.id);
                      setTime(null);
                    }}
                  >
                    <span>{entry.name}</span>
                    <span className="muted">
                      {entry.minutes} min · {formatMoney(entry.price)}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="card">
              <h3>2. Day</h3>
              <div className="day-list">
                {days.map((day) => (
                  <button
                    key={day}
                    className={`day ${day === date ? "option-on" : ""}`}
                    onClick={() => {
                      setDate(day);
                      setTime(null);
                    }}
                  >
                    {describeDate(day)}
                  </button>
                ))}
              </div>
              <h3 style={{ marginTop: 20 }}>3. Time</h3>
              {slots.length === 0 ? (
                <p className="muted">Nothing free that day for {service.name.toLowerCase()} — try another day.</p>
              ) : (
                <div className="slot-list">
                  {slots.map((slot) => (
                    <button key={slot} className={`slot ${slot === time ? "option-on" : ""}`} onClick={() => setTime(slot)}>
                      {slot}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <h3>4. Your details</h3>
              {time ? (
                <>
                  <p className="notice notice-ok">{summary}</p>
                  <SmartForm
                    subject={`Booking request — ${service.name}, ${describeDate(date)} ${time}`}
                    settings={site.forms}
                    fallbackEmail={business.email}
                    submitLabel="Confirm booking"
                    successMessage={`Booked: ${summary}. We'll confirm by email shortly.`}
                    extra={`Booking: ${summary}`}
                    onSubmitted={() => setBooked([...booked, { date, time, minutes: service.minutes }])}
                    fields={[
                      { name: "name", label: "Name", required: true },
                      { name: "phone", label: "Phone", type: "tel", required: true },
                      { name: "email", label: "Email", type: "email", required: true },
                      { name: "notes", label: "Anything we should know?", type: "textarea" }
                    ]}
                  />
                </>
              ) : (
                <p className="muted">Pick a time and your details go here.</p>
              )}
            </div>
          </div>
          <ul className="tick-list policies">
            {site.policies.map((policy) => (
              <li key={policy}>{policy}</li>
            ))}
          </ul>
        </Section>
      </main>

      <Footer business={business} />
      <WhatsAppButton number={business.whatsapp} message={`Hi ${business.name}, I'd like to book.`} />
    </div>
  );
}
