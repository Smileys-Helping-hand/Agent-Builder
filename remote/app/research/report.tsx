"use client";

/**
 * "Teach me what you have learned": one report across every topic and every
 * lesson the builds taught it, to read, print or keep — and to hand on, so the
 * builder follows its rules in future builds and Jarvis can recall it.
 */
import { useEffect, useRef, useState } from "react";

import { api, type LearningReport } from "@/lib/api";
import { Banner, Busy, Icon, ago, useRemote, useToast } from "../ui";
import { Markdown } from "./workspace";

export const LearningReportCard = () => {
  const toast = useToast();
  const reports = useRemote(() => api.learningReports(), 0, "learning-reports");
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [rules, setRules] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);

  const list = reports.data?.reports ?? [];
  const job = reports.data?.job ?? null;
  const writing = job?.state === "running";
  const report: LearningReport | null = list.find((entry) => entry.id === selected) ?? list[0] ?? null;

  // Follow the report while it is being written.
  useEffect(() => {
    if (!writing) return;
    const timer = setInterval(() => void reports.refresh(), 3000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [writing]);

  // A newly written report opens itself.
  const lastJob = useRef<string | null>(null);
  useEffect(() => {
    if (job?.state === "done" && job.reportId && lastJob.current !== job.reportId) {
      if (lastJob.current !== null) {
        setSelected(job.reportId);
        setExpanded(true);
      }
      lastJob.current = job.reportId;
    } else if (job && lastJob.current === null) lastJob.current = job.reportId ?? "";
  }, [job]);

  useEffect(() => {
    setRules(Object.fromEntries((report?.rules ?? []).map((rule) => [rule, true])));
  }, [report?.id, report?.rules]);

  const chosen = (report?.rules ?? []).filter((rule) => rules[rule]);

  const act = async (key: string, work: () => Promise<void>) => {
    setBusy(key);
    try {
      await work();
      await reports.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(null);
    }
  };

  const print = () => {
    if (!report || !body.current) return;
    const win = window.open("", "_blank");
    if (!win) return toast("Your browser blocked the print window.", "error");
    win.document.write(
      `<!doctype html><meta charset="utf-8"><title>${report.title.replace(/</g, "&lt;")}</title><style>body{font:15px/1.6 Georgia,serif;max-width:720px;margin:40px auto;padding:0 20px;color:#111}h2,h3,h4{font-family:system-ui,sans-serif}a{color:#0b5cad}li{margin:4px 0}</style>${body.current.innerHTML}`
    );
    win.document.close();
    win.focus();
    win.print();
  };

  const download = () => {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([report.markdown], { type: "text/markdown" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${report.id}.md`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  return (
    <section className="card report-card">
      <div className="report-head">
        <div>
          <strong style={{ fontSize: 16 }}>Teach me what you have learned</strong>
          <p className="muted small" style={{ margin: "3px 0 0" }}>
            One report across every topic and what the builds taught it: explained simply, the rules it now follows, what it is unsure about, and
            questions to test yourself. Then hand it on, so the builder and Jarvis keep getting better.
          </p>
        </div>
        <button className="btn primary" disabled={writing || busy !== null} onClick={() => act("write", async () => void (await api.writeLearningReport()))}>
          {writing ? <Busy label="Writing…" /> : <>{Icon.sparkle} {list.length ? "Write a new report" : "Write the report"}</>}
        </button>
      </div>

      {writing ? <p className="muted small report-step">{job?.step}</p> : null}
      {job?.state === "failed" && job.error ? <Banner kind="error">{job.error}</Banner> : null}
      {reports.error && !reports.data ? <Banner kind="error">{reports.error}</Banner> : null}

      {report ? (
        <>
          <div className="report-meta">
            {list.length > 1 ? (
              <select value={report.id} onChange={(event) => setSelected(event.target.value)} aria-label="Earlier reports">
                {list.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.title} · {ago(entry.createdAt)}
                  </option>
                ))}
              </select>
            ) : (
              <span className="muted small">
                {report.title} · {ago(report.createdAt)}
              </span>
            )}
            <span className="chips">
              <span className="chip accent">{report.stats.findings} findings</span>
              <span className="chip">{report.stats.confirmed} confirmed</span>
              {report.stats.contested ? <span className="chip warn">{report.stats.contested} contested</span> : null}
              <span className="chip">{report.stats.lessons} build lessons</span>
              <span className="chip">{report.writtenBy === "model" ? "written by the model" : "plain (no model)"}</span>
            </span>
          </div>

          <div className={`report-body ${expanded ? "open" : ""}`} ref={body}>
            <Markdown text={report.markdown} />
          </div>
          <div className="btn-row">
            <button className="btn small" onClick={() => setExpanded((value) => !value)}>
              {expanded ? "Show less" : "Read it all"}
            </button>
            <button className="btn small ghost" onClick={print}>
              Print / save as PDF
            </button>
            <button className="btn small ghost" onClick={download}>
              Download .md
            </button>
            <button
              className="btn small ghost"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(report.markdown);
                  toast("Copied the report", "ok");
                } catch {
                  toast("Could not copy on this device", "error");
                }
              }}
            >
              {Icon.copy} Copy
            </button>
          </div>

          <div className="report-handon">
            <div>
              <strong>Teach the builder</strong>
              <p className="muted small" style={{ margin: "2px 0 8px" }}>
                Each rule becomes a build lesson. Builds whose task it fits get it in their instructions, and it is scored on whether the build then
                passed — rules that do not help fade out on their own.
              </p>
              {report.rules.length ? (
                <ul className="rule-list">
                  {report.rules.map((rule) => (
                    <li key={rule}>
                      <label>
                        <input type="checkbox" checked={Boolean(rules[rule])} onChange={(event) => setRules((current) => ({ ...current, [rule]: event.target.checked }))} />
                        <span>{rule}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small">This report has no rules to teach.</p>
              )}
              <div className="btn-row">
                <button
                  className="btn small primary"
                  disabled={!chosen.length || busy !== null}
                  onClick={() =>
                    act("teach", async () => {
                      const res = await api.teachBuilder(report.id, chosen);
                      toast(`The builder learned ${res.taught} rule${res.taught === 1 ? "" : "s"}. They show under "What the builder has learned".`, "ok");
                    })
                  }
                >
                  {busy === "teach" ? <Busy label="Teaching…" /> : <>{Icon.check} Teach the builder {chosen.length ? `(${chosen.length})` : ""}</>}
                </button>
                {report.taughtAt ? (
                  <span className="muted small">
                    Taught {report.taughtCount} rule{report.taughtCount === 1 ? "" : "s"} {ago(report.taughtAt)}
                  </span>
                ) : null}
              </div>
            </div>
            <div>
              <strong>Send to Jarvis</strong>
              <p className="muted small" style={{ margin: "2px 0 8px" }}>
                Stored in Second-Brain&apos;s knowledge, which Jarvis recalls from, and sent to him so he knows it is there.
              </p>
              <div className="btn-row">
                <button
                  className="btn small"
                  disabled={busy !== null}
                  onClick={() =>
                    act("jarvis", async () => {
                      const res = await api.sendReportToJarvis(report.id);
                      toast(`${res.knowledge}; ${res.webhook}.`, res.ok ? "ok" : "info");
                    })
                  }
                >
                  {busy === "jarvis" ? <Busy label="Sending…" /> : <>{Icon.external} Send to Jarvis</>}
                </button>
                {report.sentToJarvisAt ? <span className="muted small">Sent {ago(report.sentToJarvisAt)}: {report.sentResult}</span> : null}
              </div>
            </div>
          </div>
        </>
      ) : !writing && reports.data ? (
        <p className="muted small" style={{ marginTop: 10 }}>
          No report yet. Write one any time: it uses whatever the research has found so far.
        </p>
      ) : null}
    </section>
  );
};
