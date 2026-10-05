"use client";

/**
 * A live preview pane: the site itself, served by the builder, in a frame you
 * can switch between phone, tablet and desktop widths. The desktop view is
 * drawn at full width and scaled down to fit, so it looks like the real thing
 * rather than a squashed phone layout.
 *
 * The frame is sandboxed without same-origin: the site's scripts run, but they
 * cannot reach this app's storage (where the builder key lives), even when the
 * app and the preview are served from the same builder.
 */
import { useEffect, useRef, useState } from "react";

import { ago } from "./ui";
import { api, onMachine, type PreviewInfo, type PreviewKind, type PreviewReport } from "@/lib/api";
import { Busy, Icon } from "./ui";

const DEVICES = [
  { id: "phone", label: "Phone", width: 390 },
  { id: "tablet", label: "Tablet", width: 820 },
  { id: "desktop", label: "Desktop", width: 1280 }
] as const;
type Device = (typeof DEVICES)[number]["id"];

export const PreviewPane = ({
  kind,
  id,
  refreshKey,
  height = 560,
  title,
  onReports,
  frameRef
}: {
  kind: PreviewKind;
  id: string;
  /** Anything that changes when the site should be reloaded (a build's pass count). */
  refreshKey?: string | number;
  height?: number;
  title?: string;
  /** Errors the previewed page reported (script errors, failed loads, console.error), newest last. */
  onReports?: (reports: PreviewReport[]) => void;
  /** The frame itself, for a live editor that talks to the page. */
  frameRef?: React.MutableRefObject<HTMLIFrameElement | null>;
}) => {
  const [info, setInfo] = useState<PreviewInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [device, setDevice] = useState<Device>("desktop");
  const [reloads, setReloads] = useState(0);
  const [width, setWidth] = useState(600);
  const frameBox = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [reports, setReports] = useState<PreviewReport[]>([]);
  const [showReports, setShowReports] = useState(false);
  const [builds, setBuilds] = useState(0);

  /** A project: build it as it is now, in a copy, and show that. */
  const buildFresh = async () => {
    try {
      await api.buildProjectPreview(id);
      setInfo((current) => (current ? { ...current, job: { state: "running", startedAt: new Date().toISOString(), step: "Copying the project", error: null }, preparing: !current.ready } : current));
      setBuilds((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  // Ask where the preview is; keep asking while it is being prepared.
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      try {
        const next = await api.preview(kind, id);
        if (stop) return;
        setInfo(next);
        setError(null);
        if ((!next.ready && (next.preparing || kind === "build")) || next.job?.state === "running") timer = setTimeout(load, next.preparing ? 4000 : 8000);
      } catch (caught) {
        if (!stop) setError(caught instanceof Error ? caught.message : String(caught));
      }
    };
    void load();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [kind, id, refreshKey, builds]);

  useEffect(() => {
    const box = frameBox.current;
    if (!box) return;
    const measure = () => setWidth(box.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [info?.ready]);

  // What the page reports while you click through it. Only messages from this
  // pane's own frame count; the frame has no origin of its own (it is sandboxed),
  // so the source is what identifies it.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const data = event.data as PreviewReport & { type?: string };
      if (data?.type !== "ab-preview-report" || typeof data.message !== "string") return;
      if (data.kind === "loaded") return;
      setReports((current) => {
        if (current.some((entry) => entry.message === data.message)) return current;
        const next = [...current, { kind: data.kind, message: data.message, page: data.page }].slice(-40);
        onReports?.(next);
        return next;
      });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onReports]);

  const target = DEVICES.find((option) => option.id === device)!;
  const src0 = info?.url ? `${info.url}|${info.version ?? ""}|${reloads}` : null;
  // A new page (a reload, a new pass) starts with a clean slate. Not on the
  // frame's load event: errors while loading arrive before it and would be lost.
  useEffect(() => {
    setReports([]);
    onReports?.([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src0]);
  const scale = Math.min(1, width / target.width);
  const src = info?.url ? `${onMachine(info.url)}?v=${info.version ?? ""}-${reloads}` : null;

  return (
    <div className="preview">
      <div className="preview-bar">
        <div className="segmented small" role="group" aria-label="Preview width">
          {DEVICES.map((option) => (
            <button key={option.id} className={device === option.id ? "on" : ""} onClick={() => setDevice(option.id)}>
              {option.label}
            </button>
          ))}
        </div>
        <div className="btn-row">
          <button className="btn small ghost" onClick={() => setReloads((value) => value + 1)} disabled={!src} title="Reload the preview">
            {Icon.refresh}
          </button>
          {src ? (
            <button
              className="btn small ghost"
              title="Fill the screen with it: best for games"
              onClick={() => {
                const box = frameBox.current;
                if (!box) return;
                void box.requestFullscreen?.().then(() => frame.current?.focus()).catch(() => undefined);
              }}
            >
              {Icon.expand} Full screen
            </button>
          ) : null}
          {src ? (
            <a className="btn small ghost" href={onMachine(info!.url!)} target="_blank" rel="noreferrer" title="Open in a new tab">
              {Icon.external} Open
            </a>
          ) : null}
          {kind === "project" && info?.canBuild && info.ready ? (
            <button className="btn small ghost" disabled={info.job?.state === "running"} onClick={buildFresh} title="Build the project as it is now, in a copy">
              {info.job?.state === "running" ? <Busy label="Building…" /> : "Rebuild"}
            </button>
          ) : null}
          {kind === "template" && info && !info.preparing ? (
            <button
              className="btn small ghost"
              title="Build the preview again from the template's current code"
              onClick={async () => {
                await api.rebuildTemplatePreview(id).catch(() => undefined);
                setInfo({ ...info, ready: false, url: null, preparing: true, reason: "Rebuilding the preview…" });
                setTimeout(() => setReloads((value) => value + 1), 500);
              }}
            >
              Rebuild
            </button>
          ) : null}
        </div>
      </div>

      <div className="preview-frame" ref={frameBox} style={{ height }}>
        {src ? (
          <iframe
            key={src}
            ref={(element) => {
              frame.current = element;
              if (frameRef) frameRef.current = element;
            }}
            title={title ?? "Preview"}
            src={src}
            sandbox="allow-scripts allow-forms allow-popups allow-modals"
            style={{
              width: target.width,
              height: height / scale,
              transform: `scale(${scale})`,
              transformOrigin: "0 0",
              left: scale < 1 ? 0 : `calc(50% - ${target.width / 2}px)`
            }}
          />
        ) : (
          <div className="preview-empty">
            {error ? (
              <p>{error}</p>
            ) : !info ? (
              <Busy label="Finding the preview…" />
            ) : info.preparing ? (
              <>
                <Busy label="Preparing the preview" />
                <p>{info.job?.step ? `${info.job.step}…` : info.reason}</p>
              </>
            ) : (
              <>
                <p>{info.reason ?? "Nothing to preview yet."}</p>
                {info.job?.state === "failed" && info.job.error ? <pre className="preview-error">{info.job.error.split("\n").slice(-8).join("\n")}</pre> : null}
                {kind === "project" && info.canBuild ? (
                  <button className="btn small primary" onClick={buildFresh}>
                    {Icon.sparkle} {info.job?.state === "failed" ? "Try building it again" : "Build a fresh preview"}
                  </button>
                ) : null}
                {info.hosted ? (
                  <a className="btn small" href={info.hosted} target="_blank" rel="noreferrer">
                    {Icon.external} See the published example
                  </a>
                ) : null}
              </>
            )}
          </div>
        )}
      </div>
      {kind === "project" && info?.ready ? (
        <p className="muted small preview-source">
          {info.job?.state === "running"
            ? `Building a fresh copy: ${info.job.step}…`
            : info.job?.state === "failed"
              ? `The fresh build failed — showing ${info.from === "preview" ? "the last fresh preview that built" : "the project's own build"}.`
              : `${info.from === "preview" ? "Fresh preview" : "The project's own build"}${info.builtAt ? `, built ${ago(info.builtAt)}` : ""}.`}{" "}
          {info.from === "project" && info.canBuild ? "It may be older than the code — Rebuild to see the code as it is now." : ""}
        </p>
      ) : null}
      {src ? (
        <div className={`preview-console ${reports.length ? "has" : ""}`}>
          <button className="link" onClick={() => setShowReports((value) => !value)} disabled={!reports.length}>
            {reports.length ? `⚠ ${reports.length} problem${reports.length === 1 ? "" : "s"} on this page` : "✓ No errors on this page"}
          </button>
          {scale < 1 ? <small className="muted">Shown at {Math.round(scale * 100)}% of real size.</small> : null}
          {showReports && reports.length ? (
            <ul>
              {reports.map((report, index) => (
                <li key={index}>
                  <b>{report.kind}</b> {report.message}
                  {report.page ? <span className="muted"> · {report.page}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
