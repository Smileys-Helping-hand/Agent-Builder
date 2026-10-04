"use client";

/**
 * Review before handover: everything needed to check an order's build and
 * hand it over with confidence, in one place.
 *
 *  1. The site itself, live, at phone/tablet/desktop width. Anything the page
 *     reports while you click through (script errors, failed loads) is caught.
 *  2. The automatic checks, and "Test & audit" for a deeper look.
 *  3. The customer's brief as a checklist to tick off against what you see.
 *  4. Share it with the customer to run through themselves, ask for changes
 *     (another pass with your instruction), or hand it over.
 */
import { useEffect, useMemo, useState } from "react";

import { api, type Build, type BuildAudit, type Order, type PreviewReport } from "@/lib/api";
import { Checks } from "../build/parts";
import { PreviewPane } from "../preview";
import { Banner, Busy, Icon, useToast } from "../ui";

/** The brief, split into things you can check off. */
const briefItems = (brief: string): string[] => {
  const lines = brief
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*([-*•]|\d+[.)])\s+/, "").trim())
    .filter((line) => line.length >= 8 && !/^choices made in the live customiser:?$/i.test(line));
  const items = lines.length >= 3 ? lines : brief.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter((part) => part.length >= 12);
  return Array.from(new Set(items)).slice(0, 16);
};

const loadTicks = (orderId: string): Record<number, boolean> => {
  try {
    return JSON.parse(localStorage.getItem(`review.${orderId}`) ?? "{}") as Record<number, boolean>;
  } catch {
    return {};
  }
};

export function ReviewPanel({ order, onChanged }: { order: Order; onChanged: () => Promise<unknown> | void }) {
  const toast = useToast();
  const [build, setBuild] = useState<Build | null>(null);
  const [reports, setReports] = useState<PreviewReport[]>([]);
  const [audit, setAudit] = useState<BuildAudit | null>(null);
  const [ticks, setTicks] = useState<Record<number, boolean>>({});
  const [shared, setShared] = useState<string | null>(null);
  const [changes, setChanges] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const items = useMemo(() => briefItems(order.brief), [order.brief]);
  const buildId = order.buildId;

  useEffect(() => setTicks(loadTicks(order.id)), [order.id]);
  useEffect(() => {
    if (!buildId) return;
    void api
      .build(buildId)
      .then((value) => {
        setBuild(value);
        setAudit(value.audit ?? null);
      })
      .catch(() => undefined);
  }, [buildId]);

  if (!buildId) return null;

  const tick = (index: number) => {
    const next = { ...ticks, [index]: !ticks[index] };
    setTicks(next);
    try {
      localStorage.setItem(`review.${order.id}`, JSON.stringify(next));
    } catch {
      // Private mode: the ticks last for this visit.
    }
  };
  const ticked = items.filter((_, index) => ticks[index]).length;
  const best = build?.iterationDetail?.slice().sort((a, b) => b.objectiveScore - a.objectiveScore)[0];
  const allTicked = items.length > 0 && ticked === items.length;

  const run = async (key: string, label: string, work: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await work();
      if (label) toast(label, "ok");
      await onChanged();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="review">
      <div className="review-step">
        <span className="review-n">1</span>
        <div className="review-body">
          <strong>Click through the site</strong>
          <small>Try every page and button on phone and desktop. Problems the page reports are listed under it.</small>
          <PreviewPane kind="build" id={buildId} height={520} title={`${order.title} preview`} onReports={setReports} />
          {reports.length > 0 ? (
            <Banner kind="error">
              {reports.length} problem(s) while clicking through: {reports.slice(0, 3).map((r) => r.message).join(" · ")}
            </Banner>
          ) : null}
        </div>
      </div>

      <div className="review-step">
        <span className="review-n">2</span>
        <div className="review-body">
          <strong>Automatic checks</strong>
          <small>
            Best pass scored {Math.round(build?.bestScore ?? order.qualityScore)}/100.
            {audit ? ` Last Test & audit: ${audit.passed ? "every check passes" : `${audit.blocker?.name ?? "a check"} fails`}, ${audit.findings.filter((f) => f.severity !== "info").length} problem(s) on the site.` : ""}
          </small>
          <Checks checks={(audit?.checks?.length ? audit.checks : best?.checks) ?? []} />
          <button
            className="btn small"
            disabled={busy !== null}
            onClick={() =>
              run("audit", "", async () => {
                const result = await api.auditBuild(buildId, reports);
                setAudit(result.audit);
                toast(result.audit.passed ? "Every check passes." : `${result.audit.blocker?.name ?? "A check"} fails — see the list.`, result.audit.passed ? "ok" : "error");
              })
            }
          >
            {busy === "audit" ? <Busy label="Testing… (a few minutes)" /> : <>{Icon.stethoscope} Test & audit again</>}
          </button>
          {audit?.findings?.length ? (
            <ul className="review-findings">
              {audit.findings
                .filter((f) => f.severity !== "info")
                .slice(0, 8)
                .map((f, i) => (
                  <li key={i} className={f.severity}>
                    {f.message}
                    {f.file ? <small> — {f.file}</small> : null}
                  </li>
                ))}
            </ul>
          ) : null}
        </div>
      </div>

      <div className="review-step">
        <span className="review-n">3</span>
        <div className="review-body">
          <strong>
            What the customer asked for · {ticked}/{items.length}
          </strong>
          <small>Tick each one off as you see it working in the preview.</small>
          <ul className="review-checklist">
            {items.map((item, index) => (
              <li key={index}>
                <label>
                  <input type="checkbox" checked={Boolean(ticks[index])} onChange={() => tick(index)} />
                  <span>{item}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="review-step">
        <span className="review-n">4</span>
        <div className="review-body">
          <strong>Decide</strong>
          <div className="btn-row">
            <button
              className="btn"
              disabled={busy !== null}
              onClick={() =>
                run("share", "", async () => {
                  const result = await api.shareOrderPreview(order.id);
                  setShared(result.previewUrl);
                  toast(result.sentToSite ? "Sent: it is on their dashboard and they get an email." : "Link ready to send.", "ok");
                })
              }
            >
              {busy === "share" ? <Busy label="Sharing…" /> : <>{Icon.external} Share preview with customer</>}
            </button>
            <button
              className={`btn ${allTicked && reports.length === 0 ? "primary" : ""}`}
              disabled={busy !== null}
              onClick={() => {
                if (!allTicked && !window.confirm(`Only ${ticked} of ${items.length} items are ticked. Hand it over anyway?`)) return;
                void run("deliver", "Handed over. The customer has a receipt and a link.", () => api.deliverOrder(order.id));
              }}
            >
              {busy === "deliver" ? <Busy label="Handing over…" /> : <>{Icon.check} Hand it over</>}
            </button>
          </div>
          {shared ? (
            <div className="review-share">
              <input readOnly value={shared} onFocus={(event) => event.currentTarget.select()} />
              <button className="btn small" onClick={() => void navigator.clipboard.writeText(shared).then(() => toast("Copied.", "ok"))}>
                {Icon.copy} Copy
              </button>
            </div>
          ) : null}
          <label className="field" style={{ marginTop: 10 }}>
            <span>Or ask for changes (starts another pass with your instruction)</span>
            <textarea rows={2} value={changes} onChange={(event) => setChanges(event.target.value)} placeholder="e.g. Make the booking button bigger and put opening hours on the home page." />
          </label>
          <button
            className="btn"
            disabled={busy !== null || changes.trim().length < 8}
            onClick={() =>
              run("changes", "Another pass started with your instruction.", async () => {
                await api.buildOrder(order.id);
                // The new pass picks the instruction up as soon as it is running.
                for (let tries = 0; tries < 10; tries++) {
                  try {
                    await api.instructOrder(order.id, changes.trim());
                    break;
                  } catch {
                    await new Promise((resolve) => setTimeout(resolve, 1500));
                  }
                }
                setChanges("");
              })
            }
          >
            {busy === "changes" ? <Busy label="Starting…" /> : <>{Icon.sparkle} Make these changes</>}
          </button>
        </div>
      </div>
    </div>
  );
}
