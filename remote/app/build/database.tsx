"use client";

/**
 * A build's database: pick the platform the app will use and paste its keys
 * into simple boxes. The keys are written to the build's .env.local on the PC
 * (and the site rebuilt so the preview uses them); they are never sent back
 * here — the boxes only show which are saved. Agent Builder never holds the
 * app's data: it lives on the person's own platform.
 */
import { useEffect, useState } from "react";

import { api, type BuildDbState, type DbPlatform } from "@/lib/api";
import { Busy, useRemote, useToast } from "../ui";

export function BuildDatabase({ buildId, live }: { buildId: string; live: boolean }) {
  const toast = useToast();
  const data = useRemote(() => api.buildDatabase(buildId), 0, `build-db.${buildId}`);
  const [platform, setPlatform] = useState<string>("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const state: BuildDbState | null = data.data?.state ?? null;
  const platforms: DbPlatform[] = data.data?.platforms ?? [];

  useEffect(() => {
    if (state?.platform && !platform) setPlatform(state.platform);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.platform]);

  if (!data.data) return data.error ? null : <Busy label="Checking its database…" />;
  const chosen = platforms.find((p) => p.id === (platform || state?.platform || "local"));
  const samePlatform = chosen?.id === state?.platform;

  const save = async () => {
    if (!chosen) return;
    setBusy("save");
    setResult(null);
    try {
      const res = await api.saveBuildDatabase(buildId, chosen.id, values);
      setValues({});
      await data.refresh();
      setResult({ ok: true, text: [res.note, res.rebuilt?.detail ?? "Saved."].filter(Boolean).join(" ") });
      toast(`Database set to ${chosen.name}.`, "ok");
    } catch (error) {
      setResult({ ok: false, text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    if (!chosen) return;
    setBusy("test");
    setResult(null);
    try {
      const res = await api.testBuildDatabase(buildId, chosen.id, values);
      setResult({ ok: res.ok, text: res.detail });
    } catch (error) {
      setResult({ ok: false, text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="section-title">Database</div>
      <div className="card db-panel">
        <p className="muted small" style={{ marginTop: 0 }}>
          {state?.installed
            ? `This app keeps its data through src/lib/db, set up for ${platforms.find((p) => p.id === state.platform)?.name ?? "this browser"}.`
            : "This app has no data layer yet. Choose where it will save data and it gets one (continue the build afterwards so it uses it)."}{" "}
          Your keys stay on this PC in the build's .env.local; the app also has its own "Connect a database" panel.
        </p>
        <div className="chips">
          {platforms.map((p) => (
            <button
              key={p.id}
              className={`chip ${(platform || state?.platform) === p.id ? "accent" : ""}`}
              title={p.pitch}
              onClick={() => {
                setPlatform(p.id);
                setValues({});
                setResult(null);
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
        {chosen ? <p className="small" style={{ margin: "8px 0" }}>{chosen.pitch}{chosen.auth ? " Includes sign-in." : ""}</p> : null}

        {chosen?.fields.length ? (
          <div className="db-fields">
            {chosen.fields.map((field) => {
              const saved = samePlatform && state?.set.includes(field.key);
              return (
                <label key={field.key} className="field">
                  <span>
                    {field.label}
                    {field.optional ? " (optional)" : ""} {saved ? <span className="tag ok">saved</span> : null}
                  </span>
                  <input
                    value={values[field.key] ?? ""}
                    placeholder={saved ? "•••••• saved — type to replace" : field.env}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => setValues((v) => ({ ...v, [field.key]: event.target.value }))}
                  />
                </label>
              );
            })}
            <small className="muted">Only public keys (Supabase: the anon key, never service_role). The setup steps for each platform are in the app's panel and in DATABASE.md.</small>
          </div>
        ) : null}

        <div className="btn-row" style={{ marginTop: 10 }}>
          {chosen && chosen.id !== "local" ? (
            <button className="btn small" disabled={busy !== null} onClick={() => void test()}>
              {busy === "test" ? <Busy label="Testing…" /> : "Test connection"}
            </button>
          ) : null}
          <button className="btn small primary" disabled={busy !== null || live || !chosen} onClick={() => void save()} title={live ? "Wait for the pass to finish" : undefined}>
            {busy === "save" ? <Busy label="Saving and rebuilding…" /> : "Save"}
          </button>
        </div>
        {result ? <p className={`small ${result.ok ? "ok-text" : "bad-text"}`}>{result.text}</p> : null}
      </div>
    </>
  );
}
