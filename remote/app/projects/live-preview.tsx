"use client";

/**
 * A project, live: the site as it is now beside what a carry-on build would
 * make it, before anything is applied, committed or pushed. The live editor
 * works on either side; what you change becomes the next instruction.
 */
import { useEffect, useRef, useState } from "react";

import { api, type Project, type ProjectBuild } from "@/lib/api";
import { LiveEditor } from "../live-editor";
import { PreviewPane } from "../preview";
import { Busy, Icon, ago, useRemote, useToast } from "../ui";

type View = "now" | "changes" | "side";

const describeBuild = (build: ProjectBuild) => {
  const edits = build.instruction.match(/^Changes made in the live editor[^\n]*\n([\s\S]*)/);
  const what = edits ? `Live edits: ${edits[1].split("\n").length} change(s) — ${edits[1].split("\n")[0].replace(/^- /, "")}` : build.instruction;
  return `${what.length > 70 ? `${what.slice(0, 70)}…` : what} · ${build.appliedAt ? "applied" : build.state === "running" ? "working" : "not applied"} · ${ago(build.createdAt)}`;
};
export function ProjectLivePreview({
  project,
  focusBuild,
  onStarted
}: {
  project: Project;
  /** A carry-on build to compare with, e.g. from "Preview before applying". */
  focusBuild?: string | null;
  /** A new carry-on build was started from here. */
  onStarted?: () => void;
}) {
  const toast = useToast();
  const builds = useRemote(() => api.projectBuilds(project.id), 8000);
  const list = builds.data?.builds ?? [];
  const [compare, setCompare] = useState<string | null>(focusBuild ?? null);
  const [view, setView] = useState<View>(focusBuild ? "side" : "now");
  const [editing, setEditing] = useState<"now" | "changes" | null>(null);
  const [applying, setApplying] = useState(false);
  const nowFrame = useRef<HTMLIFrameElement | null>(null);
  const changesFrame = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    if (focusBuild) {
      setCompare(focusBuild);
      setView("side");
    }
  }, [focusBuild]);

  // Without a choice, compare with the newest build not yet applied.
  useEffect(() => {
    if (compare || !list.length) return;
    const pending = list.find((build) => !build.appliedAt);
    if (pending) setCompare(pending.buildId);
  }, [compare, list]);

  const chosen = list.find((build) => build.buildId === compare) ?? null;
  const shown: View = chosen ? view : "now";
  const busyBuild = chosen && (chosen.state === "running" || chosen.state === "paused");

  const apply = async () => {
    if (!chosen) return;
    setApplying(true);
    try {
      const res = await api.applyProjectBuild(chosen.buildId);
      const parts = [`${res.applied.length} file(s) written into the project`];
      if (res.conflicts.length) parts.push(`${res.conflicts.length} skipped because you changed them since`);
      toast(`${parts.join("; ")}. Commit it from Git & GitHub when you are happy.`, res.conflicts.length ? "info" : "ok");
      await builds.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setApplying(false);
    }
  };

  const nowPane = (
    <div className="compare-side">
      <div className="compare-label">
        <strong>The project now</strong>
        <button className={`btn small ${editing === "now" ? "accent" : "ghost"}`} onClick={() => setEditing(editing === "now" ? null : "now")}>
          {Icon.wrench} {editing === "now" ? "Close editor" : "Edit live"}
        </button>
      </div>
      <PreviewPane kind="project" id={project.id} height={shown === "side" ? 520 : 600} title={`${project.name} as it is`} frameRef={nowFrame} />
    </div>
  );

  const changesPane = chosen ? (
    <div className="compare-side">
      <div className="compare-label">
        <strong>{busyBuild ? "With the changes — still working" : "With the changes"}</strong>
        <button className={`btn small ${editing === "changes" ? "accent" : "ghost"}`} onClick={() => setEditing(editing === "changes" ? null : "changes")}>
          {Icon.wrench} {editing === "changes" ? "Close editor" : "Edit live"}
        </button>
      </div>
      <PreviewPane
        kind="build"
        id={chosen.latestBuildId ?? chosen.buildId}
        refreshKey={`${chosen.iterations}-${chosen.state}-${chosen.qualityScore}`}
        height={shown === "side" ? 520 : 600}
        title={`${project.name} with the changes`}
        frameRef={changesFrame}
      />
    </div>
  ) : null;

  return (
    <div className="project-live">
      <div className="project-live-bar">
        {list.length ? (
          <label className="field compact" style={{ margin: 0, flex: 1, minWidth: 220 }}>
            <span>Compare with a carry-on build</span>
            <select value={compare ?? ""} onChange={(event) => setCompare(event.target.value || null)}>
              <option value="">Only the project as it is</option>
              {list.map((build) => (
                <option key={build.buildId} value={build.buildId}>
                  {describeBuild(build)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="muted small" style={{ margin: 0, flex: 1 }}>
            Carry on with the project (or use Edit live below) and the changes show up here beside it, before anything is applied.
          </p>
        )}
        {chosen ? (
          <div className="segmented small" role="group" aria-label="What to show">
            <button className={shown === "now" ? "on" : ""} onClick={() => setView("now")}>
              Now
            </button>
            <button className={shown === "changes" ? "on" : ""} onClick={() => setView("changes")}>
              Changed
            </button>
            <button className={shown === "side" ? "on" : ""} onClick={() => setView("side")}>
              Side by side
            </button>
          </div>
        ) : null}
      </div>

      <div className={`compare ${shown === "side" ? "two" : ""}`}>
        {shown !== "changes" ? nowPane : null}
        {shown !== "now" ? changesPane : null}
      </div>

      {chosen ? (
        <div className="compare-actions">
          <span className="muted small">
            {chosen.changes.length} file{chosen.changes.length === 1 ? "" : "s"} changed
            {chosen.qualityScore !== null ? ` · quality ${chosen.qualityScore}` : ""}
            {chosen.appliedAt ? ` · applied ${ago(chosen.appliedAt)}` : " · nothing in the project has changed yet"}
          </span>
          <button className="btn small primary" disabled={applying || Boolean(busyBuild)} onClick={apply} title={busyBuild ? "Wait for it to finish" : undefined}>
            {applying ? <Busy label="Applying…" /> : <>{Icon.check} {chosen.appliedAt ? "Apply again" : "Looks right — apply to the project"}</>}
          </button>
        </div>
      ) : null}

      {editing === "now" ? (
        <LiveEditor
          key={`now-${project.id}`}
          storageKey={`project:${project.id}`}
          frameRef={nowFrame}
          actions={[
            {
              label: "Carry on with these changes",
              primary: true,
              clearAfter: true,
              run: async (brief) => {
                const res = await api.instructProject(project.id, brief);
                toast("Working on a copy — it shows up beside the project here when it has a first version.", "ok");
                setCompare(res.buildId);
                setView("side");
                setEditing(null);
                onStarted?.();
                await builds.refresh();
              }
            }
          ]}
        />
      ) : null}
      {editing === "changes" && chosen ? (
        <LiveEditor
          key={`changes-${chosen.buildId}`}
          storageKey={`project-build:${chosen.buildId}`}
          frameRef={changesFrame}
          actions={[
            busyBuild
              ? {
                  label: "Tell the build",
                  primary: true,
                  clearAfter: true,
                  run: async (brief) => {
                    await api.guideBuild(chosen.latestBuildId ?? chosen.buildId, brief);
                    toast("Sent. It picks the changes up in its next pass.", "ok");
                  }
                }
              : {
                  label: "Make these changes too",
                  primary: true,
                  clearAfter: true,
                  run: async (brief) => {
                    await api.continueBuild(chosen.latestBuildId ?? chosen.buildId, { instruction: brief });
                    toast("Another pass on the same copy — the preview updates when it is done. Nothing is applied yet.", "ok");
                    setEditing(null);
                    await builds.refresh();
                  }
                }
          ]}
        />
      ) : null}
    </div>
  );
}
