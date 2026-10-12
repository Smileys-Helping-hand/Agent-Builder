/**
 * The signature layer every template shares: the motion, depth and finish
 * that make a site feel made rather than generated.
 *
 *   <Aurora />           a slow, living gradient behind a hero, in the brand's colours
 *   <SplitHeadline />    a headline that arrives word by word
 *   <Tilt>               a card or photo that leans toward the pointer, with a glare
 *   <CountUp value=… />  a statistic that counts up when it scrolls into view
 *   <Marquee>            a band of logos or quotes that drifts sideways
 *   <Photo />            a photograph that fades in once loaded, at a fixed shape
 *   <ScrollProgress />   a thin bar showing how far down the page you are
 *
 * enableSignature() (called once from main.tsx) adds the page-wide touches:
 * the header that condenses into glass once you scroll, and the soft light
 * that follows the pointer across any `.spotlight` card.
 *
 * Everything renders as plain, finished markup first (so tests, search
 * engines and visitors who prefer less motion get the whole page), and only
 * moves when the browser can and the visitor has not asked for less motion.
 */
import { Children, Fragment, useEffect, useRef, useState, type CSSProperties, type ElementType, type ReactNode } from "react";

const prefersLessMotion = (): boolean =>
  typeof window === "undefined" || !window.matchMedia || window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Runs `onVisible` once, the first time the element scrolls into view. */
function useOnceVisible<T extends Element>(onVisible: () => void, rootMargin = "0px 0px -10% 0px") {
  const ref = useRef<T>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return onVisible();
    const watcher = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          watcher.disconnect();
          onVisible();
        }
      },
      { rootMargin }
    );
    watcher.observe(element);
    return () => watcher.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per element
  }, []);
  return ref;
}

/* ---------------- Aurora ---------------- */

const readColour = (name: string, fallback: string): string => {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || getComputedStyle(document.body).getPropertyValue(name).trim();
  return value || fallback;
};

/**
 * Soft blobs of the brand's colours drifting behind the content. Drawn on a
 * small canvas and scaled up (the blur is free that way), paused while off
 * screen, and a single still frame for visitors who prefer less motion.
 */
export function Aurora({ colors, intensity = 0.55, className = "" }: { colors?: string[]; intensity?: number; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    const ctx = element?.getContext("2d");
    if (!element || !ctx) return;
    const palette = colors?.length ? colors : [readColour("--primary", "#6366f1"), readColour("--accent", "#22d3ee"), readColour("--primary", "#a855f7")];
    const blobs = palette.slice(0, 4).map((colour, i) => ({
      colour,
      x: 0.2 + 0.3 * i,
      y: 0.3 + 0.25 * (i % 2),
      r: 0.45 + 0.1 * (i % 3),
      speed: 0.00006 + 0.00003 * i,
      phase: i * 1.7
    }));
    const width = 96;
    const height = 54;
    element.width = width;
    element.height = height;
    let frame = 0;
    let running = true;
    const draw = (time: number) => {
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = "lighter";
      for (const blob of blobs) {
        const x = (blob.x + 0.18 * Math.sin(time * blob.speed + blob.phase)) * width;
        const y = (blob.y + 0.16 * Math.cos(time * blob.speed * 1.3 + blob.phase)) * height;
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, blob.r * width);
        gradient.addColorStop(0, withAlpha(blob.colour, intensity));
        gradient.addColorStop(1, withAlpha(blob.colour, 0));
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
      }
    };
    if (prefersLessMotion()) {
      draw(0);
      return;
    }
    const loop = (time: number) => {
      if (running) draw(time);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    const watcher = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => (running = entry.isIntersecting));
    watcher?.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      watcher?.disconnect();
    };
  }, [colors, intensity]);
  return <canvas ref={canvas} className={`aurora ${className}`} aria-hidden="true" />;
}

/** A CSS colour with an alpha, for hex (#rgb, #rrggbb) and rgb()/hsl() colours. */
export function withAlpha(colour: string, alpha: number): string {
  const hex = colour.trim().replace("#", "");
  if (/^[0-9a-f]{3}$/i.test(hex) || /^[0-9a-f]{6}$/i.test(hex)) {
    const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  const match = /^(rgb|hsl)a?\(([^)]+)\)$/i.exec(colour.trim());
  if (match) {
    const parts = match[2].split(/[,\s/]+/).filter(Boolean).slice(0, 3);
    return `${match[1].toLowerCase()}a(${parts.join(", ")}, ${alpha})`;
  }
  return colour;
}

/* ---------------- SplitHeadline ---------------- */

/** A headline whose words rise into place one after another. Reads as one heading to screen readers. */
export function SplitHeadline({ text, as = "h1", className = "", accentWords = [] }: { text: string; as?: ElementType; className?: string; accentWords?: string[] }) {
  const Tag = as;
  const accents = new Set(accentWords.map((word) => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")));
  const words = text.split(/\s+/).filter(Boolean);
  return (
    <Tag className={`split ${className}`} aria-label={text}>
      {words.map((word, i) => (
        // The space goes between the words, not inside them: inside an inline-block it collapses.
        <Fragment key={`${word}-${i}`}>
          <span className="split-word" aria-hidden="true" style={{ "--i": i } as CSSProperties}>
            <span className={accents.has(word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")) ? "split-inner text-gradient" : "split-inner"}>{word}</span>
          </span>
          {i < words.length - 1 ? " " : null}
        </Fragment>
      ))}
    </Tag>
  );
}

/* ---------------- Tilt ---------------- */

/** Leans toward the pointer in 3D, with a moving glare. Flat on touch screens and for less motion. */
export function Tilt({ children, max = 7, className = "" }: { children: ReactNode; max?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    const element = ref.current;
    if (!element || event.pointerType !== "mouse" || prefersLessMotion()) return;
    const box = element.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width;
    const y = (event.clientY - box.top) / box.height;
    element.style.setProperty("--ry", `${(x - 0.5) * 2 * max}deg`);
    element.style.setProperty("--rx", `${(0.5 - y) * 2 * max}deg`);
    element.style.setProperty("--gx", `${x * 100}%`);
    element.style.setProperty("--gy", `${y * 100}%`);
  };
  const leave = () => {
    ref.current?.style.setProperty("--rx", "0deg");
    ref.current?.style.setProperty("--ry", "0deg");
  };
  return (
    <div ref={ref} className={`tilt ${className}`} onPointerMove={move} onPointerLeave={leave}>
      {children}
      <span className="tilt-glare" aria-hidden="true" />
    </div>
  );
}

/* ---------------- CountUp ---------------- */

/**
 * "1 200+", "4.9★", "R 1,5m", "98%": the number in it, and what comes
 * before and after, so the count keeps the original's look.
 */
export function parseFigure(value: string): { prefix: string; number: number; decimals: number; suffix: string; grouping: string } | null {
  const match = /^(\D*?)(\d[\d\s, ]*(?:\.\d+)?)(.*)$/.exec(value);
  if (!match) return null;
  const raw = match[2].trim();
  const grouping = /\d[\s ]\d/.test(raw) ? " " : /\d,\d{3}/.test(raw) ? "," : "";
  const clean = raw.replace(/[\s ,]/g, "");
  const number = Number(clean);
  if (!Number.isFinite(number)) return null;
  const decimals = clean.includes(".") ? clean.split(".")[1].length : 0;
  return { prefix: match[1], number, decimals, suffix: match[3], grouping };
}

export function formatFigure(figure: NonNullable<ReturnType<typeof parseFigure>>, value: number): string {
  const fixed = value.toFixed(figure.decimals);
  const [whole, part] = fixed.split(".");
  const grouped = figure.grouping ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, figure.grouping) : whole;
  return `${figure.prefix}${grouped}${part ? `.${part}` : ""}${figure.suffix}`;
}

/** Shows `value` as written; counts up to it the first time it scrolls into view. */
export function CountUp({ value, ms = 1400 }: { value: string; ms?: number }) {
  const [shown, setShown] = useState(value);
  const ref = useOnceVisible<HTMLSpanElement>(() => {
    const figure = parseFigure(value);
    if (!figure || prefersLessMotion() || typeof requestAnimationFrame === "undefined") return;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(formatFigure(figure, figure.number * eased));
      if (t < 1) requestAnimationFrame(step);
      else setShown(value);
    };
    requestAnimationFrame(step);
  });
  return (
    <span ref={ref} className="count-up" aria-label={value}>
      <span aria-hidden="true">{shown}</span>
    </span>
  );
}

/* ---------------- Marquee ---------------- */

/** Items drifting sideways in a loop; pauses on hover; a plain row for less motion. */
export function Marquee({ children, seconds = 40, className = "" }: { children: ReactNode; seconds?: number; className?: string }) {
  const items = Children.toArray(children);
  return (
    <div className={`marquee ${className}`} style={{ "--marquee-seconds": `${seconds}s` } as CSSProperties}>
      <div className="marquee-track">
        <div className="marquee-group">{items}</div>
        <div className="marquee-group" aria-hidden="true">
          {items}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Photo ---------------- */

/** A photograph at a fixed shape (no jumping layout), fading in once it has loaded. */
export function Photo({
  src,
  alt,
  ratio = "4 / 3",
  className = "",
  eager = false,
  caption
}: {
  src: string;
  alt: string;
  ratio?: string;
  className?: string;
  eager?: boolean;
  caption?: ReactNode;
}) {
  const [loaded, setLoaded] = useState(false);
  // A picture built into the page (a data: address) is already here: lazy
  // loading saves nothing, and Chrome left such pictures blank below the fold.
  const lazy = !eager && !src.startsWith("data:");
  return (
    <figure className={`photo ${loaded ? "photo-loaded" : ""} ${className}`} style={{ aspectRatio: ratio } as CSSProperties}>
      <img src={src} alt={alt} loading={lazy ? "lazy" : "eager"} decoding="async" onLoad={() => setLoaded(true)} ref={(img) => img?.complete && !loaded && setLoaded(true)} />
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}

/* ---------------- ScrollProgress ---------------- */

export function ScrollProgress() {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const total = document.documentElement.scrollHeight - window.innerHeight;
        bar.current?.style.setProperty("--progress", String(total > 0 ? window.scrollY / total : 0));
      });
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return <div ref={bar} className="scroll-progress" aria-hidden="true" />;
}

/* ---------------- page-wide touches ---------------- */

/**
 * Once per page: the header turns to glass after the first screenful, and
 * `.spotlight` cards catch a soft light where the pointer is. Returns a
 * function that removes both (for tests and the live customiser).
 */
export function enableSignature(): () => void {
  if (typeof window === "undefined") return () => {};
  const root = document.documentElement;
  root.classList.add("signature");
  const onScroll = () => root.classList.toggle("scrolled", window.scrollY > 24);
  const onPointer = (event: PointerEvent) => {
    const card = (event.target as Element | null)?.closest?.(".spotlight") as HTMLElement | null;
    if (!card) return;
    const box = card.getBoundingClientRect();
    card.style.setProperty("--mx", `${event.clientX - box.left}px`);
    card.style.setProperty("--my", `${event.clientY - box.top}px`);
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("pointermove", onPointer, { passive: true });
  return () => {
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("pointermove", onPointer);
    root.classList.remove("signature", "scrolled");
  };
}
