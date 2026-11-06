"use client";

/**
 * A VM's live console: its real screen (noVNC, with keyboard and mouse, full
 * screen and screenshots) and its serial terminal (xterm), over this builder's
 * signed sockets.
 */
import { useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";

import { api, onMachine, type LabVm } from "@/lib/api";
import { useToast } from "../ui";

const socketUrl = (path: string) => onMachine(path).replace(/^http/, "ws");

function Screen({ url, onStatus }: { url: string; onStatus: (status: string) => void }) {
  const holder = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let rfb: { disconnect: () => void; scaleViewport: boolean; resizeSession: boolean; focus: () => void; addEventListener: (type: string, fn: (event: { detail?: { clean?: boolean } }) => void) => void } | null = null;
    let cancelled = false;
    void (async () => {
      // noVNC touches the browser as it loads: only here, in the browser.
      const { default: RFB } = (await import("@novnc/novnc/core/rfb.js")) as unknown as { default: new (target: HTMLElement, url: string, options?: object) => NonNullable<typeof rfb> };
      if (cancelled || !holder.current) return;
      rfb = new RFB(holder.current, socketUrl(url), { shared: true });
      rfb.scaleViewport = true;
      rfb.addEventListener("connect", () => onStatus("Connected: click the screen to type"));
      rfb.addEventListener("disconnect", (event) => onStatus(event.detail?.clean ? "Disconnected" : "The connection dropped"));
    })().catch((error) => onStatus(`The console could not load: ${String(error)}`));
    return () => {
      cancelled = true;
      rfb?.disconnect();
    };
  }, [url, onStatus]);
  return <div ref={holder} style={{ width: "100%", height: "100%", background: "#000" }} />;
}

function Terminal({ url }: { url: string }) {
  const holder = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    void (async () => {
      const { Terminal: XTerm } = await import("@xterm/xterm");
      if (disposed || !holder.current) return;
      const term = new XTerm({ convertEol: false, fontSize: 13, cols: 100, rows: 28, theme: { background: "#05070c" } });
      term.open(holder.current);
      const ws = new WebSocket(socketUrl(url));
      ws.onmessage = (event) => term.write(String(event.data));
      ws.onclose = () => term.write("\r\n[console closed]\r\n");
      const input = term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
      });
      term.focus();
      cleanup = () => {
        input.dispose();
        ws.close();
        term.dispose();
      };
    })();
    return () => {
      disposed = true;
      cleanup();
    };
  }, [url]);
  return <div ref={holder} style={{ width: "100%", overflow: "auto", background: "#05070c", padding: 6, borderRadius: 6 }} />;
}

export default function VmConsole({ vm }: { vm: LabVm }) {
  const toast = useToast();
  const [links, setLinks] = useState<{ vnc: string; serial: string } | null>(null);
  const [tab, setTab] = useState<"screen" | "terminal">("screen");
  const [status, setStatus] = useState("Connecting…");
  const [shot, setShot] = useState<string | null>(null);
  const [read, setRead] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const frame = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.labConsole(vm.id).then(setLinks).catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
  }, [vm.id, vm.startedAt]);

  const readScreen = async () => {
    try {
      const result = await api.labReadScreen(vm.id);
      setRead(result.text || "(no text found on the screen)");
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    }
  };

  const sendTyped = async () => {
    try {
      await api.labKeys(vm.id, { text: typed });
      setTyped("");
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    }
  };

  const screenshot = async () => {
    try {
      const result = await api.labScreenshot(vm.id);
      setShot(onMachine(result.url));
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    }
  };

  return (
    <div style={{ marginTop: 10 }}>
      <div className="btn-row" style={{ marginBottom: 6, alignItems: "center" }}>
        <button className={`btn small ${tab === "screen" ? "primary" : "ghost"}`} onClick={() => setTab("screen")}>Screen</button>
        <button className={`btn small ${tab === "terminal" ? "primary" : "ghost"}`} onClick={() => setTab("terminal")}>Terminal</button>
        {tab === "screen" ? (
          <>
            <button className="btn small ghost" onClick={() => void frame.current?.requestFullscreen?.()}>Full screen</button>
            <button className="btn small ghost" onClick={() => void api.labKeys(vm.id, { combos: [["ctrl", "alt", "delete"]] }).catch(() => undefined)}>Ctrl+Alt+Del</button>
            <button className="btn small ghost" onClick={() => void screenshot()}>Screenshot</button>
            <button className="btn small ghost" onClick={() => void readScreen()}>What does it say?</button>
            <span className="small muted">{status}</span>
          </>
        ) : (
          <span className="small muted">The VM's serial console, shared with the agents</span>
        )}
      </div>
      {links ? (
        tab === "screen" ? (
          <div ref={frame} style={{ width: "100%", height: "62vh", minHeight: 320 }}>
            <Screen url={links.vnc} onStatus={setStatus} />
          </div>
        ) : (
          <Terminal url={links.serial} />
        )
      ) : null}
      {tab === "screen" ? (
        <div className="learn-plan" style={{ marginTop: 6 }}>
          <input className="input" style={{ flex: 1 }} placeholder="Paste text here to type it into the VM" value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === "Enter" && typed && void sendTyped()} />
          <button className="btn small" disabled={!typed} onClick={() => void sendTyped()}>Type it</button>
        </div>
      ) : null}
      {read ? <p className="small" style={{ marginTop: 6 }}><strong>The screen says:</strong> {read}</p> : null}
      {shot ? (
        <a href={shot} target="_blank" rel="noreferrer">
          <img alt="The VM's screen" src={shot} style={{ maxWidth: 320, marginTop: 8, borderRadius: 6 }} />
        </a>
      ) : null}
    </div>
  );
}
