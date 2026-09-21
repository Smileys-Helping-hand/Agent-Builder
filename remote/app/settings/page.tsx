"use client";

import { useEffect, useState } from "react";

import { clearConnection, loadConnection, saveConnection, testConnection } from "@/lib/api";
import { Banner, Busy, Header } from "../ui";

export default function Settings() {
  const [address, setAddress] = useState("");
  const [key, setKey] = useState("");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const existing = loadConnection();
    if (existing) {
      setAddress(existing.address);
      setKey(existing.key);
    }
  }, []);

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
