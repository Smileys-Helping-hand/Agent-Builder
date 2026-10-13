import { useState } from "react";

import { site } from "./content";
import { photos } from "./photos";
import { estimate } from "./savings";
import { CountUp, Marquee, Photo, ScrollProgress, SplitHeadline, Tilt } from "./lib/pro";
import { DemoBanner, Footer, Header, Section, SmartForm, WhatsAppButton, brandStyle, formatMoney } from "./lib/site";

/** A photograph for each service, in order; any past the last reuse the hero. */
const servicePhotos = [photos.rooftop, photos.battery, photos.living, photos.install];

function Estimator() {
  const [bill, setBill] = useState(3200);
  const result = estimate(bill, site.pricing, site.estimator);
  return (
    <div className="estimator glass">
      <label className="estimator-input">
        <span className="muted">Your monthly electricity bill</span>
        <strong className="estimator-bill">{formatMoney(bill)}</strong>
        <input
          type="range"
          min={500}
          max={10000}
          step={100}
          value={bill}
          onChange={(event) => setBill(Number(event.target.value))}
          aria-label="Monthly electricity bill in rand"
        />
      </label>
      {result ? (
        <div className="estimator-result" aria-live="polite">
          <div>
            <span className="muted">Best fit</span>
            <strong>{result.plan.name}</strong>
            <span className="muted">{formatMoney(result.plan.price)} installed</span>
          </div>
          <div>
            <span className="muted">Could save</span>
            <strong className="text-gradient">{formatMoney(result.monthlySaving)}</strong>
            <span className="muted">a month</span>
          </div>
          <div>
            <span className="muted">Pays for itself in</span>
            <strong>{result.paybackYears === null ? "—" : `${result.paybackYears} yrs`}</strong>
            <span className="muted">{result.paybackYears === null ? "mostly backup" : "at today's tariff"}</span>
          </div>
        </div>
      ) : null}
      <a className="btn" href="#contact">
        Confirm my numbers
      </a>
    </div>
  );
}

export default function App() {
  const { business, hero } = site;
  return (
    <div className="site" style={brandStyle(site.brand)}>
      <ScrollProgress />
      <DemoBanner show={site.demo} label="Business Landing Page" />
      <Header business={business} nav={site.nav} cta={{ label: "Free quote", href: "#contact" }} />

      <main>
        <section className="hero-cover">
          <Photo src={hero.image || photos.hero} alt={`A home with ${business.name} solar panels`} ratio="auto" eager />
          <div className="container hero-cover-inner">
            <p className="eyebrow">{hero.eyebrow}</p>
            <SplitHeadline text={hero.title} className="hero-title" />
            <p className="lead">{hero.subtitle}</p>
            <div className="btn-row">
              <a className="btn" href={hero.primaryCta.href}>
                {hero.primaryCta.label}
              </a>
              <a className="btn btn-ghost btn-on-photo" href={hero.secondaryCta.href}>
                {hero.secondaryCta.label}
              </a>
            </div>
          </div>
        </section>

        <div className="container">
          <div className="stat-ribbon stat-overlap">
            {site.stats.map((stat) => (
              <div key={stat.label}>
                <strong>
                  <CountUp value={stat.value} />
                </strong>
                <span className="muted">{stat.label}</span>
              </div>
            ))}
          </div>
        </div>

        <Section id="services" eyebrow="What we do" title="Everything you need, from one team">
          <div className="grid grid-4 reveal stagger">
            {site.services.map((service, i) => (
              <article key={service.title} className="card photo-card spotlight lift">
                <Photo src={servicePhotos[i] ?? photos.hero} alt={service.title} ratio="4 / 3" className="zoom" />
                <div className="photo-card-body">
                  <h3>
                    <span aria-hidden="true">{service.icon}</span> {service.title}
                  </h3>
                  <p className="muted">{service.text}</p>
                </div>
              </article>
            ))}
          </div>
        </Section>

        {site.estimator.show ? (
        <Section id="savings" eyebrow="Your numbers" title={site.estimator.title} intro={site.estimator.intro} tone="tinted">
          <div className="estimator-grid">
            <Estimator />
            <Tilt className="estimator-photo">
              <Photo src={photos.living} alt="A home with its lights on during load-shedding" ratio="4 / 5" />
            </Tilt>
          </div>
        </Section>
        ) : null}

        <Section id="process" eyebrow="How it works" title="Four steps, no surprises">
          <ol className="timeline reveal stagger">
            {site.process.map((step, index) => (
              <li key={step.title} className="timeline-step">
                <span className="step-number">{index + 1}</span>
                <h3>{step.title}</h3>
                <p className="muted">{step.text}</p>
              </li>
            ))}
          </ol>
        </Section>

        <Section id="pricing" eyebrow="Pricing" title="Fixed prices, installed" intro="Every price includes installation, compliance certificate and a 10-year workmanship warranty." tone="tinted">
          <div className="grid grid-3 reveal stagger">
            {site.pricing.map((plan) => (
              <article key={plan.name} className={`card plan spotlight ${"featured" in plan && plan.featured ? "card-featured plan-featured" : ""}`}>
                <p className="chip">{plan.note}</p>
                <h3>{plan.name}</h3>
                <p className="price">{formatMoney(plan.price)}</p>
                <ul className="tick-list">
                  {plan.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                <a className={`btn ${"featured" in plan && plan.featured ? "" : "btn-ghost"}`} href="#contact" style={{ marginTop: 16 }}>
                  Ask about {plan.name}
                </a>
              </article>
            ))}
          </div>
        </Section>

        <Section eyebrow="Reviews" title="What customers say">
          <Marquee seconds={50}>
            {site.testimonials.map((item) => (
              <blockquote key={item.quote} className="card quote quote-card">
                <p>“{item.quote}”</p>
                <footer>
                  {item.name} <span className="muted">· {item.place}</span>
                </footer>
              </blockquote>
            ))}
          </Marquee>
        </Section>

        <Section id="faq" eyebrow="Questions" title="Frequently asked" tone="tinted">
          <div className="faq">
            {site.faq.map((item) => (
              <details key={item.q}>
                <summary>{item.q}</summary>
                <p className="muted">{item.a}</p>
              </details>
            ))}
          </div>
        </Section>

        <Section id="contact" eyebrow="Contact" title={site.contact.title} intro={site.contact.intro}>
          <div className="contact-split">
            <SmartForm
              subject={`Quote request — ${business.name}`}
              settings={site.forms}
              fallbackEmail={business.email}
              submitLabel="Request my quote"
              fields={[
                { name: "name", label: "Your name", required: true },
                { name: "phone", label: "Phone", type: "tel", required: true },
                { name: "email", label: "Email", type: "email" },
                { name: "suburb", label: "Suburb" },
                { name: "interest", label: "Interested in", type: "select", options: site.pricing.map((plan) => plan.name) },
                { name: "message", label: "Anything else?", type: "textarea" }
              ]}
            />
            <Photo src={photos.install} alt="An installer at work on a roof" ratio="3 / 4" className="contact-photo" caption={`Certified installers · ${business.hours?.[0]?.days ?? ""} ${business.hours?.[0]?.time ?? ""}`} />
          </div>
        </Section>
      </main>

      <Footer business={business} />
      <WhatsAppButton number={business.whatsapp} message={`Hi ${business.name}, I'd like a quote.`} />
    </div>
  );
}
