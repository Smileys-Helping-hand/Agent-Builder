/**
 * The pieces every template shares: brand colours, header, footer, sections,
 * a contact form that works without a server, and a tiny hash router.
 *
 * Everything a customer would want changed lives in src/content.ts, not here.
 * This file is plumbing; edit it only to change how every page behaves.
 */
import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";

export interface Business {
  name: string;
  tagline: string;
  description: string;
  phone?: string;
  email?: string;
  /** Digits only or with +, e.g. "+27 82 123 4567". Shows a WhatsApp button when set. */
  whatsapp?: string;
  address?: string;
  hours?: { days: string; time: string }[];
  social?: { label: string; url: string }[];
}

export interface Brand {
  primary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  muted: string;
  /** Corner rounding in pixels. */
  radius?: number;
  /** A font already available on the device, or one loaded in index.html. */
  font?: string;
}

export interface NavLink {
  label: string;
  href: string;
}

/**
 * Where form submissions go. With an endpoint (Formspree, a serverless
 * function, anything that accepts a JSON POST) they are sent there; without
 * one the visitor's email app opens with the message filled in, so the form
 * still works on a site with no backend at all.
 */
export interface FormSettings {
  endpoint?: string;
  /** Where the email fallback sends to. Defaults to the business email. */
  to?: string;
}

/** The brand as CSS custom properties, applied to the root element of the page. */
export function brandStyle(brand: Brand): CSSProperties {
  return {
    "--primary": brand.primary,
    "--accent": brand.accent,
    "--bg": brand.background,
    "--surface": brand.surface,
    "--text": brand.text,
    "--muted": brand.muted,
    "--radius": `${brand.radius ?? 14}px`,
    "--font": brand.font ?? "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
  } as CSSProperties;
}

/** Rand amounts the way South Africans write them: R 4 500 or R 4 500.50. */
export function formatMoney(amount: number, symbol = "R"): string {
  const fixed = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  const [whole, cents] = fixed.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${symbol} ${grouped}${cents ? `.${cents}` : ""}`;
}

export function whatsappLink(number: string, message = ""): string {
  const digits = number.replace(/[^\d]/g, "").replace(/^0/, "27");
  return `https://wa.me/${digits}${message ? `?text=${encodeURIComponent(message)}` : ""}`;
}

/**
 * The page a hash names: "#/post/hello" is "/post/hello". Only "#/…" is a
 * page; "#menu" is a link to a section on the current page and returns null,
 * so following it scrolls there instead of changing page.
 */
export function routeFromHash(hash: string): string | null {
  const value = hash.replace(/^#/, "");
  if (!value) return "/";
  return value.startsWith("/") ? value : null;
}

/**
 * The current page, from the address. Hash routes keep working on any static
 * host, under any folder, with no server rewrites to configure.
 */
export function useHashRoute(): string {
  const read = () => (typeof window === "undefined" ? "/" : routeFromHash(window.location.hash) ?? "/");
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => {
      const next = routeFromHash(window.location.hash);
      // A section link on this page: let the browser scroll to it, stay put.
      if (next === null) return;
      setRoute(next);
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

/** A value kept in the browser between visits. Safe to call during tests and server rendering. */
export function usePersistentState<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const stored = window.localStorage.getItem(key);
      return stored ? (JSON.parse(stored) as T) : initial;
    } catch {
      return initial;
    }
  });
  const save = (next: T) => {
    setValue(next);
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Private browsing or storage full: the value still lives for this visit.
    }
  };
  return [value, save];
}

export function Header({ business, nav, cta }: { business: Business; nav: NavLink[]; cta?: NavLink }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      <div className="container header-inner">
        <a href="#/" className="brand" onClick={() => setOpen(false)}>
          <span className="brand-mark" aria-hidden="true">
            {business.name.slice(0, 1)}
          </span>
          {business.name}
        </a>
        <button className="menu-toggle" aria-expanded={open} aria-label="Menu" onClick={() => setOpen(!open)}>
          <span />
          <span />
          <span />
        </button>
        <nav className={`site-nav ${open ? "open" : ""}`} aria-label="Main">
          {nav.map((link) => (
            <a key={link.href} href={link.href} onClick={() => setOpen(false)}>
              {link.label}
            </a>
          ))}
          {cta ? (
            <a className="btn btn-small" href={cta.href} onClick={() => setOpen(false)}>
              {cta.label}
            </a>
          ) : null}
        </nav>
      </div>
    </header>
  );
}

export function Footer({ business }: { business: Business }) {
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div>
          <strong className="footer-name">{business.name}</strong>
          <p className="muted">{business.tagline}</p>
        </div>
        <div>
          <h4>Get in touch</h4>
          {business.phone ? <p><a href={`tel:${business.phone.replace(/\s/g, "")}`}>{business.phone}</a></p> : null}
          {business.email ? <p><a href={`mailto:${business.email}`}>{business.email}</a></p> : null}
          {business.address ? <p className="muted">{business.address}</p> : null}
        </div>
        {business.hours?.length ? (
          <div>
            <h4>Hours</h4>
            {business.hours.map((row) => (
              <p key={row.days} className="hours-row">
                <span>{row.days}</span>
                <span className="muted">{row.time}</span>
              </p>
            ))}
          </div>
        ) : null}
        {business.social?.length ? (
          <div>
            <h4>Follow</h4>
            {business.social.map((link) => (
              <p key={link.url}><a href={link.url} target="_blank" rel="noreferrer">{link.label}</a></p>
            ))}
          </div>
        ) : null}
      </div>
      <div className="container footer-base muted">
        © {year} {business.name}. All rights reserved.
      </div>
    </footer>
  );
}

/**
 * The hero picture: a real photo when content.ts gives one (hero.image), the
 * brand-coloured emoji panel otherwise, so a site never shows a broken image.
 */
export function HeroArt({ art, image, alt }: { art: string; image?: string; alt?: string }) {
  if (image) {
    return <img className="hero-art hero-photo" src={image} alt={alt ?? ""} loading="eager" />;
  }
  return (
    <div className="hero-art" aria-hidden="true">
      {art}
    </div>
  );
}

/**
 * The business described for search engines (schema.org), built from
 * content.ts: name, contact details, address and hours show up in Google's
 * local results. main.tsx puts it in the page head; visitors never see it.
 * "<" is escaped so nothing in the content can close the script tag early.
 */
export function businessSchema(business: Business, type = "LocalBusiness"): string {
  const data = {
    "@context": "https://schema.org",
    "@type": type,
    name: business.name,
    description: business.description,
    telephone: business.phone,
    email: business.email,
    address: business.address,
    openingHours: business.hours?.map((row) => `${row.days} ${row.time}`),
    sameAs: business.social?.map((link) => link.url)
  };
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export function Section({
  id,
  eyebrow,
  title,
  intro,
  children,
  tone
}: {
  id?: string;
  eyebrow?: string;
  title: string;
  intro?: string;
  children: ReactNode;
  tone?: "plain" | "tinted";
}) {
  return (
    <section id={id} className={`section reveal ${tone === "tinted" ? "section-tinted" : ""}`}>
      <div className="container">
        <div className="section-head">
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h2>{title}</h2>
          {intro ? <p className="lead muted">{intro}</p> : null}
        </div>
        {children}
      </div>
    </section>
  );
}

/**
 * Shown while `demo` is true in src/content.ts. The shop's previews run with
 * it on so nobody mistakes the sample businesses, prices and testimonials for
 * real ones; a customer's copy turns it off.
 */
export function DemoBanner({ show, label }: { show?: boolean; label: string }) {
  if (!show) return null;
  return (
    <div className="demo-banner" role="note">
      <strong>Template preview</strong> · {label}. Every name, price and review here is sample content.
    </div>
  );
}

export function WhatsAppButton({ number, message }: { number?: string; message?: string }) {
  if (!number) return null;
  return (
    <a className="whatsapp-float" href={whatsappLink(number, message)} target="_blank" rel="noreferrer" aria-label="Chat on WhatsApp">
      <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7.5-.1 1.5-.6 1.8-1.2.2-.6.2-1.1.1-1.2l-.5-.2Z"
        />
      </svg>
    </a>
  );
}

export interface FieldSpec {
  name: string;
  label: string;
  type?: "text" | "email" | "tel" | "date" | "time" | "number" | "textarea" | "select";
  required?: boolean;
  options?: string[];
  placeholder?: string;
}

/**
 * Turn a filled-in form into the plain text an email or WhatsApp message needs.
 * `extra` is text the page adds that the visitor does not type — an order's
 * contents, a chosen time slot — and goes after the fields.
 */
export function describeSubmission(subject: string, values: Record<string, string>, fields: FieldSpec[], extra?: string): string {
  const lines = fields
    .filter((field) => values[field.name]?.trim())
    .map((field) => `${field.label}: ${values[field.name].trim()}`);
  return `${subject}\n\n${lines.join("\n")}${extra ? `\n\n${extra}` : ""}`;
}

/** A form field people never see; anything in it means a bot filled the form in. */
export const TRAP_FIELD = "website_url";

export const isSpam = (values: Record<string, string>): boolean => Boolean(values[TRAP_FIELD]?.trim());

/** Which required fields are empty, and whether the email address looks like one. */
export function validateSubmission(values: Record<string, string>, fields: FieldSpec[]): string[] {
  const problems: string[] = [];
  for (const field of fields) {
    const value = values[field.name]?.trim() ?? "";
    if (field.required && !value) problems.push(`${field.label} is required.`);
    if (field.type === "email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      problems.push(`${field.label} does not look like an email address.`);
    }
  }
  return problems;
}

export function SmartForm({
  subject,
  fields,
  settings,
  fallbackEmail,
  submitLabel = "Send",
  successMessage = "Thank you — we will be in touch shortly.",
  extra,
  onSubmitted
}: {
  subject: string;
  fields: FieldSpec[];
  settings?: FormSettings;
  fallbackEmail?: string;
  submitLabel?: string;
  successMessage?: string;
  /** Sent with the submission but not typed by the visitor, e.g. the order's contents. */
  extra?: string;
  onSubmitted?: (values: Record<string, string>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [problems, setProblems] = useState<string[]>([]);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    // The trap field is hidden from people; only a bot fills it in. Look
    // successful so it moves on, and send nothing.
    if (isSpam(values)) {
      setState("sent");
      return;
    }
    const found = validateSubmission(values, fields);
    setProblems(found);
    if (found.length > 0) return;

    setState("sending");
    try {
      if (settings?.endpoint) {
        const response = await fetch(settings.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          // Everything the visitor typed except the empty spam trap.
          body: JSON.stringify({
            subject,
            ...Object.fromEntries(Object.entries(values).filter(([name]) => name !== TRAP_FIELD)),
            ...(extra ? { details: extra } : {})
          })
        });
        if (!response.ok) throw new Error(`The form service answered ${response.status}.`);
      } else {
        const to = settings?.to ?? fallbackEmail ?? "";
        const body = describeSubmission(subject, values, fields, extra);
        window.location.href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      }
      setState("sent");
      onSubmitted?.(values);
    } catch {
      setState("failed");
    }
  };

  if (state === "sent") {
    return <div className="notice notice-ok" role="status">{successMessage}</div>;
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      {/* A spam trap: invisible and skipped by keyboard and screen readers. */}
      <label className="trap" aria-hidden="true">
        Leave this empty
        <input
          tabIndex={-1}
          autoComplete="off"
          value={values[TRAP_FIELD] ?? ""}
          onChange={(event) => setValues({ ...values, [TRAP_FIELD]: event.target.value })}
        />
      </label>
      {fields.map((field) => (
        <label key={field.name} className={`field ${field.type === "textarea" ? "field-wide" : ""}`}>
          <span>
            {field.label}
            {field.required ? " *" : ""}
          </span>
          {field.type === "textarea" ? (
            <textarea
              rows={4}
              placeholder={field.placeholder}
              value={values[field.name] ?? ""}
              onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
            />
          ) : field.type === "select" ? (
            <select
              value={values[field.name] ?? ""}
              onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
            >
              <option value="">Choose…</option>
              {(field.options ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={field.type ?? "text"}
              placeholder={field.placeholder}
              value={values[field.name] ?? ""}
              onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
            />
          )}
        </label>
      ))}
      {problems.length > 0 ? (
        <div className="notice notice-bad field-wide" role="alert">
          {problems.map((problem) => (
            <p key={problem}>{problem}</p>
          ))}
        </div>
      ) : null}
      {state === "failed" ? (
        <div className="notice notice-bad field-wide" role="alert">
          That did not go through. Please try again, or contact us directly.
        </div>
      ) : null}
      <button className="btn field-wide" type="submit" disabled={state === "sending"}>
        {state === "sending" ? "Sending…" : submitLabel}
      </button>
    </form>
  );
}
