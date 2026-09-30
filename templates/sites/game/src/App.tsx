import { useCallback, useEffect, useRef, useState } from "react";

import { site } from "./content";
import { type GameState, launch, movePaddle, newGame, startLevel, step } from "./game";
import { DemoBanner, Footer, Section, SmartForm, WhatsAppButton, brandStyle, usePersistentState } from "./lib/site";

/** The board, drawn from the game state every frame. */
function draw(ctx: CanvasRenderingContext2D, state: GameState) {
  const { width, height, colors } = state.settings;
  ctx.clearRect(0, 0, width, height);

  for (const brick of state.bricks) {
    ctx.fillStyle = colors[brick.hits - 1];
    ctx.shadowColor = colors[brick.hits - 1];
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.roundRect(brick.x, brick.y, brick.w, brick.h, 5);
    ctx.fill();
  }

  ctx.shadowColor = site.brand.accent;
  ctx.shadowBlur = 18;
  ctx.fillStyle = site.brand.accent;
  ctx.beginPath();
  ctx.roundRect(state.paddle.x, state.paddle.y, state.paddle.w, state.paddle.h, 7);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "#ffffff";
  ctx.beginPath();
  ctx.arc(state.ball.x, state.ball.y, state.ball.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

const MESSAGES: Partial<Record<GameState["status"], string>> = {
  ready: "Tap or press Space to launch",
  paused: "Paused — tap or press P to carry on",
  "level-cleared": "Level cleared! Tap for the next one",
  won: "You cleared every level!",
  lost: "Game over"
};

function Game({ onScore }: { onScore: (score: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<GameState | null>(null);
  const [hud, setHud] = useState({ score: 0, lives: site.game.lives, level: 0, status: "ready" as GameState["status"] });

  const sync = useCallback(() => {
    const state = game.current;
    if (state) setHud({ score: state.score, lives: state.lives, level: state.level, status: state.status });
  }, []);

  // One action for tap, click and Space: whatever moves the game on from here.
  const advance = useCallback(() => {
    const state = game.current;
    if (!state) return;
    if (state.status === "ready") launch(state);
    else if (state.status === "playing") state.status = "paused";
    else if (state.status === "paused") state.status = "playing";
    else if (state.status === "level-cleared") startLevel(state, state.level + 1);
    else if (state.status === "won" || state.status === "lost") game.current = newGame(site.game);
    sync();
  }, [sync]);

  useEffect(() => {
    game.current = newGame(site.game);
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const state = game.current!;
      const events = step(state, (now - last) / 1000);
      last = now;
      draw(ctx, state);
      if (events.length) {
        sync();
        if (events.includes("won") || events.includes("lost")) onScore(state.score);
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    const keys = (event: KeyboardEvent) => {
      const state = game.current;
      if (!state) return;
      if (event.key === " " || event.key.toLowerCase() === "p") {
        event.preventDefault();
        advance();
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const shift = event.key === "ArrowLeft" ? -42 : 42;
        movePaddle(state, state.paddle.x + state.paddle.w / 2 + shift);
      }
    };
    window.addEventListener("keydown", keys);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", keys);
    };
  }, [advance, onScore, sync]);

  /** Pointer position on the board, in the board's own pixels whatever size it is shown at. */
  const follow = (clientX: number) => {
    const el = canvas.current;
    const state = game.current;
    if (!el || !state) return;
    const box = el.getBoundingClientRect();
    movePaddle(state, ((clientX - box.left) / box.width) * state.settings.width);
  };

  const message = MESSAGES[hud.status];
  return (
    <div className="arcade">
      <div className="hud" aria-live="polite">
        <span>
          Score <b>{hud.score.toLocaleString()}</b>
        </span>
        <span>
          Level <b>{hud.level + 1}</b> · {site.game.levels[hud.level]?.name}
        </span>
        <span aria-label={`${hud.lives} lives left`}>{"♥".repeat(Math.max(hud.lives, 0)) || "—"}</span>
      </div>
      <div className="board">
        <canvas
          ref={canvas}
          width={site.game.width}
          height={site.game.height}
          onPointerMove={(event) => follow(event.clientX)}
          onPointerDown={(event) => {
            follow(event.clientX);
            if (hud.status !== "playing") advance();
          }}
          aria-label="Game board"
          role="img"
        />
        {message ? (
          <button className="board-message" onClick={advance}>
            <strong>{message}</strong>
            {hud.status === "won" || hud.status === "lost" ? <span>Final score {hud.score.toLocaleString()} · tap to play again</span> : null}
          </button>
        ) : null}
      </div>
      <div className="btn-row game-controls">
        <button className="btn btn-ghost" onClick={advance}>
          {hud.status === "playing" ? "Pause" : hud.status === "paused" ? "Resume" : hud.status === "won" || hud.status === "lost" ? "Play again" : "Launch"}
        </button>
      </div>
    </div>
  );
}

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
      <DemoBanner show={site.demo} label="Arcade Promo Game" />

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
            <Game onScore={onScore} />
          </div>
        </section>

        <Section id="how" eyebrow="How to play" title="Easy to learn, hard to put down" tone="tinted">
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
