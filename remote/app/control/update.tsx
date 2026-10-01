"use client";

/** Control → Update the builder: what the PC runs, what is new, and the update itself. */
import { useEffect, useState } from "react";

import { api, type UpdateJob } from "@/lib/api";
import { useBuilderVersion } from "../builder-version";
import { Banner, Busy, Icon, ago, useToast } from "../ui";

export const UpdateCard = () => {
  const toast = useToast();
  const { info, tooOld, behind, refresh } = useBuilderVersion();
  const [job, setJob] = useState<UpdateJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);

  // Follow a running update; once the builder restarts, it answers again with the new version.
  useEffect(() => {
    if (!job || job.state !== "running" && !job.restarting) return;
    const timer = setInterval(async () => {
      try {
        const next = await api.updateStatus();
        if (next.job) setJob(next.job);
        else if (job.restarting) {
          setJob({ ...job, restarting: false, message: "Back up, on the new version." });
          await refresh(true);
        }
      } catch {
        // Restarting: not answering for a few seconds is expected.
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [job, refresh]);

  const start = async (force = false) => {
    setBusy(true);
    try {
      const result = await api.updateBuilder(force);
      if (result.job) setJob(result.job);
      toast(result.message ?? "Updating", "ok");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/Update anyway\?$/.test(message) && window.confirm(message)) {
        setBusy(false);
        return start(true);
      }
      toast(message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" id="update">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Update the builder</h2>
        <button
          className="btn small ghost"
          disabled={checking}
          onClick={async () => {
            setChecking(true);
            await refresh(true);
            setChecking(false);
          }}
        >
          {checking ? <Busy label="Checking" /> : <>{Icon.refresh} Check now</>}
        </button>
      </div>

      {tooOld ? (
        <Banner kind="info">
          The builder on the PC is older than the app&apos;s update button, so this one time it has to be done at the PC: open the
          Agent Builder folder, run <code>git pull</code>, then Stop and Start Agent Builder. After that, updates happen from here.
        </Banner>
      ) : !info ? (
        <p className="hint">Checking what the PC runs…</p>
      ) : !info.available ? (
        <Banner kind="info">{info.reason}</Banner>
      ) : (
        <>
          <p className="hint" style={{ marginTop: 6 }}>
            Running <code>{info.commit}</code> on <code>{info.branch}</code> — “{info.subject}” ({info.date ? ago(info.date) : "?"}).
            {info.dirty ? ` ${info.dirty} file(s) changed on the PC and not committed.` : ""}
            {info.fetchError ? ` Could not check GitHub: ${info.fetchError}` : info.checkedAt ? ` Checked GitHub ${ago(info.checkedAt)}.` : ""}
          </p>
          {behind > 0 ? (
            <>
              <p className="small" style={{ margin: "4px 0 6px", fontWeight: 650 }}>
                {behind} update{behind === 1 ? "" : "s"} waiting:
              </p>
              <ul className="update-list">
                {info.incoming.map((entry) => (
                  <li key={entry.commit}>
                    <code>{entry.commit}</code> {entry.subject} <span className="muted">· {ago(entry.date)}</span>
                  </li>
                ))}
              </ul>
              <button className="btn primary" disabled={busy || job?.state === "running"} onClick={() => start()}>
                {busy || job?.state === "running" ? <Busy label="Updating" /> : <>{Icon.refresh} Update and restart</>}
              </button>
              <p className="muted small" style={{ marginTop: 8 }}>
                Pulls the new code (only as a fast-forward: it never overwrites changes made on the PC), installs packages if they
                changed, rebuilds the PC&apos;s copy of the app, and restarts through the launcher.
              </p>
            </>
          ) : (
            <p className="small" style={{ color: "var(--good)" }}>Up to date with {info.upstream}.</p>
          )}
        </>
      )}

      {job ? (
        <div className="update-job">
          {job.steps.map((entry, index) => (
            <div key={index} className={entry.ok ? "" : "bad"}>
              {entry.ok ? "✓" : "✗"} {entry.text}
            </div>
          ))}
          {job.restarting ? <div><Busy label="Restarting — waiting for it to answer" /></div> : null}
        </div>
      ) : null}
    </div>
  );
};
