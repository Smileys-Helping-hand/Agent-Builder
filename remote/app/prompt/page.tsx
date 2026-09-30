"use client";

/**
 * The prompt builder. A good build starts from a good brief; this walks you
 * through one section at a time, shows how complete it is and what is still
 * missing, can fold in what research has confirmed, and then starts the build
 * and follows it right here.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { api, type BuildProfile, type TopicFinding } from "@/lib/api";
import { isLive, useActivity } from "../activity";
import { BuildProgress, StateBadge } from "../build/parts";
import { Banner, Busy, Header, Icon, NotConnected, useConnected, usePersistentState, useRemote, useToast } from "../ui";

const LIMIT = 8000;

const KINDS = [
  { id: "website", label: "Website", features: ["Contact form", "WhatsApp button", "Services section", "Testimonials", "Gallery", "FAQ", "Map and opening hours"] },
  { id: "web app", label: "Web app", features: ["Sign in", "Dashboard", "Create, edit and delete records", "Search and filters", "CSV export", "Settings page", "Email notifications"] },
  { id: "online store", label: "Online store", features: ["Product catalogue", "Cart", "Checkout", "Order history", "Stock levels", "Discount codes", "Delivery options"] },
  { id: "game", label: "Game", features: ["Keyboard and touch controls", "Score and best score", "Levels that get harder", "Pause and restart", "Sound on/off", "Game over screen"] },
  { id: "dashboard", label: "Dashboard", features: ["Charts", "Date range picker", "KPIs at the top", "Table with sorting", "Filters", "Auto refresh"] },
  { id: "tool", label: "Tool / utility", features: ["Paste or upload input", "Instant result", "Copy result", "Save history locally", "Works offline"] }
] as const;

const STYLES = ["Clean and minimal", "Bold and colourful", "Playful", "Corporate", "Dark mode", "Luxury", "Earthy and warm", "Techy / neon"];
const DATA = ["No accounts needed", "User accounts", "Save in the browser (localStorage)", "Database", "Payments", "Email sending", "Maps", "File uploads"];
const QUALITY = ["Mobile first", "Accessible (keyboard, contrast, labels)", "Fast to load", "Tests for the core logic", "Clear empty and error states", "Works offline"];

interface Draft {
  name: string;
  kind: string;
  goal: string;
  audience: string;
  pages: string[];
  features: string[];
  styles: string[];
  colours: string;
  references: string;
  data: string[];
  quality: string[];
  avoid: string;
  notes: string;
  profile: BuildProfile;
}

const EMPTY: Draft = {
  name: "",
  kind: "website",
  goal: "",
  audience: "",
  pages: [],
  features: [],
  styles: [],
  colours: "",
  references: "",
  data: [],
  quality: ["Mobile first"],
  avoid: "",
  notes: "",
  profile: "balanced"
};

/** What makes a brief complete, in the order worth filling it in. */
const CHECKS: Array<{ id: string; label: string; weight: number; done: (d: Draft) => number }> = [
  { id: "name", label: "Give it a name", weight: 8, done: (d) => (d.name.trim().length >= 3 ? 1 : 0) },
  { id: "goal", label: "Say what it is for", weight: 16, done: (d) => Math.min(1, d.goal.trim().length / 60) },
  { id: "audience", label: "Say who uses it", weight: 10, done: (d) => Math.min(1, d.audience.trim().length / 25) },
  { id: "pages", label: "List the pages or screens", weight: 12, done: (d) => Math.min(1, d.pages.length / 2) },
  { id: "features", label: "Pick at least four features", weight: 22, done: (d) => Math.min(1, d.features.length / 4) },
  { id: "style", label: "Choose a look", weight: 10, done: (d) => (d.styles.length || d.colours.trim() ? 1 : 0) },
  { id: "data", label: "Say what it stores or connects to", weight: 8, done: (d) => (d.data.length ? 1 : 0) },
  { id: "quality", label: "Set the quality bar", weight: 8, done: (d) => Math.min(1, d.quality.length / 2) },
  { id: "avoid", label: "Anything to avoid (optional, helps)", weight: 6, done: (d) => (d.avoid.trim().length >= 8 ? 1 : 0) }
];

const list = (items: string[]) => items.map((item) => `- ${item}`).join("\n");

function compose(draft: Draft, research: TopicFinding[]): string {
  const parts = [
    `Build ${draft.name.trim() || "this project"}: a ${draft.kind}.`,
    draft.goal.trim() && `What it is for:\n${draft.goal.trim()}`,
    draft.audience.trim() && `Who uses it:\n${draft.audience.trim()}`,
    draft.pages.length > 0 && `Pages / screens:\n${list(draft.pages)}`,
    draft.features.length > 0 && `It must have:\n${list(draft.features)}`,
    (draft.styles.length > 0 || draft.colours.trim() || draft.references.trim()) &&
      `Look and feel:\n${list(
        [
          draft.styles.length ? draft.styles.join(", ") : "",
          draft.colours.trim() ? `Colours: ${draft.colours.trim()}` : "",
          draft.references.trim() ? `In the spirit of: ${draft.references.trim()}` : ""
        ].filter(Boolean)
      )}`,
    draft.data.length > 0 && `Data and integrations:\n${list(draft.data)}`,
    draft.quality.length > 0 && `Quality bar:\n${list(draft.quality)}`,
    draft.avoid.trim() && `Do not:\n${draft.avoid.trim()}`,
    research.length > 0 &&
      `What our research confirmed (use where it applies):\n${list(research.map((f) => `${f.claim}${f.sourceUrl ? ` (${f.sourceUrl})` : ""}`))}`,
    draft.notes.trim() && `Also:\n${draft.notes.trim()}`
  ].filter(Boolean) as string[];
  return parts.join("\n\n").slice(0, LIMIT);
}

export default function PromptBuilder() {
  const connected = useConnected();
  const toast = useToast();
  const activity = useActivity();
  const [draft, setDraft] = usePersistentState<Draft>("prompt-draft", EMPTY);
  const [library, setLibrary] = usePersistentState<Array<{ name: string; draft: Draft; savedAt: string }>>("prompt-library", []);
  const [started, setStarted] = usePersistentState<string[]>("prompt-builds", []);
  const [researchId, setResearchId] = usePersistentState<string>("prompt-research", "");
  const [pageInput, setPageInput] = useState("");
  const [featureInput, setFeatureInput] = useState("");
  const [busy, setBusy] = useState(false);
  const topics = useRemote(() => api.topics(), 0);
  const topicDetail = useRemote(() => (researchId ? api.topic(researchId) : Promise.resolve(null)), 0, researchId ? `prompt.research.${researchId}` : undefined);

  // A different topic picked: fetch its findings.
  useEffect(() => {
    void topicDetail.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the chosen topic changes
  }, [researchId]);

  const research = useMemo(() => {
    const findings = topicDetail.data?.findings ?? [];
    // Confirmed first, then the strongest; enough to help, not enough to drown the brief.
    return [...findings]
      .filter((f) => f.status !== "contested")
      .sort((a, b) => Number(b.status === "corroborated") - Number(a.status === "corroborated") || b.confidence - a.confidence)
      .slice(0, 8);
  }, [topicDetail.data]);

  const prompt = useMemo(() => compose(draft, researchId ? research : []), [draft, research, researchId]);
  const scores = CHECKS.map((check) => ({ ...check, value: check.done(draft) }));
  const percent = Math.round(scores.reduce((sum, s) => sum + s.value * s.weight, 0) / scores.reduce((sum, s) => sum + s.weight, 0) * 100);
  const next = scores.find((s) => s.value < 1);
  const kind = KINDS.find((k) => k.id === draft.kind) ?? KINDS[0];
  const ready = draft.name.trim().length >= 3 && percent >= 45;

  if (connected === false) return <NotConnected />;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const toggleIn = (key: "features" | "styles" | "data" | "quality" | "pages", value: string) =>
    setDraft((current) => ({
      ...current,
      [key]: current[key].includes(value) ? current[key].filter((v) => v !== value) : [...current[key], value]
    }));
  const addTo = (key: "features" | "pages", value: string, clear: () => void) => {
    const clean = value.trim();
    if (clean.length < 2 || draft[key].includes(clean)) return;
    set(key, [...draft[key], clean]);
    clear();
  };

  const build = async () => {
    setBusy(true);
    try {
      const { buildId } = await api.startBuild({ projectName: draft.name.trim(), description: prompt, profile: draft.profile, starter: "auto" });
      setStarted((current) => [buildId, ...current.filter((id) => id !== buildId)].slice(0, 8));
      toast("Building. Follow it below or on the Build tab.", "ok");
      await activity.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const name = draft.name.trim() || "Untitled";
    setLibrary((current) => [{ name, draft, savedAt: new Date().toISOString() }, ...current.filter((entry) => entry.name !== name)].slice(0, 30));
    toast(`Saved "${name}".`, "ok");
  };

  const mine = activity.builds.filter((b) => started.includes(b.buildId));

  return (
    <>
      <Header title="Prompt builder" sub={`${percent}% complete${next ? ` · next: ${next.label.toLowerCase()}` : " · ready to build"}`} state={percent >= 80 ? "up" : percent >= 45 ? "busy" : "warn"} />

      <div className="wrap pb-grid">
        <div className="pb-main">
          <section className="hero pb-progress">
            <div className="pb-ring" style={{ ["--p" as string]: percent } as React.CSSProperties}>
              <span>{percent}%</span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="hero-label">Brief strength</div>
              <h2 className="hero-title" style={{ fontSize: 21 }}>
                {percent >= 80 ? "Strong brief. Build it." : percent >= 45 ? "Good enough to build; more detail builds better." : "Keep going"}
              </h2>
              <ol className="pb-checks">
                {scores.map((s) => (
                  <li key={s.id} className={s.value >= 1 ? "done" : s.value > 0 ? "part" : ""}>
                    <i>{s.value >= 1 ? "✓" : ""}</i>
                    {s.label}
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <Step n={1} title="What is it?">
            <label className="field">
              <span>Name</span>
              <input value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Sunrise Bakery website" />
            </label>
            <div className="chips">
              {KINDS.map((k) => (
                <button key={k.id} className={`chip ${draft.kind === k.id ? "accent" : ""}`} onClick={() => set("kind", k.id)}>
                  {k.label}
                </button>
              ))}
            </div>
          </Step>

          <Step n={2} title="What is it for, and who uses it?">
            <label className="field">
              <span>The goal, in a sentence or two</span>
              <textarea rows={3} value={draft.goal} onChange={(e) => set("goal", e.target.value)} placeholder="What should someone be able to do, and what does success look like?" />
            </label>
            <label className="field">
              <span>Who uses it</span>
              <input value={draft.audience} onChange={(e) => set("audience", e.target.value)} placeholder="e.g. Local customers on their phones, ordering for pickup" />
            </label>
          </Step>

          <Step n={3} title="Pages and features">
            <TagInput label="Pages or screens" items={draft.pages} value={pageInput} setValue={setPageInput} onAdd={() => addTo("pages", pageInput, () => setPageInput(""))} onRemove={(v) => toggleIn("pages", v)} placeholder="e.g. Home, Menu, Order, About" />
            <TagInput label="Features" items={draft.features} value={featureInput} setValue={setFeatureInput} onAdd={() => addTo("features", featureInput, () => setFeatureInput(""))} onRemove={(v) => toggleIn("features", v)} placeholder="Type one and press Enter" />
            <small className="pb-hint">Suggestions for a {kind.label.toLowerCase()}:</small>
            <div className="chips">
              {kind.features.map((f) => (
                <button key={f} className={`chip ${draft.features.includes(f) ? "accent" : ""}`} onClick={() => toggleIn("features", f)}>
                  {draft.features.includes(f) ? "✓ " : "+ "}
                  {f}
                </button>
              ))}
            </div>
          </Step>

          <Step n={4} title="Look and feel">
            <div className="chips">
              {STYLES.map((s) => (
                <button key={s} className={`chip ${draft.styles.includes(s) ? "accent" : ""}`} onClick={() => toggleIn("styles", s)}>
                  {s}
                </button>
              ))}
            </div>
            <div className="row" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <label className="field" style={{ flex: 1, minWidth: 180 }}>
                <span>Colours</span>
                <input value={draft.colours} onChange={(e) => set("colours", e.target.value)} placeholder="e.g. warm orange and cream" />
              </label>
              <label className="field" style={{ flex: 1, minWidth: 180 }}>
                <span>Sites you like</span>
                <input value={draft.references} onChange={(e) => set("references", e.target.value)} placeholder="e.g. stripe.com's clarity" />
              </label>
            </div>
          </Step>

          <Step n={5} title="Data, integrations and quality">
            <small className="pb-hint">Stores or connects to</small>
            <div className="chips">
              {DATA.map((s) => (
                <button key={s} className={`chip ${draft.data.includes(s) ? "accent" : ""}`} onClick={() => toggleIn("data", s)}>
                  {s}
                </button>
              ))}
            </div>
            <small className="pb-hint">Quality bar</small>
            <div className="chips">
              {QUALITY.map((s) => (
                <button key={s} className={`chip ${draft.quality.includes(s) ? "accent" : ""}`} onClick={() => toggleIn("quality", s)}>
                  {s}
                </button>
              ))}
            </div>
            <label className="field" style={{ marginTop: 12 }}>
              <span>Do not (optional)</span>
              <input value={draft.avoid} onChange={(e) => set("avoid", e.target.value)} placeholder="e.g. no stock photos of people, no pop-ups" />
            </label>
            <label className="field">
              <span>Anything else</span>
              <textarea rows={2} value={draft.notes} onChange={(e) => set("notes", e.target.value)} />
            </label>
          </Step>

          <Step n={6} title="Use what research learned (optional)">
            <label className="field">
              <span>Research topic</span>
              <select value={researchId} onChange={(e) => setResearchId(e.target.value)}>
                <option value="">None</option>
                {(topics.data?.topics ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title} ({t.corroboratedCount} confirmed)
                  </option>
                ))}
              </select>
            </label>
            {researchId && research.length === 0 && !topicDetail.loading ? <small className="pb-hint">That topic has no usable findings yet.</small> : null}
            {research.length > 0 && researchId ? <small className="pb-hint">{research.length} findings will be added to the brief.</small> : null}
          </Step>
        </div>

        <aside className="pb-side">
          <div className="card pb-preview">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <strong>The prompt</strong>
              <small className={prompt.length > LIMIT * 0.9 ? "pb-warn" : ""}>
                {prompt.length.toLocaleString()} / {LIMIT.toLocaleString()}
              </small>
            </div>
            <pre>{prompt}</pre>
            <div className="chips">
              {(["fast", "balanced", "deep"] as BuildProfile[]).map((p) => (
                <button key={p} className={`chip ${draft.profile === p ? "accent" : ""}`} onClick={() => set("profile", p)}>
                  {p === "fast" ? "Fast" : p === "balanced" ? "Balanced" : "Deep (best)"}
                </button>
              ))}
            </div>
            <button className="power" onClick={build} disabled={busy || !ready}>
              {busy ? <Busy label="Starting…" /> : <>{Icon.sparkle} Build it</>}
            </button>
            {!ready ? <small className="pb-hint">Give it a name and reach 45% to build.</small> : null}
            <div className="btn-row" style={{ marginTop: 10 }}>
              <button
                className="btn small"
                onClick={() => {
                  void navigator.clipboard.writeText(prompt).then(() => toast("Copied.", "ok"));
                }}
              >
                {Icon.copy} Copy
              </button>
              <button className="btn small" onClick={save}>
                {Icon.check} Save
              </button>
              <button className="btn small ghost" onClick={() => setDraft(EMPTY)}>
                Start over
              </button>
            </div>
          </div>

          {mine.length > 0 ? (
            <div className="card">
              <strong>Built from here</strong>
              {mine.map((b) => (
                <div key={b.buildId} className="pb-build">
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                    <span style={{ fontWeight: 650, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.projectName}</span>
                    <StateBadge build={b} />
                  </div>
                  {isLive(b) ? <BuildProgress build={b} compact /> : null}
                  <Link href={`/build/?id=${encodeURIComponent(b.buildId)}`} style={{ color: "var(--accent)", fontSize: 13 }}>
                    Follow the build →
                  </Link>
                </div>
              ))}
            </div>
          ) : null}

          {library.length > 0 ? (
            <div className="card">
              <strong>Saved prompts</strong>
              {library.map((entry) => (
                <div key={entry.name} className="pb-saved">
                  <button className="pb-saved-open" onClick={() => setDraft({ ...EMPTY, ...entry.draft })}>
                    {entry.name}
                  </button>
                  <button className="btn small ghost" aria-label={`Delete ${entry.name}`} onClick={() => setLibrary((current) => current.filter((e) => e.name !== entry.name))}>
                    {Icon.trash}
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {topics.error ? <Banner kind="error">{topics.error}</Banner> : null}
        </aside>
      </div>

      {/* Phones: the prompt sits below every step, so keep the progress and the button in reach. */}
      <div className="pb-float">
        <span className="pb-float-p">{percent}%</span>
        <button className="btn small" onClick={() => document.querySelector(".pb-preview")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
          {Icon.eye} View prompt
        </button>
        <button className="btn small primary" onClick={build} disabled={busy || !ready}>
          {busy ? <Busy label="Starting…" /> : <>{Icon.sparkle} Build it</>}
        </button>
      </div>
    </>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="card pb-step">
      <h2>
        <span className="pb-n">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function TagInput({
  label,
  items,
  value,
  setValue,
  onAdd,
  onRemove,
  placeholder
}: {
  label: string;
  items: string[];
  value: string;
  setValue: (value: string) => void;
  onAdd: () => void;
  onRemove: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="pb-tags">
        {items.map((item) => (
          <button key={item} type="button" className="chip accent" onClick={() => onRemove(item)} title="Remove">
            {item} ×
          </button>
        ))}
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              onAdd();
            }
          }}
          onBlur={onAdd}
          placeholder={placeholder}
        />
      </div>
    </label>
  );
}
