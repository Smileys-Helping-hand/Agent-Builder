"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { api, type BuildProfile } from "@/lib/api";
import { isLive, useActivity } from "../activity";
import { Banner, Busy, Freshness, Header, Icon, NotConnected, Skeleton, useConnected, usePersistentState, useToast } from "../ui";
import { BuildDetail } from "./detail";
import { BuildCard, needsLook, works } from "./parts";

const PROFILES: Array<{ id: BuildProfile; label: string; hint: string }> = [
  { id: "fast", label: "Fast", hint: "Up to 8 passes, one repair each. Good for a rough first look." },
  { id: "balanced", label: "Balanced", hint: "Up to 25 passes, three repairs each. Start here." },
  { id: "deep", label: "Deep", hint: "Up to 60 passes, five repairs each, and a bigger model reviews every fix. Slowest, best." }
];

const EXAMPLES = [
  { name: "Café landing page", description: "A one-page site for a coffee shop: hero, menu, opening hours, map and a contact form." },
  { name: "Invoice tracker", description: "A small web app to record invoices, mark them paid, and show what is overdue." },
  { name: "Booking form", description: "A booking page that takes a name, date and service, and emails the owner." }
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
  const [maxPasses, setMaxPasses] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);

  const list = activity.builds;
  const live = activity.live;

  const counts = useMemo(
    () => ({
      all: list.length,
      live: live.length,
      works: list.filter(works).length,
      look: list.filter(needsLook).length
    }),
    [list, live]
  );

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return list
      .filter((build) =>
        filter === "live" ? isLive(build) : filter === "works" ? works(build) : filter === "look" ? needsLook(build) : true
      )
      .filter((build) => !term || `${build.projectName} ${build.description}`.toLowerCase().includes(term))
      // Live builds first, then newest.
      .sort((a, b) => Number(isLive(b)) - Number(isLive(a)) || b.startedAt.localeCompare(a.startedAt));
  }, [list, filter, search]);

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
        qualityThreshold: target && Number.isFinite(quality) ? quality : undefined
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
        sub={live.length ? `${live.length} building now · ${list.length} in all` : list.length ? `${list.length} builds` : "Describe it and it gets built"}
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

              <button className="btn ghost small" onClick={() => setAdvanced((value) => !value)}>
                {Icon.gear} {advanced ? "Hide" : "More"} options
              </button>
              {advanced ? (
                <div className="fade-in" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
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
            {list.length > 6 ? (
              <input
                className="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Find a build"
                style={{ marginTop: 10 }}
              />
            ) : null}
          </>
        ) : null}

        {activity.loading && list.length === 0 ? <Skeleton rows={2} /> : null}

        <div className="build-grid">
          {shown.map((build) => (
            <BuildCard key={build.buildId} build={build} onOpen={() => open(build.buildId)} />
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
