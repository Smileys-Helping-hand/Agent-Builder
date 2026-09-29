import { site } from "./content";
import { DemoBanner, HeroArt, Footer, Header, Section, SmartForm, WhatsAppButton, brandStyle, formatMoney } from "./lib/site";

export default function App() {
  const { business, hero } = site;
  return (
    <div className="site" style={brandStyle(site.brand)}>
      <DemoBanner show={site.demo} label="Business Landing Page" />
      <Header business={business} nav={site.nav} cta={{ label: "Free quote", href: "#contact" }} />

      <main>
        <section className="hero">
          <div className="container hero-grid">
            <div>
              <p className="eyebrow">{hero.eyebrow}</p>
              <h1>{hero.title}</h1>
              <p className="lead muted">{hero.subtitle}</p>
              <div className="btn-row">
                <a className="btn" href={hero.primaryCta.href}>
                  {hero.primaryCta.label}
                </a>
                <a className="btn btn-ghost" href={hero.secondaryCta.href}>
                  {hero.secondaryCta.label}
                </a>
              </div>
            </div>
            <HeroArt art={hero.art} image={hero.image} alt={business.name} />
          </div>
        </section>

        <div className="container">
          <div className="grid grid-4 stats">
            {site.stats.map((stat) => (
              <div key={stat.label} className="card stat">
                <strong className="price">{stat.value}</strong>
                <p className="muted">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>

        <Section id="services" eyebrow="What we do" title="Everything you need, from one team">
          <div className="grid grid-4">
            {site.services.map((service) => (
              <article key={service.title} className="card">
                <div className="card-icon" aria-hidden="true">
                  {service.icon}
                </div>
                <h3>{service.title}</h3>
                <p className="muted">{service.text}</p>
              </article>
            ))}
          </div>
        </Section>

        <Section id="process" eyebrow="How it works" title="Four steps, no surprises" tone="tinted">
          <ol className="grid grid-4 steps">
            {site.process.map((step, index) => (
              <li key={step.title} className="card">
                <span className="step-number">{index + 1}</span>
                <h3>{step.title}</h3>
                <p className="muted">{step.text}</p>
              </li>
            ))}
          </ol>
        </Section>

        <Section id="pricing" eyebrow="Pricing" title="Fixed prices, installed" intro="Every price includes installation, compliance certificate and a 10-year workmanship warranty.">
          <div className="grid grid-3">
            {site.pricing.map((plan) => (
              <article key={plan.name} className={`card ${"featured" in plan && plan.featured ? "card-featured" : ""}`}>
                <p className="chip">{plan.note}</p>
                <h3>{plan.name}</h3>
                <p className="price">{formatMoney(plan.price)}</p>
                <ul className="tick-list">
                  {plan.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                <a className="btn" href="#contact" style={{ marginTop: 16 }}>
                  Ask about {plan.name}
                </a>
              </article>
            ))}
          </div>
        </Section>

        <Section eyebrow="Reviews" title="What customers say" tone="tinted">
          <div className="grid grid-3">
            {site.testimonials.map((item) => (
              <blockquote key={item.quote} className="card quote">
                <p>“{item.quote}”</p>
                <footer>
                  {item.name} <span className="muted">· {item.place}</span>
                </footer>
              </blockquote>
            ))}
          </div>
        </Section>

        <Section id="faq" eyebrow="Questions" title="Frequently asked">
          <div className="faq">
            {site.faq.map((item) => (
              <details key={item.q}>
                <summary>{item.q}</summary>
                <p className="muted">{item.a}</p>
              </details>
            ))}
          </div>
        </Section>

        <Section id="contact" eyebrow="Contact" title={site.contact.title} intro={site.contact.intro} tone="tinted">
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
        </Section>
      </main>

      <Footer business={business} />
      <WhatsAppButton number={business.whatsapp} message={`Hi ${business.name}, I'd like a quote.`} />
    </div>
  );
}
