/**
 * "Connect a database": pick a platform, follow its steps, paste its keys into
 * simple boxes, test, save. Saved keys are kept in this browser so the app can
 * be tried on a platform at once; the panel also shows the .env.local lines
 * that make the choice permanent for everyone.
 *
 * <DbStatusBar /> is the small pill that says where data is going and opens
 * this panel. Put it once in the app (Agent Builder does). It is for the app's
 * owner, not its visitors: it shows while developing, and on the live app only
 * when it is opened with ?admin (remembered for that visit). Keys saved here
 * connect that browser; for every visitor they go in .env.local (or the
 * owner's Database panel on their ARP dashboard), which rebuilds the app.
 */
import { useState, type CSSProperties } from "react";

import { clearConfig, complete, envLines, loadConfig, saveConfig } from "./config";
import { makeAdapter } from "./adapters";
import { dbInfo, reconnect } from "./index";
import { PLATFORMS, platform, type PlatformId } from "./platforms";

const box: CSSProperties = { border: "1px solid rgba(128,128,128,.35)", borderRadius: 10, padding: 12, display: "grid", gap: 8 };
const input: CSSProperties = { padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(128,128,128,.45)", font: "inherit", width: "100%", boxSizing: "border-box" };
const code: CSSProperties = { whiteSpace: "pre-wrap", fontSize: 12, background: "rgba(128,128,128,.12)", padding: 10, borderRadius: 8, margin: 0, maxHeight: 220, overflow: "auto" };
const button: CSSProperties = { padding: "8px 14px", borderRadius: 8, border: "1px solid rgba(128,128,128,.45)", background: "transparent", color: "inherit", font: "inherit", cursor: "pointer" };
const primary: CSSProperties = { ...button, background: "#2563eb", borderColor: "#2563eb", color: "#fff" };

/** A key that must never be in a web page: Supabase service_role, or anything that says secret. */
const dangerous = (provider: PlatformId, key: string, value: string): string | null => {
  if (provider === "supabase" && key === "anonKey") {
    try {
      const payload = JSON.parse(atob(value.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      if (payload.role === "service_role") return "That is the service_role key — it bypasses every rule. Use the anon public key.";
    } catch {
      // not a JWT; Supabase's newer sb_publishable_ keys are fine
    }
    if (/^sb_secret_/.test(value)) return "That is a secret key. Use the publishable (anon) key.";
  }
  if (/secret|private|service[_-]?role|sk_live_/i.test(value) && value.length > 20) return "That looks like a secret key. Only public keys belong in a web app.";
  return null;
};

export function DbSetup({ onClose }: { onClose?: () => void }) {
  const current = loadConfig();
  const [provider, setProvider] = useState<PlatformId>(current.provider);
  const [values, setValues] = useState<Record<string, string>>(current.provider === provider ? current.values : {});
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const chosen = platform(provider);
  const warnings = chosen.fields.map((f) => (values[f.key] ? dangerous(provider, f.key, values[f.key]) : null)).filter(Boolean);
  const ready = complete(provider, values) && warnings.length === 0;

  const test = async () => {
    setTesting(true);
    setStatus(null);
    try {
      setStatus({ ok: true, text: await makeAdapter(provider, values).ping() });
    } catch (error) {
      setStatus({ ok: false, text: error instanceof Error ? error.message : String(error) });
    } finally {
      setTesting(false);
    }
  };

  const save = () => {
    if (provider === "local") clearConfig();
    else saveConfig(provider, values);
    reconnect();
    setStatus({ ok: true, text: `Saved. This browser now uses ${chosen.name}.` });
  };

  return (
    <div role="dialog" aria-label="Connect a database" style={{ display: "grid", gap: 14, maxWidth: 640 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <strong style={{ fontSize: 18 }}>Connect a database</strong>
        {onClose ? (
          <button style={button} onClick={onClose} aria-label="Close">
            ✕
          </button>
        ) : null}
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        {PLATFORMS.map((p) => (
          <label key={p.id} style={{ ...box, gridTemplateColumns: "auto 1fr", alignItems: "start", cursor: "pointer", borderColor: p.id === provider ? "#2563eb" : undefined }}>
            <input
              type="radio"
              name="db-platform"
              checked={p.id === provider}
              onChange={() => {
                setProvider(p.id);
                setValues(current.provider === p.id ? current.values : {});
                setStatus(null);
              }}
            />
            <span>
              <strong>{p.name}</strong>
              {p.auth ? " · sign-in" : ""}
              <br />
              <small style={{ opacity: 0.8 }}>{p.pitch}</small>
            </span>
          </label>
        ))}
      </div>

      <div style={box}>
        <strong>1. Set up {chosen.name}</strong>
        <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 4 }}>
          {chosen.steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
        {chosen.snippet ? (
          <>
            <small>{chosen.snippet.label}</small>
            <pre style={code}>{chosen.snippet.code}</pre>
            <button style={button} onClick={() => void navigator.clipboard?.writeText(chosen.snippet!.code)}>
              Copy
            </button>
          </>
        ) : null}
        <a href={chosen.docs} target="_blank" rel="noreferrer">
          {chosen.name} documentation
        </a>
      </div>

      {chosen.fields.length ? (
        <div style={box}>
          <strong>2. Paste its keys</strong>
          {chosen.fields.map((field) => (
            <label key={field.key} style={{ display: "grid", gap: 4 }}>
              <span>
                {field.label}
                {field.optional ? " (optional)" : ""}
              </span>
              <input
                style={input}
                value={values[field.key] ?? ""}
                placeholder={field.placeholder}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setValues((v) => ({ ...v, [field.key]: event.target.value.trim() }))}
              />
              <small style={{ opacity: 0.75 }}>{field.help}</small>
            </label>
          ))}
          {warnings.map((warning, i) => (
            <p key={i} style={{ color: "#dc2626", margin: 0 }}>
              ⚠ {warning}
            </p>
          ))}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button style={button} disabled={testing || !ready} onClick={() => void test()}>
          {testing ? "Testing…" : "Test connection"}
        </button>
        <button style={primary} disabled={!ready} onClick={save}>
          Save &amp; use it
        </button>
      </div>
      {status ? <p style={{ margin: 0, color: status.ok ? "#16a34a" : "#dc2626" }}>{status.text}</p> : null}

      {provider !== "local" && ready ? (
        <div style={box}>
          <strong>Make it permanent</strong>
          <small>Saved keys only apply to this browser. Put these lines in the app's .env.local and rebuild, and every visitor uses {chosen.name}:</small>
          <pre style={code}>{envLines(provider, values)}</pre>
        </div>
      ) : null}
    </div>
  );
}

/** The owner's view: while developing, or on the live app opened with ?admin. */
export function adminMode(): boolean {
  if ((import.meta.env as Record<string, unknown>).DEV) return true;
  try {
    if (/[?&#]admin\b/.test(`${window.location.search}${window.location.hash}`)) sessionStorage.setItem("db-admin", "1");
    return sessionStorage.getItem("db-admin") === "1";
  } catch {
    return false;
  }
}

/** A small pill showing where data is saved; tap it to connect a database. Only the owner sees it (adminMode). */
export function DbStatusBar() {
  const [open, setOpen] = useState(false);
  const [, setTick] = useState(0);
  const [owner] = useState(adminMode);
  const info = dbInfo();
  if (!owner) return null;
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Where this app saves its data"
        style={{
          position: "fixed",
          left: 12,
          bottom: 12,
          zIndex: 50,
          padding: "6px 12px",
          borderRadius: 999,
          border: "1px solid rgba(128,128,128,.4)",
          background: info.browserOnly ? "rgba(234,179,8,.15)" : "rgba(22,163,74,.15)",
          color: "inherit",
          font: "inherit",
          fontSize: 12,
          cursor: "pointer",
          backdropFilter: "blur(6px)"
        }}
      >
        {info.browserOnly ? "● Saved in this browser — connect a database" : `● ${info.name}`}
      </button>
      {open ? (
        <div
          onClick={() => setOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,.55)", display: "grid", placeItems: "center", padding: 16, overflow: "auto" }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: "Canvas", color: "CanvasText", borderRadius: 14, padding: 18, maxHeight: "92vh", overflow: "auto", width: "min(680px, 100%)" }}>
            <DbSetup
              onClose={() => {
                setOpen(false);
                setTick((n) => n + 1);
              }}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
