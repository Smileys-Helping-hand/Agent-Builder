"use client";

import { useCallback, useEffect, useState } from "react";

import { loadConnection, saveConnection, servedByBuilder, testConnection, type ConnectionReport } from "@/lib/api";
import { Busy, Icon, useToast } from "../ui";

type Line = { ok: boolean | null; title: string; detail: string };

const HOSTED_APP_HOSTS = ["builder.arpcloudsolutions.co.za", "agent-builder-remote.vercel.app"];

const isLoopback = (address: string) => /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/i.test(address);

/**
 * Checks, in the order they can go wrong, that this device is talking to the
 * right builder: the address makes sense from here, the builder answers, the
 * key is accepted, and the services a build needs are up on that machine.
 */
export const ConnectionCheck = () => {
  const toast = useToast();
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [report, setReport] = useState<ConnectionReport | null>(null);

  const [saved, setSaved] = useState<{ address: string; key: string } | null>(null);
  const address = saved?.address ?? "";
  const keyValue = saved?.key ?? "";

  // The saved connection, not whatever is being typed in the form above.
  useEffect(() => setSaved(loadConnection()), []);

  const check = useCallback(async () => {
    if (!address) return;
    setRunning(true);
    const found: Line[] = [];
    const here = window.location;
    const builderHere = await servedByBuilder();

    found.push({
      ok: true,
      title: "This app",
      detail: builderHere
        ? `Served by a builder at ${builderHere}.`
        : HOSTED_APP_HOSTS.includes(here.hostname)
          ? `The hosted app (${here.host}). It only shows the interface; everything runs on your PC.`
          : `Opened from ${here.origin}.`
    });

    let target: URL | null = null;
    try {
      target = new URL(address);
    } catch {
      found.push({ ok: false, title: "Address", detail: `"${address}" is not a web address. It should look like https://agent.savestate.co.za.` });
    }

    if (target) {
      if (HOSTED_APP_HOSTS.includes(target.hostname)) {
        found.push({
          ok: false,
          title: "Address",
          detail: `${target.host} is this app, not your PC. Use your builder's address: https://agent.savestate.co.za, the Tailscale 100.x address, or http://127.0.0.1:4000 on the PC.`
        });
      } else if (isLoopback(address) && !isLoopback(here.origin)) {
        found.push({
          ok: false,
          title: "Address",
          detail: "127.0.0.1 means \"this device\". It only works in a browser on the PC itself — from a phone use agent.savestate.co.za or the Tailscale address."
        });
      } else if (here.protocol === "https:" && target.protocol === "http:" && !isLoopback(address)) {
        found.push({
          ok: false,
          title: "Address",
          detail: "This page is https and the address is http, so the browser blocks every call. Use an https address, or the installed app with Tailscale."
        });
      } else {
        found.push({ ok: true, title: "Address", detail: `${target.origin} makes sense from this device.` });
      }
    }

    const outcome = await testConnection(address, keyValue);
    setReport(outcome);
    found.push({
      ok: outcome.ok,
      title: "Builder",
      detail: outcome.ok ? `${outcome.message} Answered in ${outcome.latencyMs} ms.` : outcome.message
    });

    const status = outcome.status;
    if (status) {
      for (const service of status.services) {
        found.push({
          ok: service.state === "up" ? true : service.state === "degraded" || service.state === "unknown" ? null : false,
          title: service.label,
          detail: service.detail
        });
      }
      if (status.publicUrl && target && new URL(status.publicUrl).origin !== target.origin) {
        found.push({
          ok: null,
          title: "Public address",
          detail: `The builder says it is also reachable at ${status.publicUrl}.`
        });
      }
    }

    setLines(found);
    setRunning(false);
  }, [address, keyValue]);

  useEffect(() => {
    void check();
  }, [check]);

  const publicUrl = report?.status?.publicUrl ?? null;
  const canSwitch = Boolean(publicUrl && !address.startsWith(publicUrl));

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <h2 style={{ margin: 0 }}>Connection check</h2>
        <button className="btn small" onClick={() => void check()} disabled={running}>
          {running ? <Busy label="Checking" /> : <>{Icon.refresh} Check again</>}
        </button>
      </div>
      <p className="hint" style={{ marginTop: 6 }}>Is this device talking to the right builder, and is that builder ready to build?</p>
      <div className="diag">
        {(lines ?? []).map((line, index) => (
          <div key={`${line.title}-${index}`} className="row">
            <span className={`pill ${line.ok === true ? "up" : line.ok === false ? "down" : "degraded"}`} />
            <div className="body">
              <strong>{line.title}</strong>
              <span>{line.detail}</span>
            </div>
          </div>
        ))}
        {!lines && running ? <div className="empty">Checking…</div> : null}
      </div>
      {canSwitch && publicUrl ? (
        <button
          className="btn"
          style={{ marginTop: 10 }}
          onClick={() => {
            saveConnection({ address: publicUrl, key: keyValue });
            toast(`Now using ${publicUrl}`, "ok");
            window.location.reload();
          }}
        >
          {Icon.plug} Use {publicUrl.replace(/^https?:\/\//, "")} instead
        </button>
      ) : null}
    </div>
  );
};
