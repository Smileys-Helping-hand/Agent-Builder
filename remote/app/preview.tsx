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

import { api, onMachine, type PreviewInfo } from "@/lib/api";
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
  title
}: {
  kind: "template" | "build";
  id: string;
  /** Anything that changes when the site should be reloaded (a build's pass count). */
  refreshKey?: string | number;
  height?: number;
  title?: string;
}) => {
  const [info, setInfo] = useState<PreviewInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [device, setDevice] = useState<Device>("desktop");
  const [reloads, setReloads] = useState(0);
  const [width, setWidth] = useState(600);
  const frameBox = useRef<HTMLDivElement>(null);

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
        if (!next.ready && (next.preparing || kind === "build")) timer = setTimeout(load, next.preparing ? 4000 : 8000);
      } catch (caught) {
        if (!stop) setError(caught instanceof Error ? caught.message : String(caught));
      }
    };
    void load();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [kind, id, refreshKey]);

  useEffect(() => {
    const box = frameBox.current;
    if (!box) return;
    const measure = () => setWidth(box.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [info?.ready]);

  const target = DEVICES.find((option) => option.id === device)!;
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
            <a className="btn small ghost" href={onMachine(info!.url!)} target="_blank" rel="noreferrer" title="Open in a new tab">
              {Icon.external} Open
            </a>
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
                <p>{info.reason}</p>
              </>
            ) : (
              <>
                <p>{info.reason ?? "Nothing to preview yet."}</p>
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
      {src && scale < 1 ? <small className="muted preview-note">Shown at {Math.round(scale * 100)}% of real size.</small> : null}
    </div>
  );
};
