"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { api, type BuildProfile, type HeadStart, type StarterChoice } from "@/lib/api";
import { isLive, useActivity } from "../activity";
import { Banner, Busy, Freshness, Header, Icon, NotConnected, Skeleton, useConnected, usePersistentState, useToast } from "../ui";
import { BuildDetail } from "./detail";
import { BuildCard, groupBuilds, needsLook, works } from "./parts";

const PROFILES: Array<{ id: BuildProfile; label: string; hint: string }> = [
  { id: "fast", label: "Fast", hint: "Up to 8 passes, one repair each. Good for a rough first look." },
  { id: "balanced", label: "Balanced", hint: "Up to 25 passes, three repairs each. Start here." },
  { id: "deep", label: "Deep", hint: "Up to 60 passes, five repairs each, and a bigger model reviews every fix. Slowest, best." }
];

const EXAMPLES = [
  { name: "Café landing page", description: "A one-page site for a coffee shop: hero, menu, opening hours, map and a contact form." },
  { name: "Invoice tracker", description: "A small web app to record invoices, mark them paid, and show what is overdue." },
  { name: "Booking form", description: "A booking page that takes a name, date and service, and emails the owner." },
  {
    name: "Browser game",
    description:
      "A browser Snake game drawn on a canvas: arrow keys and on-screen buttons for phones, the snake grows when it eats and speeds up every 5 points, a best score saved in localStorage, pause with Space, and a game-over screen with restart. Keep the game rules in a separate module with tests."
  }
];

/** Where a new build starts: see StarterChoice on the builder. */
const STARTERS: Array<{ id: StarterChoice; label: string; hint: string }> = [
  { id: "auto", label: "Auto", hint: "A working React app for anything that runs in a browser; an empty folder for Python, bots, servers and the like." },
  { id: "web", label: "Starter app", hint: "Always start from the working React + TypeScript app. Fastest route to something that builds and passes its checks." },
  { id: "none", label: "Empty folder", hint: "Let the model choose everything, from the language up. Slower, and more likely to need repairs." }
];

/** How a new build begins; "settings" leaves it to Settings → Builds. */
const HEAD_STARTS: Array<{ id: HeadStart | "settings"; label: string; hint: string }> = [
  { id: "settings", label: "As in Settings", hint: "Whatever Settings → Builds says (written from the prompt, unless you changed it)." },
  { id: "prompt", label: "From my prompt", hint: "Planned and written from your words, file by file. Our games are shown to the model as examples, never copied in. Games still get pictures drawn for them." },
  { id: "engine", label: "Our engine", hint: "A game close to one of ours starts with its tested rules (game.ts); the screens are written from your prompt." },
  { id: "template", label: "Our whole game", hint: "A game that clearly matches one of ours starts as that whole working game, then is tailored to your prompt." }
];

/** Apps made from the same build once it passes (see AppBuilder on the builder). */
const APPS: Array<{ id: "android" | "windows"; label: string }> = [
  { id: "android", label: "Android app (.apk)" },
  { id: "windows", label: "Windows app (.exe)" }
];

type Filter = "all" | "live" | "works" | "look";

/**
 * The open build lives in the address (?id=…), so refreshing, going back, or
 * sharing the link lands on the same build. Read from window rather than
 * useSearchParams, which a static export would need a Suspense boundary for.
 */
const useOpenBuild = (): [string | null, (id: string | null) => void] => {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setId(new URLSearchParams(window.location.search).get("id"));
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);
  const go = useCallback((next: string | null) => {
    const url = next ? `${window.location.pathname}?id=${encodeURIComponent(next)}` : window.location.pathname;
    window.history.pushState({}, "", url);
    setId(next);
    window.scrollTo({ top: 0 });
  }, []);
  return [id, go];
};

export default function BuildPage() {
  const connected = useConnected();
  const toast = useToast();
  const activity = useActivity();
  const [openId, open] = useOpenBuild();

  const [draft, setDraft] = usePersistentState("build-draft", { name: "", description: "", profile: "balanced" as BuildProfile });
  const [formOpen, setFormOpen] = usePersistentState<boolean | null>("build-form-open", null);
  const [filter, setFilter] = usePersistentState<Filter>("build-filter", "all");
  const [search, setSearch] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [starter, setStarter] = usePersistentState<StarterChoice>("build-starter", "auto");
  const [headStart, setHeadStart] = usePersistentState<HeadStart | "settings">("build-head-start", "settings");
  const [apps, setApps] = usePersistentState<Array<"android" | "windows">>("build-apps", []);
  const [maxPasses, setMaxPasses] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);

  const list = activity.builds;
  const live = activity.live;

  // One card per project, not per run: a project's runs (and their logs) are inside it.
  const projects = useMemo(() => groupBuilds(list), [list]);
  const counts = useMemo(
    () => ({
      all: projects.length,
      live: projects.filter((group) => isLive(group.latest)).length,
      works: projects.filter((group) => works(group.latest)).length,
      look: projects.filter((group) => needsLook(group.latest)).length
    }),
    [projects]
  );

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return projects
      .filter(({ latest }) =>
        filter === "live" ? isLive(latest) : filter === "works" ? works(latest) : filter === "look" ? needsLook(latest) : true
      )
      .filter(({ runs }) => !term || runs.some((build) => `${build.projectName} ${build.description}`.toLowerCase().includes(term)))
      // Building now first, then the most recently worked on.
      .sort((a, b) => Number(isLive(b.latest)) - Number(isLive(a.latest)) || b.latest.startedAt.localeCompare(a.latest.startedAt));
  }, [projects, filter, search]);

  if (connected === false) return <NotConnected />;
  if (openId) return <BuildDetail id={openId} onBack={() => open(null)} onOpen={open} />;

  // Open by default when there is nothing yet; otherwise remember what you chose.
  const showForm = formOpen ?? list.length === 0;
  const canStart = draft.name.trim().length >= 3 && draft.description.trim().length >= 15;

  const start = async () => {
    setBusy(true);
    try {
      const passes = Number(maxPasses);
      const quality = Number(target);
      const { buildId } = await api.startBuild({
        projectName: draft.name.trim(),
        description: draft.description.trim(),
        profile: draft.profile,
        maxIterations: maxPasses && Number.isFinite(passes) ? passes : undefined,
        qualityThreshold: target && Number.isFinite(quality) ? quality : undefined,
        starter,
        headStart: headStart === "settings" ? undefined : headStart,
        targetPlatforms: apps.length ? ["web", ...apps] : undefined
      });
      setDraft({ name: "", description: "", profile: draft.profile });
      toast("Building. You can close this — it keeps going on the PC.", "ok");
      await activity.refresh();
      open(buildId);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Header
        title="Build"
        sub={live.length ? `${live.length} building now · ${projects.length} projects` : projects.length ? `${projects.length} projects · ${list.length} runs` : "Describe it and it gets built"}
        state={activity.error && !activity.fresh ? "down" : live.length > 0 ? "busy" : "up"}
      />

      <div className="wrap">
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
          <Freshness updatedAt={activity.updatedAt} fresh={activity.fresh} error={activity.error} />
        </div>
        {activity.error ? <Banner kind="error">{activity.error}</Banner> : null}

        {/* ---------- new build ---------- */}
        <section className="hero">
          <button className="hero-toggle" onClick={() => setFormOpen(!showForm)} aria-expanded={showForm}>
            <div>
              <div className="hero-label">New build</div>
              <h2 className="hero-title" style={{ fontSize: showForm ? 25 : 19 }}>What should it build?</h2>
            </div>
            <span className={`chev ${showForm ? "up" : ""}`}>{Icon.back}</span>
          </button>

          {showForm ? (
            <div className="fade-in">
              <p className="hero-sub">
                Describe it the way you would to a developer. Your PC writes it, installs it, runs the typecheck, build and
                tests, fixes what fails and goes round again — it is only called done when those checks pass.
              </p>

              <label className="field" style={{ marginTop: 16 }}>
                <span>Call it something</span>
                <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="e.g. Café landing page" />
              </label>

              <label className="field">
                <span>What it should do</span>
                <textarea
                  rows={4}
                  value={draft.description}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  placeholder="Who is it for, what should be on it, and what should happen when someone uses it."
                />
              </label>
              <Link href="/prompt/" className="pb-link">
                {Icon.code} Not sure what to write? Use the prompt builder →
              </Link>

              <div className="chips" style={{ marginBottom: 12 }}>
                {EXAMPLES.map((example) => (
                  <button
                    key={example.name}
                    className="chip"
                    onClick={() => setDraft({ ...draft, name: example.name, description: example.description })}
                  >
                    {example.name}
                  </button>
                ))}
              </div>

              <div className="field">
                <span>How hard should it try?</span>
                <div className="segmented">
                  {PROFILES.map((option) => (
                    <button key={option.id} className={draft.profile === option.id ? "on" : ""} onClick={() => setDraft({ ...draft, profile: option.id })}>
                      {option.label}
                    </button>
                  ))}
                </div>
                <small className="muted" style={{ display: "block", marginTop: 7 }}>
                  {PROFILES.find((option) => option.id === draft.profile)?.hint} It stops early once passes stop getting better.
                </small>
              </div>

              <div className="field">
                <span>Also make</span>
                <div className="chips">
                  {APPS.map((option) => (
                    <button
                      key={option.id}
                      className={`chip ${apps.includes(option.id) ? "on" : ""}`}
                      aria-pressed={apps.includes(option.id)}
                      onClick={() => setApps(apps.includes(option.id) ? apps.filter((id) => id !== option.id) : [...apps, option.id])}
                    >
                      {apps.includes(option.id) ? "✓ " : ""}
                      {option.label}
                    </button>
                  ))}
                </div>
                <small className="muted" style={{ display: "block", marginTop: 7 }}>
                  {apps.length ? "Made from the website once every check passes; download them from the build." : "Just the website. You can still make the phone or PC app from a finished build."}
                </small>
              </div>

              <button className="btn ghost small" onClick={() => setAdvanced((value) => !value)}>
                {Icon.gear} {advanced ? "Hide" : "More"} options
              </button>
              {advanced ? (
                <div className="fade-in" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
                  <div className="field" style={{ gridColumn: "1 / -1" }}>
                    <span>Start from</span>
                    <div className="segmented">
                      {STARTERS.map((option) => (
                        <button key={option.id} className={starter === option.id ? "on" : ""} onClick={() => setStarter(option.id)}>
                          {option.label}
                        </button>
                      ))}
                    </div>
                    <small className="muted" style={{ display: "block", marginTop: 7 }}>{STARTERS.find((option) => option.id === starter)?.hint}</small>
                  </div>
                  <div className="field" style={{ gridColumn: "1 / -1" }}>
                    <span>How it begins</span>
                    <div className="segmented">
                      {HEAD_STARTS.map((option) => (
                        <button key={option.id} className={headStart === option.id ? "on" : ""} onClick={() => setHeadStart(option.id)}>
                          {option.label}
                        </button>
                      ))}
                    </div>
                    <small className="muted" style={{ display: "block", marginTop: 7 }}>{HEAD_STARTS.find((option) => option.id === headStart)?.hint}</small>
                  </div>
                  <label className="field">
                    <span>Most passes</span>
                    <input inputMode="numeric" value={maxPasses} onChange={(event) => setMaxPasses(event.target.value.replace(/\D/g, ""))} placeholder="profile default" />
                  </label>
                  <label className="field">
                    <span>Quality target</span>
                    <input inputMode="numeric" value={target} onChange={(event) => setTarget(event.target.value.replace(/\D/g, ""))} placeholder="90" />
                  </label>
                </div>
              ) : null}

              <button className="power" onClick={start} disabled={busy || !canStart}>
                {busy ? <Busy label="Starting…" /> : <>{Icon.sparkle} Build it</>}
              </button>
              {!canStart && (draft.name || draft.description) ? (
                <small className="muted" style={{ display: "block", marginTop: 8 }}>
                  {draft.name.trim().length < 3 ? "Give it a name of at least 3 letters. " : ""}
                  {draft.description.trim().length < 15 ? "A sentence or two gets a much better result than a few words." : ""}
                </small>
              ) : draft.name || draft.description ? (
                <small className="muted" style={{ display: "block", marginTop: 8 }}>Your draft is kept on this device until you start it.</small>
              ) : null}
            </div>
          ) : null}
        </section>

        {/* ---------- builds ---------- */}
        {list.length > 0 ? (
          <>
            <div className="filters">
              {(
                [
                  ["all", "All"],
                  ["live", "Building"],
                  ["works", "Works"],
                  ["look", "Needs a look"]
                ] as Array<[Filter, string]>
              ).map(([id, label]) => (
                <button key={id} className={filter === id ? "on" : ""} onClick={() => setFilter(id)}>
                  {label} <span className="count">{counts[id]}</span>
                </button>
              ))}
            </div>
            {projects.length > 6 ? (
              <input
                className="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Find a project"
                style={{ marginTop: 10 }}
              />
            ) : null}
          </>
        ) : null}

        {activity.loading && list.length === 0 ? <Skeleton rows={2} /> : null}

        <div className="build-grid">
          {shown.map((group) => (
            <BuildCard key={group.key} build={group.latest} runs={group.runs.length} best={group.best} onOpen={() => open(group.latest.buildId)} />
          ))}
        </div>

        {!activity.loading && list.length === 0 ? (
          <div className="empty">Nothing built yet. Describe something above and it gets going.</div>
        ) : null}
        {list.length > 0 && shown.length === 0 ? <div className="empty">Nothing here.</div> : null}
      </div>
    </>
  );
}
