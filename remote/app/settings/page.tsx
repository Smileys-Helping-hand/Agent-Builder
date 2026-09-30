"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { api, clearConnection, loadConnection, saveConnection, testConnection } from "@/lib/api";
import { Banner, Busy, Header, Icon, useToast } from "../ui";
import { BuilderSettings } from "./builder";
import { ConnectionCheck } from "./check";

/**
 * Pull an address and key out of whatever was pasted: the whole connection link
 * from the QR code, or just the two values. Typing a 67-character key on a
 * phone is the thing this screen exists to avoid.
 */
const parsePasted = (text: string): { address: string; key: string } | null => {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    const address = url.searchParams.get("address");
    const key = url.searchParams.get("key");
    if (address && key) return { address, key };
  } catch {
    // Not a URL - fall through to the loose match below.
  }
  const address = trimmed.match(/https?:\/\/[^\s"'<>]+/)?.[0];
  const key = trimmed.match(/ab_[a-f0-9]{64}/)?.[0];
  if (address && key) return { address: address.replace(/[?&]key=.*$/, ""), key };
  return null;
};

export default function Settings() {
  const toast = useToast();
  const [address, setAddress] = useState("");
  const [key, setKey] = useState("");
  const [pasted, setPasted] = useState("");
  const [manual, setManual] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [connected, setConnected] = useState(false);
  const [shuttingDown, setShuttingDown] = useState(false);
  // Bumped whenever a new connection is saved, so the check runs against it.
  const [checkVersion, setCheckVersion] = useState(0);

  useEffect(() => {
    // The launcher's QR code carries the address and key, so scanning it
    // connects this device without anyone typing anything.
    const params = new URLSearchParams(window.location.search);
    const fromLink = { address: params.get("address") ?? "", key: params.get("key") ?? "" };
    if (fromLink.address && fromLink.key) {
      saveConnection(fromLink);
      setAddress(fromLink.address);
      setKey(fromLink.key);
      setConnected(true);
      window.history.replaceState({}, "", window.location.pathname);
      void testConnection(fromLink.address, fromLink.key).then((outcome) => {
        setResult(outcome);
        toast(outcome.ok ? "Connected" : outcome.message, outcome.ok ? "ok" : "error");
      });
      return;
    }
    const existing = loadConnection();
    if (existing) {
      setAddress(existing.address);
      setKey(existing.key);
      setConnected(true);
    }
    // A link with only the address (the "Connect" button) fills it in and
    // waits for the key, which is never part of a public link.
    if (fromLink.address && !fromLink.key) {
      setAddress(fromLink.address);
      setManual(true);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [toast]);

  const connectFromPaste = async () => {
    const parsed = parsePasted(pasted);
    if (!parsed) {
      toast("That does not look like a connection link", "error");
      return;
    }
    setTesting(true);
    const outcome = await testConnection(parsed.address, parsed.key);
    setResult(outcome);
    if (outcome.ok) {
      saveConnection(parsed);
      setAddress(parsed.address);
      setKey(parsed.key);
      setConnected(true);
      setPasted("");
      setCheckVersion((value) => value + 1);
      toast("Connected", "ok");
    } else {
      toast(outcome.message, "error");
    }
    setTesting(false);
  };

  const saveManual = async () => {
    setTesting(true);
    const outcome = await testConnection(address, key);
    setResult(outcome);
    if (outcome.ok) {
      saveConnection({ address, key });
      setConnected(true);
      setCheckVersion((value) => value + 1);
      toast("Connected", "ok");
    } else {
      toast(outcome.message, "error");
    }
    setTesting(false);
  };

  const forget = () => {
    clearConnection();
    setAddress("");
    setKey("");
    setConnected(false);
    setResult(null);
    toast("This device is no longer connected");
  };

  const shutDown = async () => {
    setShuttingDown(true);
    try {
      const outcome = await api.shutdown();
      toast(outcome.message, "info");
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setShuttingDown(false);
    }
  };

  return (
    <>
      <Header title="Settings" sub={connected ? "Connected to your machine" : "Not connected yet"} state={connected ? "up" : "down"} />

      <div className="wrap">
        {!connected ? (
          <section className="hero">
            <div className="hero-label">Step 1</div>
            <h2 className="hero-title">Scan the QR code</h2>
            <p className="hero-sub">
              On your PC, double-click <strong>Start Agent Builder</strong>. It shows a QR code — scan it with your
              camera and this app connects itself.
            </p>
          </section>
        ) : null}

        <div className="card">
          <h2>{connected ? "Connection" : "Or paste the link"}</h2>
          <p className="hint">
            {connected
              ? `Connected to ${address.replace(/^https?:\/\//, "")}. Stored on this device only.`
              : "Copy the link under the QR code and paste it here - it carries the address and the key."}
          </p>

          {!connected ? (
            <>
              <label className="field">
                <span>Connection link</span>
                <input
                  value={pasted}
                  onChange={(event) => setPasted(event.target.value)}
                  placeholder="https://agent-builder-remote.vercel.app/settings/?address=…"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </label>
              <div className="btn-row">
                <button className="btn primary" onClick={connectFromPaste} disabled={testing || !pasted}>
                  {testing ? <Busy label="Connecting…" /> : <>{Icon.check} Connect</>}
                </button>
                <button className="btn ghost" onClick={() => setManual((value) => !value)}>
                  {manual ? "Hide" : "Enter by hand"}
                </button>
              </div>
            </>
          ) : (
            <div className="btn-row">
              <button className="btn" onClick={() => setManual((value) => !value)}>
                {Icon.gear} {manual ? "Hide details" : "Change address or key"}
              </button>
              <button className="btn ghost" onClick={forget}>
                Forget this device
              </button>
            </div>
          )}

          {manual ? (
            <div className="fade-in" style={{ marginTop: 6 }}>
              <div style={{ marginBottom: 12 }}>
                <small style={{ color: "var(--muted)", display: "block", marginBottom: 6 }}>Quick presets:</small>
                <div className="btn-row" style={{ flexWrap: "wrap", gap: 6 }}>
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => {
                      setAddress("https://agent.savestate.co.za");
                    }}
                  >
                    🌐 agent.savestate.co.za
                  </button>
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => {
                      setAddress("http://127.0.0.1:4000");
                    }}
                  >
                    💻 Localhost:4000
                  </button>
                </div>
              </div>

              <label className="field">
                <span>Address of your machine</span>
                <input
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  placeholder="http://100.x.y.z:4000"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  inputMode="url"
                />
              </label>
              <label className="field">
                <span>Agent key</span>
                <input
                  value={key}
                  onChange={(event) => setKey(event.target.value)}
                  placeholder="ab_…"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  type="password"
                />
              </label>
              <button className="btn primary" onClick={saveManual} disabled={testing || !address || !key}>
                {testing ? <Busy label="Testing…" /> : "Test and save"}
              </button>
            </div>
          ) : null}

          {result ? <Banner kind={result.ok ? "ok" : "error"}>{result.message}</Banner> : null}
        </div>

        {connected ? <ConnectionCheck key={checkVersion} /> : null}

        {connected ? (
          <>
            <div className="section-title">How the builder works</div>
            <BuilderSettings />
          </>
        ) : null}

        <div className="card">
          <h2>New here?</h2>
          <p className="hint">A short walkthrough of starting, using and stopping everything.</p>
          <Link href="/help">
            <button className="btn primary">{Icon.book} How this works</button>
          </Link>
        </div>

        <div className="section-title">Reaching your machine</div>
        <div className="card">
          <div className="row">
            <span className="pill up" />
            <div className="body">
              <strong>Tailscale (address never changes)</strong>
              <span>
                Install it on the PC and this phone, signed into the same account, then use the PC&apos;s
                <code> 100.x.y.z:4000 </code> address. Nothing is exposed to the internet.
              </span>
            </div>
          </div>
          <div className="row">
            <span className="pill degraded" />
            <div className="body">
              <strong>The launcher&apos;s tunnel</strong>
              <span>Works anywhere with no setup, but the address changes each restart - rescan the QR.</span>
            </div>
          </div>
          <div className="row">
            <span className="pill up" />
            <div className="body">
              <strong>At home</strong>
              <span>
                The PC&apos;s Wi-Fi address, e.g. <code>http://192.168.1.20:4000</code>. Start the builder with
                <code> HOST=0.0.0.0</code>.
              </span>
            </div>
          </div>
        </div>

        {connected ? (
          <div className="card">
            <h2>Shut the builder down</h2>
            <p className="hint">
              Stops it completely on the PC. Nothing here can start it again - you would need the launcher on the
              machine. To free the GPU without losing access, use <strong>Pause work</strong> on Home.
            </p>
            <button className="btn danger" onClick={shutDown} disabled={shuttingDown}>
              {shuttingDown ? <Busy label="Shutting down…" /> : "Shut down the builder"}
            </button>
          </div>
        ) : null}

        <div className="card">
          <h2>Install as an app</h2>
          <p className="hint" style={{ marginBottom: 0 }}>
            Android or desktop Chrome: menu → <em>Install app</em>. iPhone: Share → <em>Add to Home Screen</em>. It then
            opens full screen, like any other app.
          </p>
        </div>
      </div>
    </>
  );
}
