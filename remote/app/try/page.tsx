"use client";

/**
 * Try it: a test pane for anything this PC has made or can show — a build, a
 * template, a project — launched and used right here, at phone, tablet or
 * desktop size, or full screen for a game. Pick on the left (or above, on a
 * phone); it runs on the right.
 *
 * A build is shown as its latest pass, even when that pass still fails a check
 * (the builder makes a playable copy every pass), so there is always something
 * to try while it is being finished.
 */
import { useEffect, useMemo, useState } from "react";

import { api, type PreviewKind } from "@/lib/api";
import { PreviewPane } from "../preview";
import { DownloadBuild } from "../build/download";
import { Banner, Header, NotConnected, Skeleton, useConnected, useRemote } from "../ui";

interface Item {
  kind: PreviewKind;
  id: string;
  name: string;
  detail: string;
}

const TABS: Array<{ kind: PreviewKind; label: string }> = [
  { kind: "build", label: "Builds" },
  { kind: "template", label: "Templates" },
  { kind: "project", label: "Projects" }
];

export default function TryPage() {
  const connected = useConnected();
  const [tab, setTab] = useState<PreviewKind>("build");
  const [picked, setPicked] = useState<Item | null>(null);
  const [filter, setFilter] = useState("");
  const [height, setHeight] = useState(620);

  const builds = useRemote(() => api.builds(), 15000, "try.builds");
  const templates = useRemote(() => api.templates(), 0, "try.templates");
  const projects = useRemote(() => api.projects(), 0, "try.projects");

  // Launched from elsewhere: /try?kind=build&id=build_123
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const kind = params.get("kind") as PreviewKind | null;
    const id = params.get("id");
    if (kind && id && TABS.some((option) => option.kind === kind)) {
      setTab(kind);
      setPicked({ kind, id, name: params.get("name") ?? id, detail: "" });
    }
    const fit = () => setHeight(Math.max(420, Math.min(900, window.innerHeight - 240)));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  const items: Item[] = useMemo(() => {
    if (tab === "build") {
      return [...(builds.data?.builds ?? [])]
        .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
        .map((build) => ({
          kind: "build" as const,
          id: build.buildId,
          name: build.projectName,
          detail: `${build.state} · best ${build.bestScore ?? build.qualityScore ?? 0} · ${new Date(build.startedAt).toLocaleString()}`
        }));
    }
    if (tab === "template") {
      return (templates.data?.all ?? templates.data?.templates ?? [])
        .filter((template) => template.sourcePath || template.previewUrl)
        .map((template) => ({ kind: "template" as const, id: template.id, name: template.name, detail: template.category || template.kind }));
    }
    return (projects.data?.projects ?? []).map((project) => ({
      kind: "project" as const,
      id: project.id,
      name: project.name,
      detail: project.stack.slice(0, 3).join(" · ") || project.kind
    }));
  }, [tab, builds.data, templates.data, projects.data]);

  const shown = filter.trim() ? items.filter((item) => `${item.name} ${item.detail}`.toLowerCase().includes(filter.trim().toLowerCase())) : items;
  const loading = tab === "build" ? builds.loading : tab === "template" ? templates.loading : projects.loading;
  const error = tab === "build" ? builds.error : tab === "template" ? templates.error : projects.error;

  if (connected === false) return <NotConnected />;

  return (
    <>
      <Header title="Try it" sub={picked ? picked.name : "Launch a build, template or project and use it here"} state="up" />
      <div className="wrap try-layout">
        <aside className="try-list">
          <div className="segmented small" role="tablist">
            {TABS.map((option) => (
              <button key={option.kind} className={tab === option.kind ? "on" : ""} onClick={() => setTab(option.kind)}>
                {option.label}
              </button>
            ))}
          </div>
          <input className="try-filter" placeholder="Find…" value={filter} onChange={(event) => setFilter(event.target.value)} />
          {error ? <Banner kind="error">{error}</Banner> : null}
          {loading && items.length === 0 ? <Skeleton rows={5} /> : null}
          <div className="try-items">
            {shown.slice(0, 80).map((item) => (
              <button
                key={`${item.kind}:${item.id}`}
                className={`try-item ${picked?.kind === item.kind && picked.id === item.id ? "on" : ""}`}
                onClick={() => setPicked(item)}
              >
                <strong>{item.name}</strong>
                <small>{item.detail}</small>
              </button>
            ))}
            {!loading && shown.length === 0 ? <p className="muted">Nothing here yet.</p> : null}
          </div>
        </aside>

        <section className="try-stage">
          {picked ? (
            <>
              <PreviewPane key={`${picked.kind}:${picked.id}`} kind={picked.kind} id={picked.id} title={picked.name} height={height} />
              {picked.kind === "build" ? (
                <div className="btn-row" style={{ marginTop: 10 }}>
                  <DownloadBuild id={picked.id} label="Download the app" />
                </div>
              ) : null}
            </>
          ) : (
            <div className="try-empty">
              <h3>Pick something to try</h3>
              <p>
                A build runs as its latest pass, even while it is still being fixed. Use it at phone, tablet or desktop
                size, or <strong>Full screen</strong> for a game (click it once so it gets the keyboard).
              </p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
