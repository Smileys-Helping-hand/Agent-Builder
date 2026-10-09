"use client";

/**
 * How the builder works, from the app: models, orders, the ordering site and
 * where projects live. Each change is saved to the PC's .env and applied at
 * once (the few that need a restart say so). Keys and passwords are never shown
 * or changed here.
 */
import { useEffect, useMemo, useState } from "react";

import { api, type BuilderSetting } from "@/lib/api";
import { Banner, Busy, Icon, Skeleton, useRemote, useToast } from "../ui";

const GROUPS: Array<{ id: BuilderSetting["group"]; title: string; hint: string }> = [
  { id: "Models", title: "Models", hint: "Which local models do the work, how they are split between the graphics card and RAM, and how long they stay loaded." },
  { id: "Builds", title: "Builds", hint: "How a new build begins: from your prompt, or from one of our tested games." },
  { id: "Orders", title: "Customer orders", hint: "What happens to orders from the site without you pressing anything." },
  { id: "Site", title: "Ordering site", hint: "Where orders come from and templates are sold." },
  { id: "Projects", title: "Projects", hint: "Where the builder looks for your code." }
];

const CHOICE_WORDS: Record<string, string> = {
  "-1": "Always",
  "5m": "5 min",
  "15m": "15 min",
  "30m": "30 min",
  "1h": "1 hour",
  "4h": "4 hours",
  auto: "Automatic",
  prompt: "Write it from my prompt",
  engine: "Start a game on our tested engine",
  template: "Start a matching game as our whole game",
  q8_0: "q8_0 (half the memory)",
  q4_0: "q4_0 (a quarter)",
  f16: "f16 (full)"
};

export function BuilderSettings() {
  const toast = useToast();
  const remote = useRemote(() => api.builderSettings(), 0);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Start every edit from what the builder has now.
  useEffect(() => {
    if (remote.data) setDraft(Object.fromEntries(remote.data.settings.map((setting) => [setting.name, setting.value])));
  }, [remote.data]);

  const changed = useMemo(() => {
    const current = new Map(remote.data?.settings.map((setting) => [setting.name, setting.value]) ?? []);
    return Object.entries(draft).filter(([name, value]) => current.get(name) !== value);
  }, [draft, remote.data]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.saveBuilderSettings(Object.fromEntries(changed));
      toast(res.message, "ok");
      await remote.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setSaving(false);
    }
  };

  if (remote.loading && !remote.data) return <Skeleton rows={4} />;
  if (remote.error && !remote.data) return <Banner kind="error">{remote.error}</Banner>;
  if (!remote.data) return null;

  const { settings, models, ollama } = remote.data;
  const set = (name: string, value: string) => setDraft((current) => ({ ...current, [name]: value }));

  return (
    <div className="builder-settings">
      {ollama === "down" ? (
        <Banner kind="info">The local model server is off, so the model lists below are empty. Builds start it when they need it.</Banner>
      ) : null}

      {GROUPS.map((group) => {
        const rows = settings.filter((setting) => setting.group === group.id);
        if (rows.length === 0) return null;
        return (
          <div className="card" key={group.id}>
            <h2>{group.title}</h2>
            <p className="hint">{group.hint}</p>
            <div className="setting-rows">
              {rows.map((setting) => {
                const value = draft[setting.name] ?? setting.value;
                const isChanged = value !== setting.value;
                return (
                  <div className={`setting-row ${isChanged ? "changed" : ""}`} key={setting.name}>
                    <div className="setting-text">
                      <strong>{setting.label}</strong>
                      <small>{setting.help}</small>
                      {setting.restart ? <small className="setting-restart">Takes effect after a restart</small> : null}
                      {setting.server ? <small className="setting-restart">Saving restarts the model server (unless a build is using it)</small> : null}
                    </div>
                    <div className="setting-control">
                      {setting.kind === "bool" ? (
                        <button
                          role="switch"
                          aria-checked={value === "true"}
                          aria-label={setting.label}
                          className={`switch ${value === "true" ? "on" : ""}`}
                          onClick={() => set(setting.name, value === "true" ? "false" : "true")}
                        >
                          <span />
                        </button>
                      ) : setting.kind === "model" ? (
                        <select value={value} onChange={(event) => set(setting.name, event.target.value)} aria-label={setting.label}>
                          {(models.includes(value) ? models : [value, ...models]).map((model) => (
                            <option key={model} value={model}>
                              {model}
                              {models.includes(model) ? "" : " (not installed)"}
                            </option>
                          ))}
                        </select>
                      ) : setting.kind === "choice" ? (
                        <select value={value} onChange={(event) => set(setting.name, event.target.value)} aria-label={setting.label}>
                          {setting.choices?.map((choice) => (
                            <option key={choice} value={choice}>
                              {CHOICE_WORDS[choice] ?? choice}
                            </option>
                          ))}
                        </select>
                      ) : setting.kind === "number" ? (
                        <div className="stepper" aria-label={setting.label}>
                          <button
                            className="btn small"
                            disabled={Number(value) <= (setting.min ?? 0)}
                            onClick={() => set(setting.name, String(Number(value) - 1))}
                            aria-label="Fewer"
                          >
                            −
                          </button>
                          <b>{value}</b>
                          <button
                            className="btn small"
                            disabled={Number(value) >= (setting.max ?? 99)}
                            onClick={() => set(setting.name, String(Number(value) + 1))}
                            aria-label="More"
                          >
                            +
                          </button>
                        </div>
                      ) : (
                        <input value={value} onChange={(event) => set(setting.name, event.target.value)} aria-label={setting.label} />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {changed.length ? (
        <div className="save-bar">
          <span>
            {changed.length} change{changed.length === 1 ? "" : "s"} not saved
          </span>
          <div className="btn-row">
            <button className="btn" disabled={saving} onClick={() => setDraft(Object.fromEntries(settings.map((s) => [s.name, s.value])))}>
              Undo
            </button>
            <button className="btn primary" disabled={saving} onClick={save}>
              {saving ? <Busy label="Saving" /> : <>{Icon.check} Save</>}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
