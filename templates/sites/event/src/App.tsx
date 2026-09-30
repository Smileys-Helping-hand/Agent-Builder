import { useEffect, useState } from "react";

import { site } from "./content";
import { calendarFile, timeUntil } from "./countdown";
import { DemoBanner, Footer, Header, HeroArt, Section, SmartForm, WhatsAppButton, brandStyle } from "./lib/site";

/** Counts down to the start. Rendered as the date alone until the page's code runs. */
function Countdown({ startsAt }: { startsAt: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  if (now === null) return null;
  const left = timeUntil(startsAt, now);
  if (!left) return <p className="countdown-done">Today's the day!</p>;
  return (
    <div className="countdown" aria-label="Time until the event">
      {(
        [
          ["days", left.days],
          ["hours", left.hours],
          ["minutes", left.minutes]
        ] as const
      ).map(([label, value]) => (
        <div key={label}>
          <b>{value}</b>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

function addToCalendar() {
  const ics = calendarFile({
    title: `${site.event.title}`,
    startsAt: site.event.startsAt,
    hours: 8,
    location: `${site.venue.name}, ${site.venue.address}`,
    description: site.business.description
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  link.download = "invitation.ics";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

export default function App() {
  const { business, event, venue, rsvp } = site;
  const map = encodeURIComponent(venue.mapQuery);
  return (
    <div className="site event-site" style={brandStyle(site.brand)}>
      <DemoBanner show={site.demo} label="Event & Invitation" />
      <Header business={business} nav={site.nav} cta={{ label: "RSVP", href: "#rsvp" }} />

      <main>
        <section className="hero event-hero">
          <div className="container hero-grid">
            <div>
              <p className="eyebrow">{event.eyebrow}</p>
              <h1>{event.title}</h1>
              <p className="lead">{business.tagline}</p>
              <p className="event-date">{event.dateText}</p>
              <p className="muted">{venue.name}</p>
              <Countdown startsAt={event.startsAt} />
              <div className="btn-row">
                <a className="btn" href="#rsvp">
                  RSVP by {event.rsvpBy}
                </a>
                <button className="btn btn-ghost" onClick={addToCalendar}>
                  Add to calendar
                </button>
              </div>
            </div>
            <HeroArt art={event.art} alt={event.title} />
          </div>
        </section>

        <Section id="schedule" eyebrow="The day" title="How the day will go" tone="tinted">
          <ol className="timeline">
            {site.schedule.map((item) => (
              <li key={item.time}>
                <time>{item.time}</time>
                <div>
                  <h3>{item.title}</h3>
                  <p className="muted">{item.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </Section>

        <Section id="venue" eyebrow="Where" title={venue.name} intro={venue.address}>
          <div className="grid grid-2 venue">
            <iframe
              title={`Map of ${venue.name}`}
              src={`https://maps.google.com/maps?q=${map}&output=embed`}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
            <div className="card">
              <p>{venue.notes}</p>
              <a className="btn" href={`https://www.google.com/maps/dir/?api=1&destination=${map}`} target="_blank" rel="noreferrer">
                Directions
              </a>
            </div>
          </div>
          <div className="grid grid-3 details">
            {site.details.map((detail) => (
              <article key={detail.title} className="card">
                <h3>{detail.title}</h3>
                <p className="muted">{detail.text}</p>
              </article>
            ))}
          </div>
        </Section>

        <Section id="rsvp" eyebrow="RSVP" title={rsvp.title} intro={rsvp.intro} tone="tinted">
          <div className="card rsvp">
            <SmartForm
              subject={`RSVP: ${event.title}`}
              settings={site.form}
              fallbackEmail={business.email}
              submitLabel={rsvp.submitLabel}
              successMessage={rsvp.successMessage}
              fields={[
                { name: "name", label: "Your name(s)", required: true },
                { name: "email", label: "Email", type: "email", required: true },
                { name: "attending", label: "Will you be there?", type: "select", options: ["Joyfully yes", "Sadly no"], required: true },
                { name: "guests", label: "How many of you?", type: "number" },
                { name: "dietary", label: "Dietary needs or a song request", type: "textarea" }
              ]}
            />
          </div>
        </Section>

        <Section id="faq" eyebrow="Questions" title="Good to know">
          <div className="faq">
            {site.faq.map((item) => (
              <details key={item.q} className="card">
                <summary>{item.q}</summary>
                <p className="muted">{item.a}</p>
              </details>
            ))}
          </div>
        </Section>
      </main>

      <Footer business={business} />
      <WhatsAppButton number={business.whatsapp} message={`Hi ${business.name}! About the invitation:`} />
    </div>
  );
}
