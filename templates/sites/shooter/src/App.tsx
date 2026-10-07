import { useCallback, useState } from "react";

import { site } from "./content";
import { GameBoard } from "./play";
import { DemoBanner, Footer, Section, SmartForm, WhatsAppButton, brandStyle, usePersistentState } from "./lib/site";

export default function App() {
  const { business, hero, prize } = site;
  const [best, setBest] = usePersistentState<number>("best-score", 0);
  const [lastScore, setLastScore] = useState<number | null>(null);
  const qualified = best >= prize.threshold;

  const onScore = useCallback(
    (score: number) => {
      setLastScore(score);
      if (score > best) setBest(score);
    },
    [best, setBest]
  );

  return (
    <div className="site arcade-site" style={brandStyle(site.brand)}>
      <DemoBanner show={site.demo} label="Space Shooter Game" />

      <main>
        <section className="hero arcade-hero">
          <div className="container">
            <p className="eyebrow">{hero.eyebrow}</p>
            <h1>{hero.title}</h1>
            <p className="lead muted">{hero.subtitle}</p>
            <p className="muted small">
              by {business.name} · Your best: <b>{best.toLocaleString()}</b>
              {lastScore !== null ? ` · Last game: ${lastScore.toLocaleString()}` : ""}
            </p>
            <GameBoard settings={site.game} accent={site.brand.accent} onScore={onScore} />
          </div>
        </section>

        <Section id="how" eyebrow="How to play" title="Quick to learn, hard to master" tone="tinted">
          <div className="grid grid-4">
            {site.howTo.map((tip) => (
              <article key={tip.title} className="card">
                <h3>{tip.title}</h3>
                <p className="muted">{tip.text}</p>
              </article>
            ))}
          </div>
        </Section>

        <Section id="prize" eyebrow="The prize" title={prize.title} intro={prize.text}>
          {qualified ? (
            <div className="card">
              <SmartForm
                subject={`Prize claim: ${business.name} (score ${best})`}
                settings={site.form}
                fallbackEmail={business.email}
                submitLabel={prize.submitLabel}
                successMessage={prize.successMessage}
                extra={`Best score: ${best}`}
                fields={[
                  { name: "name", label: "Your name", required: true },
                  { name: "email", label: "Email for the voucher", type: "email", required: true },
                  { name: "phone", label: "Phone (optional)", type: "tel" }
                ]}
              />
            </div>
          ) : (
            <div className="card locked">
              <strong>Locked until you score {prize.threshold.toLocaleString()}</strong>
              <p className="muted">
                Your best so far is {best.toLocaleString()}. {Math.max(prize.threshold - best, 0).toLocaleString()} to go.
              </p>
            </div>
          )}
        </Section>
      </main>

      <Footer business={business} />
      <WhatsAppButton number={business.whatsapp} message={`Hi ${business.name}, I just played ${hero.title}!`} />
    </div>
  );
}
