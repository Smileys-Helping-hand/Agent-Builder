"use client";

/**
 * Screens: this PC and the laptop, seen and used from the phone.
 *
 * Frames are fetched one after another (each asks with the last frame's id,
 * so an unchanged screen costs a few bytes) and stop when the app is hidden.
 * Control is off until switched on, so a stray tap never clicks anything:
 * then a tap clicks there, a double tap double-clicks, a long press
 * right-clicks, and the bar below scrolls, types and sends keys.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { api, type ScreenInput, type ScreenMachine } from "@/lib/api";
import { Banner, Header, Icon, NotConnected, Skeleton, useConnected, useRemote, useToast } from "../ui";

const KEYS: Array<{ label: string; key: string }> = [
  { label: "Enter", key: "Return" },
  { label: "⌫", key: "BackSpace" },
  { label: "Tab", key: "Tab" },
  { label: "Esc", key: "Escape" },
  { label: "←", key: "Left" },
  { label: "↑", key: "Up" },
  { label: "↓", key: "Down" },
  { label: "→", key: "Right" },
  { label: "Copy", key: "ctrl+c" },
  { label: "Paste", key: "ctrl+v" },
  { label: "Undo", key: "ctrl+z" },
  { label: "All", key: "ctrl+a" },
  { label: "Save", key: "ctrl+s" },
  { label: "Alt+Tab", key: "alt+Tab" },
  { label: "Win", key: "Super_L" }
];

type Status = { kind: "live"; fps: number; ms: number } | { kind: "waiting"; text: string } | { kind: "error"; text: string; setup?: boolean };

function Viewer({ machine }: { machine: ScreenMachine }) {
  const toast = useToast();
  const [src, setSrc] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "waiting", text: "Getting the screen…" });
  const [control, setControl] = useState(false);
  const [hd, setHd] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const lastPoint = useRef<{ x: number; y: number }>({ x: 0.5, y: 0.5 });
  const press = useRef<{ timer: number | null; long: boolean; at: number; x: number; y: number } | null>(null);
  const lastTap = useRef<{ at: number; x: number; y: number } | null>(null);

  // The frame loop: one request at a time, paused while the app is hidden.
  useEffect(() => {
    let alive = true;
    let etag: string | null = null;
    let current: string | null = null;
    const times: number[] = [];
    const loop = async () => {
      while (alive) {
        if (document.hidden) {
          await new Promise((r) => setTimeout(r, 800));
          continue;
        }
        const started = performance.now();
        const frame = await api.screenFrame(machine.id, etag, hd ? 1920 : 1280);
        if (!alive) break;
        if (frame.status === "new") {
          etag = frame.etag;
          if (current) URL.revokeObjectURL(current);
          current = frame.url;
          setSrc(frame.url);
          times.push(performance.now());
          while (times.length > 6) times.shift();
          const fps = times.length > 1 ? ((times.length - 1) * 1000) / (times[times.length - 1] - times[0]) : 0;
          setStatus({ kind: "live", fps: Math.round(fps * 10) / 10, ms: Math.round(performance.now() - started) });
        } else if (frame.status === "same") {
          setStatus((s) => (s.kind === "live" ? { ...s, ms: Math.round(performance.now() - started) } : s));
        } else {
          setStatus(frame.waiting ? { kind: "waiting", text: frame.error } : { kind: "error", text: frame.error, setup: frame.setup });
          await new Promise((r) => setTimeout(r, frame.setup ? 15000 : 3000));
          continue;
        }
        await new Promise((r) => setTimeout(r, machine.id === "pc" ? 120 : 350));
      }
    };
    void loop();
    return () => {
      alive = false;
      if (current) URL.revokeObjectURL(current);
    };
  }, [machine.id, hd]);

  const send = useCallback(
    async (events: ScreenInput[]) => {
      try {
        await api.screenInput(machine.id, events);
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error));
      }
    },
    [machine.id, toast]
  );

  const pointOf = (clientX: number, clientY: number) => {
    const rect = img.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    return { x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000 };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!control) return;
    const point = pointOf(e.clientX, e.clientY);
    if (!point) return;
    const state = { timer: null as number | null, long: false, at: Date.now(), ...point };
    state.timer = window.setTimeout(() => {
      state.long = true;
      lastPoint.current = point;
      void send([{ kind: "click", x: point.x, y: point.y, button: "right" }]);
      navigator.vibrate?.(30);
    }, 550);
    press.current = state;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const state = press.current;
    if (!state) return;
    const point = pointOf(e.clientX, e.clientY);
    // A finger that moves is scrolling the page, not clicking.
    if (point && Math.hypot(point.x - state.x, point.y - state.y) > 0.03 && state.timer) {
      clearTimeout(state.timer);
      press.current = null;
    }
  };
  const onPointerUp = () => {
    const state = press.current;
    press.current = null;
    if (!state || !control) return;
    if (state.timer) clearTimeout(state.timer);
    if (state.long) return;
    const point = { x: state.x, y: state.y };
    lastPoint.current = point;
    const previous = lastTap.current;
    const double = previous && Date.now() - previous.at < 350 && Math.hypot(previous.x - point.x, previous.y - point.y) < 0.03;
    lastTap.current = double ? null : { at: Date.now(), ...point };
    void send([{ kind: "click", x: point.x, y: point.y, button: "left", ...(double ? { double: true } : {}) }]);
  };

  const scroll = (dy: number) => void send([{ kind: "scroll", x: lastPoint.current.x, y: lastPoint.current.y, dy }]);
  const typeText = async () => {
    if (!text) return;
    setBusy(true);
    await send([{ kind: "type", text }]);
    setText("");
    setBusy(false);
  };
  const fullScreen = () => {
    const el = box.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.().then(() => (screen.orientation as unknown as { lock?: (o: string) => Promise<void> })?.lock?.("landscape").catch(() => undefined)).catch(() => undefined);
  };

  const canControl = machine.control !== false;
  return (
    <>
      <div ref={box} className={`screen-box ${control ? "controlling" : ""}`}>
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={img}
            src={src}
            alt={`${machine.label}'s screen`}
            className="screen-img"
            draggable={false}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => (press.current = null)}
            onContextMenu={(e) => e.preventDefault()}
          />
        ) : (
          <div className="screen-empty">{status.kind === "live" ? "…" : status.text}</div>
        )}
      </div>

      <div className="screen-status muted small">
        {status.kind === "live" ? `Live · ${status.fps || "…"} frames/s · ${status.ms} ms` : status.kind === "waiting" ? status.text : null}
      </div>
      {status.kind === "error" ? <Banner kind={status.setup ? "info" : "error"}>{status.text}</Banner> : null}

      <div className="btn-row" style={{ marginTop: 8 }}>
        {canControl ? (
          <button className={`btn small ${control ? "primary" : ""}`} onClick={() => setControl((on) => !on)} aria-pressed={control}>
            {control ? <>{Icon.check} Controlling</> : <>{Icon.eye} View only: tap to control</>}
          </button>
        ) : (
          <span className="chip warn">View only</span>
        )}
        <button className="btn small ghost" onClick={() => setHd((on) => !on)} aria-pressed={hd}>
          {hd ? "HD" : "Fast"}
        </button>
        <button className="btn small ghost" onClick={fullScreen}>
          {Icon.expand} Full screen
        </button>
      </div>

      {control ? (
        <section className="card screen-controls">
          <div className="btn-row">
            <button className="btn small" onClick={() => scroll(-3)}>Scroll up</button>
            <button className="btn small" onClick={() => scroll(3)}>Scroll down</button>
          </div>
          <div className="screen-keys">
            {KEYS.map((k) => (
              <button key={k.key} className="btn small ghost" onClick={() => void send([{ kind: "key", key: k.key }])}>
                {k.label}
              </button>
            ))}
          </div>
          <div className="screen-type">
            <input
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 500))}
              onKeyDown={(e) => e.key === "Enter" && void typeText()}
              placeholder="Type here, then Send"
              autoCapitalize="off"
              autoCorrect="off"
              aria-label={`Text to type on the ${machine.label}`}
            />
            <button className="btn small primary" disabled={!text || busy} onClick={() => void typeText()}>
              Send
            </button>
          </div>
          <p className="hint" style={{ margin: "8px 0 0" }}>Tap clicks · double tap double-clicks · hold for a right click. Scroll and keys act where you last tapped.</p>
        </section>
      ) : null}
    </>
  );
}

/** This PC on Jarvis's dashboard too: his tray app, installed from here. */
function JarvisLink() {
  const toast = useToast();
  const state = useRemote(() => api.screenJarvis(), 0, "screen-jarvis");
  const [busy, setBusy] = useState(false);
  if (!state.data) return null;
  const pair = async () => {
    setBusy(true);
    try {
      const answer = await api.screenPairJarvis();
      toast(answer.message);
      void state.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card" style={{ marginTop: 12 }}>
      <h2 style={{ marginTop: 0 }}>In Jarvis too</h2>
      {state.data.paired ? (
        <p className="hint" style={{ margin: 0 }}>Jarvis can see this PC: it is on his dashboard beside the laptop (its round tray icon pauses or removes it).</p>
      ) : state.data.canPair ? (
        <>
          <p className="hint">Put this PC on Jarvis&apos;s dashboard as well, beside the laptop. It installs his small tray app for your Windows account (no admin rights), which shows the screen only while you watch.</p>
          <button className="btn small primary" disabled={busy} onClick={() => void pair()}>
            {busy ? "Installing…" : "Let Jarvis see this PC"}
          </button>
        </>
      ) : (
        <p className="hint" style={{ margin: 0 }}>Once the laptop is connected (LAPTOP_JARVIS_KEY), this PC can go on Jarvis&apos;s dashboard from here in one tap.</p>
      )}
    </section>
  );
}

export default function Screens() {
  const connected = useConnected();
  const screens = useRemote(() => api.screens(), 0, "screens");
  const [machineId, setMachineId] = useState<ScreenMachine["id"]>("pc");

  if (connected === false) return <NotConnected />;
  const machines = screens.data?.machines ?? [];
  const machine = machines.find((m) => m.id === machineId) ?? machines[0];

  return (
    <>
      <Header title="Screens" sub="See and use this PC and the laptop from anywhere" state={machine?.available ? "up" : "warn"} />
      <div className="wrap">
        {screens.error ? <Banner kind="error">{screens.error}</Banner> : null}
        {!screens.data && screens.loading ? <Skeleton rows={3} /> : null}
        {machines.length > 0 ? (
          <div className="filters" role="tablist" aria-label="Machine">
            {machines.map((m) => (
              <button key={m.id} className={m.id === machine?.id ? "on" : ""} onClick={() => setMachineId(m.id)} role="tab" aria-selected={m.id === machine?.id}>
                {m.id === "pc" ? "This PC" : "Laptop"}
              </button>
            ))}
          </div>
        ) : null}
        {machine && !machine.available ? <Banner kind="info">{machine.note ?? "Not available."}</Banner> : null}
        {machine?.available ? <Viewer key={machine.id} machine={machine} /> : null}
        {machine?.id === "pc" && machine.available ? <JarvisLink /> : null}
      </div>
    </>
  );
}
