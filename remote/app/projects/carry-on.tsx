"use client";

/**
 * Carrying on with projects from the app: cloning one from GitHub, and the
 * builds that work on a copy of a project until you apply what they did.
 */
import { useState } from "react";

import { api, type AccessCheck, type ProjectBuild, type PushPlan } from "@/lib/api";
import { Busy, Icon, ago, useRemote, useToast } from "../ui";
import { BuildLive } from "../build-live";

const STATE_LABEL: Record<ProjectBuild["state"], string> = {
  running: "Working",
  paused: "Paused",
  completed: "Finished",
  ended: "Ended",
  stopped: "Stopped",
  error: "Failed"
};

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Clone a repository onto the PC and, if asked, start on it straight away. */
export function CloneCard({ onClose, onCloned }: { onClose: () => void; onCloned: () => Promise<void> | void }) {
  const toast = useToast();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);

  const clone = async () => {
    setBusy(true);
    try {
      const res = await api.cloneProject({ url: url.trim(), name: name.trim() || undefined, instruction: instruction.trim() || undefined });
      toast(res.message, "ok");
      setUrl("");
      setName("");
      setInstruction("");
      await onCloned();
      onClose();
    } catch (error) {
      toast(errorText(error), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ borderColor: "var(--accent)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong style={{ fontSize: 16 }}>Clone from GitHub</strong>
        <button className="btn small" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <p className="hint" style={{ marginTop: 4 }}>
        Copies the repository onto the PC and adds it to your projects. Give it something to do and it starts straight away.
        Private repositories work once GitHub is signed in on the PC.
      </p>
      <div style={{ display: "grid", gap: 10 }}>
        <input
          placeholder="https://github.com/owner/repo"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
          inputMode="url"
        />
        <input placeholder="Folder name (optional, defaults to the repo name)" value={name} onChange={(event) => setName(event.target.value)} />
        <textarea
          rows={3}
          placeholder="What should it do first? (optional) e.g. Get it running, then add a contact form"
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
        />
        <div className="btn-row">
          <button className="btn primary" onClick={clone} disabled={busy || !url.trim()}>
            {busy ? <Busy label="Cloning…" /> : instruction.trim() ? "Clone and start" : "Clone"}
          </button>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/** One step's status, shown as a chip: not done, working, done, or a problem. */
const Step = ({ n, label, tone, detail }: { n: number; label: string; tone: "todo" | "busy" | "ok" | "bad"; detail: string }) => (
  <span className={`chip ${tone === "ok" ? "accent" : tone === "bad" ? "warn" : ""}`} title={detail} style={{ opacity: tone === "todo" ? 0.55 : 1 }}>
    {tone === "ok" ? "✓" : tone === "bad" ? "✗" : tone === "busy" ? "…" : n} {label}
    {detail ? ` · ${detail}` : ""}
  </span>
);

/**
 * The builds that have worked on this project, newest first. Each one ran on a
 * copy, and goes to your project and GitHub in four steps you can see:
 *
 *   1. Test   the project's own checks, run on the copy — nothing touched yet.
 *   2. Apply  write the changes in, skipping any file you have edited since.
 *   3. Commit exactly the files this build applied; your other edits stay put.
 *   4. Push   shows what will go first, then asks the remote where the branch
 *             is now, so "pushed" means it is really there.
 */
export function ProjectBuildList({ projectId, refreshKey = 0 }: { projectId: string; refreshKey?: number }) {
  const toast = useToast();
  const builds = useRemote(() => api.projectBuilds(projectId), 6000);
  const [busy, setBusy] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<Record<string, string>>({});
  const [plans, setPlans] = useState<Record<string, PushPlan>>({});
  const [seenKey, setSeenKey] = useState(refreshKey);

  if (refreshKey !== seenKey) {
    setSeenKey(refreshKey);
    void builds.refresh();
  }

  const list = builds.data?.builds ?? [];
  if (list.length === 0) return null;

  const act = async (key: string, work: () => Promise<void>) => {
    setBusy(key);
    try {
      await work();
      await builds.refresh();
    } catch (error) {
      toast(errorText(error), "error");
    } finally {
      setBusy(null);
    }
  };

  const showDiff = (build: ProjectBuild) => {
    if (diffs[build.buildId] !== undefined) {
      setDiffs(({ [build.buildId]: _hidden, ...rest }) => rest);
      return;
    }
    void act(`${build.buildId}:diff`, async () => {
      const res = await api.projectBuildDiff(build.buildId);
      setDiffs((prev) => ({ ...prev, [build.buildId]: res.diff || "No changes." }));
    });
  };

  const test = (build: ProjectBuild) =>
    act(`${build.buildId}:test`, async () => {
      await api.testProjectBuild(build.buildId);
      toast("Testing the build's copy: install, typecheck, build and tests. This can take a few minutes.", "info");
    });

  const apply = (build: ProjectBuild) =>
    act(`${build.buildId}:apply`, async () => {
      const res = await api.applyProjectBuild(build.buildId);
      const parts = [`${res.applied.length} file(s) written into the project`];
      if (res.unchanged.length) parts.push(`${res.unchanged.length} already the same`);
      if (res.conflicts.length) parts.push(`${res.conflicts.length} skipped because you changed them since`);
      toast(parts.join("; ") + ".", res.conflicts.length ? "info" : "ok");
    });

  const commit = (build: ProjectBuild) =>
    act(`${build.buildId}:commit`, async () => {
      const res = await api.commitProjectBuild(build.buildId);
      toast(`Committed ${res.commit.files.length} file(s) as ${res.commit.hash.slice(0, 7)} on ${res.commit.branch}.`, "ok");
    });

  /** First press shows what would be pushed; "Yes" pushes and confirms with the remote. */
  const preparePush = (build: ProjectBuild) =>
    act(`${build.buildId}:plan`, async () => {
      const plan = await api.gitPlan(build.projectId);
      setPlans((prev) => ({ ...prev, [build.buildId]: plan }));
    });

  const push = (build: ProjectBuild) =>
    act(`${build.buildId}:push`, async () => {
      const res = await api.pushProjectBuild(build.buildId);
      setPlans(({ [build.buildId]: _done, ...rest }) => rest);
      toast(res.message, res.confirmed ? "ok" : "error");
    });

  const closePlan = (buildId: string) => setPlans(({ [buildId]: _closed, ...rest }) => rest);

  return (
    <div style={{ marginTop: 16 }}>
      <strong style={{ fontSize: 14 }}>Work on this project</strong>
      <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
        {list.map((build) => {
          const running = build.state === "running" || build.state === "paused";
          const diff = diffs[build.buildId];
          const t = build.lastTest;
          const testing = t?.state === "running";
          const applied = build.lastApply?.applied.length ?? 0;
          const conflicts = build.lastApply?.conflicts ?? [];
          const committed = build.commit;
          const pushed = build.push;
          const plan = plans[build.buildId];
          const key = (step: string) => `${build.buildId}:${step}`;

          return (
            <div key={build.buildId} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 600 }}>{build.instruction}</span>
                <span className={`chip ${running ? "accent" : build.state === "error" ? "warn" : ""}`}>
                  {STATE_LABEL[build.state] ?? build.state}
                  {build.qualityScore ? ` · ${Math.round(build.qualityScore)}` : ""}
                </span>
              </div>
              <small style={{ color: "var(--muted)", display: "block", marginTop: 4 }}>
                {ago(build.createdAt)} · {build.changes.length} file(s) changed
                {running ? " · working on a copy; the project is untouched" : ""}
              </small>

              {running ? <BuildLive buildId={build.buildId} /> : null}

              <div className="chips" style={{ marginTop: 8 }}>
                <Step
                  n={1}
                  label="Tested"
                  tone={testing ? "busy" : !t ? "todo" : t.state === "error" || !t.passed ? "bad" : "ok"}
                  detail={testing ? "running" : !t ? "" : t.state === "error" ? "could not run" : `score ${t.score}`}
                />
                <Step
                  n={2}
                  label="Applied"
                  tone={!build.appliedAt ? "todo" : conflicts.length ? "bad" : "ok"}
                  detail={build.appliedAt ? `${applied} file(s)${conflicts.length ? `, ${conflicts.length} skipped` : ""}` : ""}
                />
                <Step n={3} label="Committed" tone={committed ? "ok" : "todo"} detail={committed ? committed.hash.slice(0, 7) : ""} />
                <Step
                  n={4}
                  label="Pushed"
                  tone={!pushed ? "todo" : pushed.confirmed ? "ok" : "bad"}
                  detail={pushed ? (pushed.pushed ? `${pushed.branch} @ ${pushed.commit?.slice(0, 7)}` : "nothing new") : ""}
                />
              </div>

              <div className="btn-row" style={{ marginTop: 8 }}>
                <button className="btn small" onClick={() => showDiff(build)} disabled={busy !== null || build.changes.length === 0}>
                  {busy === key("diff") ? <Busy label="Loading…" /> : diff !== undefined ? "Hide changes" : "View changes"}
                </button>
                <button
                  className="btn small"
                  onClick={() => test(build)}
                  disabled={busy !== null || running || testing || build.changes.length === 0}
                  title="Run the project's checks on the build's copy. Your project is not touched."
                >
                  {testing ? <Busy label="Testing…" /> : <>{Icon.stethoscope} {t ? "Test again" : "Test"}</>}
                </button>
                <button
                  className="btn small primary"
                  onClick={() => apply(build)}
                  disabled={busy !== null || running || build.changes.length === 0}
                  title={running ? "Wait for it to finish, or stop it, first" : undefined}
                >
                  {busy === key("apply") ? <Busy label="Applying…" /> : <>{Icon.check} {build.appliedAt ? "Apply again" : "Apply to project"}</>}
                </button>
                <button
                  className="btn small"
                  onClick={() => commit(build)}
                  disabled={busy !== null || !applied || Boolean(committed)}
                  title="Commits only the files this build applied"
                >
                  {busy === key("commit") ? <Busy label="Committing…" /> : committed ? "Committed" : "Commit"}
                </button>
                <button
                  className="btn small"
                  onClick={() => preparePush(build)}
                  disabled={busy !== null || !committed}
                  title="Shows what will be pushed before anything is sent"
                >
                  {busy === key("plan") ? <Busy label="Checking…" /> : "Push to GitHub"}
                </button>
              </div>

              {testing && t ? (
                <small style={{ color: "var(--muted)", display: "block", marginTop: 8 }}>
                  Testing since {ago(t.startedAt)}: installing, then typecheck, build and tests on the copy.
                </small>
              ) : null}

              {t && t.state !== "running" ? (
                <div style={{ marginTop: 8, borderTop: "1px solid var(--line)", paddingTop: 8 }}>
                  <small style={{ display: "block", fontWeight: 600, color: t.passed ? "var(--good)" : "var(--bad)" }}>
                    {t.state === "error"
                      ? `The test could not run: ${t.error}`
                      : t.passed
                        ? `Passed every check (score ${t.score}). Safe to apply.`
                        : `Failed (score ${t.score}). Look at what failed before applying.`}
                  </small>
                  {t.checks
                    .filter((check) => check.applicable)
                    .map((check) => (
                      <details key={check.name} style={{ marginTop: 4 }} open={!check.passed}>
                        <summary style={{ fontSize: 13 }}>
                          {check.passed ? "✓" : "✗"} {check.name}
                        </summary>
                        {check.output ? (
                          <pre style={{ fontSize: 11, maxHeight: 200, overflow: "auto", background: "rgba(0,0,0,0.3)", padding: 8, borderRadius: 6, whiteSpace: "pre-wrap" }}>
                            {check.output}
                          </pre>
                        ) : null}
                      </details>
                    ))}
                </div>
              ) : null}

              {conflicts.length ? (
                <small style={{ color: "var(--warn)", display: "block", marginTop: 6 }}>
                  Not applied, because you had changed them: {conflicts.join(", ")}
                </small>
              ) : null}

              {committed ? (
                <small style={{ color: "var(--muted)", display: "block", marginTop: 6 }}>
                  Commit {committed.hash.slice(0, 7)} on {committed.branch}: {committed.files.join(", ")}
                </small>
              ) : null}

              {plan ? (
                <div className="card" style={{ marginTop: 8, padding: 10, borderColor: plan.isGitHub ? "var(--line)" : "var(--warn)" }}>
                  {!plan.isGitHub ? (
                    <p style={{ color: "var(--warn)", margin: "0 0 6px", fontSize: 13 }}>
                      This project&apos;s remote is {plan.remoteUrl ?? "not set"}, which is not GitHub. Pushing copies commits there; nothing goes to GitHub.
                    </p>
                  ) : null}
                  {plan.commits.length === 0 ? (
                    <p style={{ margin: 0, fontSize: 13 }}>
                      Nothing to push: {plan.isGitHub ? "GitHub" : "the remote"} already has everything on {plan.branch}.
                    </p>
                  ) : (
                    <>
                      <p style={{ margin: "0 0 6px", fontSize: 13 }}>
                        This sends <strong>{plan.commits.length} commit(s)</strong> to <strong>{plan.webUrl ?? plan.remoteUrl}</strong>, branch{" "}
                        <strong>{plan.branch}</strong>
                        {plan.hasUpstream ? "" : " (new on the remote)"}:
                      </p>
                      <ul style={{ margin: "0 0 8px 18px", padding: 0, fontSize: 12.5 }}>
                        {plan.commits.slice(0, 12).map((c) => (
                          <li key={c.hash}>
                            <code>{c.hash.slice(0, 7)}</code> {c.subject}
                          </li>
                        ))}
                        {plan.commits.length > 12 ? <li>…and {plan.commits.length - 12} more</li> : null}
                      </ul>
                    </>
                  )}
                  {plan.uncommitted ? (
                    <small style={{ color: "var(--muted)", display: "block", marginBottom: 6 }}>
                      {plan.uncommitted} other change(s) in the project are not committed, so they are not included.
                    </small>
                  ) : null}
                  <div className="btn-row">
                    {plan.commits.length ? (
                      <button className="btn small primary" onClick={() => push(build)} disabled={busy !== null}>
                        {busy === key("push") ? <Busy label="Pushing…" /> : `Yes, push ${plan.commits.length} commit(s)`}
                      </button>
                    ) : null}
                    <button className="btn small" onClick={() => closePlan(build.buildId)} disabled={busy !== null}>
                      {plan.commits.length ? "Cancel" : "Close"}
                    </button>
                  </div>
                </div>
              ) : null}

              {pushed ? (
                <p role="status" style={{ marginTop: 8, marginBottom: 0, fontSize: 13, color: pushed.confirmed ? "var(--good)" : "var(--bad)" }}>
                  {pushed.confirmed ? "✓ " : "✗ "}
                  {pushed.message} · {ago(pushed.at)}
                  {pushed.commitUrl ? (
                    <>
                      {" · "}
                      <a href={pushed.commitUrl} target="_blank" rel="noreferrer">
                        See it on GitHub ↗
                      </a>
                    </>
                  ) : null}
                </p>
              ) : null}

              {diff !== undefined ? (
                <pre style={{ marginTop: 8, maxHeight: 360, overflow: "auto", fontSize: 12, background: "rgba(0,0,0,0.3)", padding: 10, borderRadius: 8, whiteSpace: "pre" }}>
                  {diff}
                </pre>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The project's link to GitHub: prove the PC can push (a dry run that sends
 * nothing), pull, and push with a look at what will go first and a check
 * afterwards that the remote really has it.
 */
export function GitPanel({ projectId, onChanged }: { projectId: string; onChanged?: () => Promise<void> | void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [access, setAccess] = useState<AccessCheck | null>(null);
  const [plan, setPlan] = useState<PushPlan | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string; url?: string | null } | null>(null);

  const act = async (key: string, work: () => Promise<void>) => {
    setBusy(key);
    try {
      await work();
    } catch (error) {
      setResult({ ok: false, text: errorText(error) });
    } finally {
      setBusy(null);
    }
  };

  const checkAccess = () =>
    act("check", async () => {
      setAccess(await api.gitCheck(projectId));
    });

  const pull = () =>
    act("pull", async () => {
      const res = await api.gitSync(projectId, "pull");
      setResult({ ok: true, text: res.message });
      await onChanged?.();
    });

  const preparePush = () =>
    act("plan", async () => {
      setResult(null);
      setPlan(await api.gitPlan(projectId));
    });

  const push = () =>
    act("push", async () => {
      const res = await api.gitSync(projectId, "push");
      setPlan(null);
      setResult({ ok: res.confirmed !== false, text: res.message, url: res.commitUrl });
      toast(res.message, res.confirmed === false ? "error" : "ok");
      await onChanged?.();
    });

  return (
    <div>
      <div className="btn-row" style={{ marginBottom: 10 }}>
        <button className="btn small" onClick={checkAccess} disabled={busy !== null} title="A dry run: signs in to GitHub like a push does, sends nothing">
          {busy === "check" ? <Busy label="Checking GitHub…" /> : <>{Icon.stethoscope} Test GitHub access</>}
        </button>
        <button className="btn small" onClick={pull} disabled={busy !== null}>
          {busy === "pull" ? <Busy label="Pulling…" /> : "Pull"}
        </button>
        <button className="btn small primary" onClick={preparePush} disabled={busy !== null}>
          {busy === "plan" ? <Busy label="Checking…" /> : "Push…"}
        </button>
      </div>

      {access ? (
        <div className="card" style={{ padding: 10, marginBottom: 10, borderColor: access.canPush ? "var(--line)" : "var(--warn)" }}>
          <strong style={{ fontSize: 14, color: access.canPush ? "var(--good)" : "var(--bad)" }}>
            {access.canPush ? "✓ This PC can push" : access.canRead ? "Can read, cannot push" : "✗ Cannot reach the repository"}
          </strong>
          <p style={{ margin: "4px 0 0", fontSize: 13 }}>{access.detail}</p>
          {access.webUrl ? (
            <a href={access.webUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
              {access.webUrl.replace("https://", "")} ↗
            </a>
          ) : null}
          {!access.isGitHub && access.remoteUrl ? (
            <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--warn)" }}>
              The remote is {access.remoteUrl}: pushing goes there, not to GitHub.
            </p>
          ) : null}
        </div>
      ) : null}

      {plan ? (
        <div className="card" style={{ padding: 10, marginBottom: 10, borderColor: plan.isGitHub ? "var(--line)" : "var(--warn)" }}>
          {!plan.isGitHub ? (
            <p style={{ color: "var(--warn)", margin: "0 0 6px", fontSize: 13 }}>
              This project&apos;s remote is {plan.remoteUrl ?? "not set"}, which is not GitHub. Pushing copies commits there; nothing goes to GitHub.
            </p>
          ) : null}
          {plan.commits.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13 }}>
              Nothing to push: {plan.isGitHub ? "GitHub" : "the remote"} already has everything on {plan.branch}.
              {plan.uncommitted ? ` ${plan.uncommitted} change(s) are not committed yet.` : ""}
            </p>
          ) : (
            <>
              <p style={{ margin: "0 0 6px", fontSize: 13 }}>
                This sends <strong>{plan.commits.length} commit(s)</strong> to <strong>{plan.webUrl ?? plan.remoteUrl}</strong>, branch{" "}
                <strong>{plan.branch}</strong>
                {plan.hasUpstream ? "" : " (new on the remote)"}:
              </p>
              <ul style={{ margin: "0 0 8px 18px", padding: 0, fontSize: 12.5 }}>
                {plan.commits.slice(0, 15).map((c) => (
                  <li key={c.hash}>
                    <code>{c.hash.slice(0, 7)}</code> {c.subject}
                  </li>
                ))}
                {plan.commits.length > 15 ? <li>…and {plan.commits.length - 15} more</li> : null}
              </ul>
              {plan.uncommitted ? (
                <small style={{ color: "var(--muted)", display: "block", marginBottom: 6 }}>
                  {plan.uncommitted} change(s) are not committed, so they are not included.
                </small>
              ) : null}
            </>
          )}
          <div className="btn-row">
            {plan.commits.length ? (
              <button className="btn small primary" onClick={push} disabled={busy !== null}>
                {busy === "push" ? <Busy label="Pushing…" /> : `Yes, push ${plan.commits.length} commit(s)`}
              </button>
            ) : null}
            <button className="btn small" onClick={() => setPlan(null)} disabled={busy !== null}>
              {plan.commits.length ? "Cancel" : "Close"}
            </button>
          </div>
        </div>
      ) : null}

      {result ? (
        <p role="status" style={{ margin: "0 0 10px", fontSize: 13, color: result.ok ? "var(--good)" : "var(--bad)" }}>
          {result.ok ? "✓ " : "✗ "}
          {result.text}
          {result.url ? (
            <>
              {" · "}
              <a href={result.url} target="_blank" rel="noreferrer">
                See it on GitHub ↗
              </a>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
