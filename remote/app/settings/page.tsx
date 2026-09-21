"use client";

import { useEffect, useState } from "react";

import Link from "next/link";

import { api, clearConnection, loadConnection, saveConnection, testConnection } from "@/lib/api";
import { Banner, Busy, Header } from "../ui";

export default function Settings() {
  const [address, setAddress] = useState("");
  const [key, setKey] = useState("");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saved, setSaved] = useState(false);

  const [shuttingDown, setShuttingDown] = useState(false);
  const [shutdownNote, setShutdownNote] = useState<string | null>(null);

  useEffect(() => {
    // The launcher's QR code carries the address and key, so scanning it
    // connects this device without anyone typing a 64-character key on a phone.
    const params = new URLSearchParams(window.location.search);
    const fromLink = { address: params.get("address") ?? "", key: params.get("key") ?? "" };
    if (fromLink.address && fromLink.key) {
      saveConnection(fromLink);
      setAddress(fromLink.address);
      setKey(fromLink.key);
      setSaved(true);
      // Drop the credentials out of the address bar once they are stored.
      window.history.replaceState({}, "", window.location.pathname);
      void testConnection(fromLink.address, fromLink.key).then(setResult);
      return;
    }
    const existing = loadConnection();
    if (existing) {
      setAddress(existing.address);
      setKey(existing.key);
    }
  }, []);

  const shutDown = async () => {
    setShuttingDown(true);
    setShutdownNote(null);
    try {
      const result = await api.shutdown();
      setShutdownNote(result.message);
    } catch (error) {
      setShutdownNote(error instanceof Error ? error.message : String(error));
    } finally {
      setShuttingDown(false);
    }
  };

  const check = async () => {
    setTesting(true);
    setResult(null);
    setResult(await testConnection(address, key));
    setTesting(false);
  };

  const save = () => {
    saveConnection({ address, key });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const forget = () => {
    clearConnection();
    setAddress("");
    setKey("");
    setResult(null);
  };

  return (
    <>
      <Header title="Settings" sub="Where your machine lives, and the key to reach it" />
      <div className="wrap">
        <div className="card">
          <h2>Connection</h2>
          <p className="hint">Stored on this device only. Nothing is sent anywhere else.</p>

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

          <div className="btn-row">
            <button className="btn" onClick={check} disabled={testing || !address || !key}>
              {testing ? <Busy label="Testing…" /> : "Test"}
            </button>
            <button className="btn primary" onClick={save} disabled={!address || !key}>
              Save
            </button>
            {loadConnection() ? (
              <button className="btn ghost" onClick={forget}>
                Forget
              </button>
            ) : null}
          </div>

          {result ? <Banner kind={result.ok ? "ok" : "error"}>{result.message}</Banner> : null}
          {saved ? <Banner kind="ok">Saved on this device.</Banner> : null}
        </div>

        <div className="card">
          <h2>New here?</h2>
          <p className="hint">A short, plain-language walkthrough of starting, using and stopping everything.</p>
          <Link href="/help">
            <button className="btn primary">How this works</button>
          </Link>
        </div>

        <div className="card">
          <h2>How to reach your machine from anywhere</h2>
          <p className="hint">Pick one. The first is the easiest to keep secure.</p>

          <div className="row">
            <span className="pill up" />
            <div className="body">
              <strong>Tailscale (recommended)</strong>
              <span>
                Install it on the PC and this phone, both signed into the same account. Then use the PC&apos;s tailnet
                address, e.g. <code>http://100.x.y.z:4000</code>. Nothing is exposed to the internet.
              </span>
            </div>
          </div>

          <div className="row">
            <span className="pill degraded" />
            <div className="body">
              <strong>Cloudflare Tunnel</strong>
              <span>
                <code>cloudflared tunnel --url http://127.0.0.1:4000</code> gives you an https address that works
                anywhere. It is public, so the key is the only thing protecting it — keep it secret and rotate it if in
                doubt.
              </span>
            </div>
          </div>

          <div className="row">
            <span className="pill up" />
            <div className="body">
              <strong>At home</strong>
              <span>
                Your PC&apos;s LAN address, e.g. <code>http://192.168.1.20:4000</code>. Requires the API to listen
                beyond loopback: start it with <code>HOST=0.0.0.0</code>.
              </span>
            </div>
          </div>
        </div>

        <div className="card">
          <h2>Get a key</h2>
          <p className="hint">On the PC, in the Agent Builder folder:</p>
          <pre className="md">npm run key:agent -- --name phone --scopes read,write,execute</pre>
          <p className="hint" style={{ marginTop: 10, marginBottom: 0 }}>
            It prints the key once. Paste it above. Rerun the command any time to replace it — the old one stops working
            immediately.
          </p>
        </div>

        <div className="card">
          <h2>Shut the builder down</h2>
          <p className="hint">
            Stops it completely on the PC. Nothing here can start it again — you will need the launcher on the machine
            itself. To free the GPU without losing access, use <strong>Pause work</strong> on Home instead.
          </p>
          <button className="btn" onClick={shutDown} disabled={shuttingDown}>
            {shuttingDown ? <Busy label="Shutting down…" /> : "Shut down the builder"}
          </button>
          {shutdownNote ? <Banner kind="info">{shutdownNote}</Banner> : null}
        </div>

        <div className="card">
          <h2>Install as an app</h2>
          <p className="hint" style={{ marginBottom: 0 }}>
            Android or desktop Chrome: menu → <em>Install app</em> (or <em>Add to Home screen</em>). iPhone: Share →{" "}
            <em>Add to Home Screen</em>. It then opens full screen, like any other app.
          </p>
        </div>
      </div>
    </>
  );
}
