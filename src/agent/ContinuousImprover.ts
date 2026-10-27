/**
 * ContinuousImprover — "keep making this better" for a project, 24/7 until stopped.
 *
 * Each cycle, on its own:
 *   1. think    reads the project (ContextPack: README, notes, commits, open
 *               issues, lessons) and what it already tried, and picks ONE
 *               concrete improvement — a fix first if its checks failed last
 *               time, then reliability, tests, UX, performance, features
 *   2. build    builds it on a fresh copy of the project (ProjectBuilds): the
 *               project itself is never touched by this
 *   3. test     runs the project's own checks on the copy
 *   4. queue    a change that passes waits in Approvals with its diff
 *
 * Nothing reaches the project until you approve: Approve applies exactly the
 * files that change touched (three-way safe — a file you have since edited is
 * a conflict, never overwritten) and commits them on the live branch with the
 * improvement as the message; Reject drops it. So the original is always safe.
 *
 * It waits while game mode is on, and stops building when MAX_WAITING
 * improvements are waiting for you, so it never buries you in unreviewed work.
 * Sessions survive restarts (data/agent/continuous.json).
 */
import fs from "fs";
import path from "path";

import { ContextPack } from "../ecosystem/ContextPack.js";
import { EcosystemStore } from "../ecosystem/EcosystemStore.js";
import { ProjectBuilds } from "../ecosystem/ProjectBuilds.js";
import { BuildService } from "../orchestrator/BuildService.js";
import { ModelRouter } from "../tools/ModelRouter.js";
import { GameMode } from "../utils/GameMode.js";
import { Logger } from "../utils/Logger.js";

export type SessionState = "running" | "waiting" | "stopped";
export type CandidateState = "building" | "testing" | "awaiting" | "approved" | "rejected" | "failed" | "conflict";

export interface ImproveSession {
  id: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  /** The branch the project was on when it started: approvals commit there. */
  liveBranch: string | null;
  /** What to concentrate on, in the owner's words (optional). */
  focus: string;
  state: SessionState;
  phase: string;
  startedAt: string;
  stoppedAt: string | null;
  startedBy: string;
  cycles: number;
  currentBuildId: string | null;
  lastError: string | null;
}

export interface Candidate {
  id: string;
  sessionId: string;
  projectId: string;
  projectName: string;
  buildId: string;
  title: string;
  why: string;
  kind: string;
  instruction: string;
  state: CandidateState;
  createdAt: string;
  decidedAt: string | null;
  files: string[];
  test: { passed: boolean; score: number | null; failing: string[] } | null;
  commit: { hash: string; branch: string } | null;
  note: string | null;
}

interface Store {
  sessions: ImproveSession[];
  candidates: Candidate[];
}

const MAX_WAITING = Number(process.env.CONTINUOUS_MAX_WAITING) || 8;
const COOLDOWN_MS = Number(process.env.CONTINUOUS_COOLDOWN_MS) || 60_000;
const FILE = () => path.resolve("data", "agent", "continuous.json");

const read = (): Store => {
  try {
    return JSON.parse(fs.readFileSync(FILE(), "utf8")) as Store;
  } catch {
    return { sessions: [], candidates: [] };
  }
};
const write = (store: Store) => {
  fs.mkdirSync(path.dirname(FILE()), { recursive: true });
  fs.writeFileSync(FILE(), JSON.stringify({ sessions: store.sessions.slice(-50), candidates: store.candidates.slice(-500) }, null, 2), "utf8");
};
const update = (fn: (store: Store) => void) => {
  const store = read();
  fn(store);
  write(store);
  return store;
};
const patchSession = (id: string, patch: Partial<ImproveSession>) => update((s) => Object.assign(s.sessions.find((x) => x.id === id) ?? {}, patch));
const patchCandidate = (id: string, patch: Partial<Candidate>) => update((s) => Object.assign(s.candidates.find((x) => x.id === id) ?? {}, patch));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const loops = new Set<string>();

const extractJson = (text: string): Record<string, unknown> | null => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
};

const think = async (session: ImproveSession, tried: Candidate[]): Promise<{ title: string; why: string; kind: string; instruction: string }> => {
  const context = await ContextPack.forProject(session.projectId).catch(() => null);
  const lastFailed = tried.filter((c) => c.state === "failed" && c.test && !c.test.passed).slice(-1)[0];
  const answer = await ModelRouter.generate(
    `You are improving the project "${session.projectName}" continuously, one small, safe, complete change at a time.
${session.focus ? `The owner wants you to concentrate on: ${session.focus}\n` : ""}
The project:
${(context?.markdown ?? "(no briefing could be read)").slice(0, 9000)}

Already tried (do not repeat these; build on what was approved):
${tried.slice(-25).map((c) => `- [${c.state}] ${c.title}`).join("\n") || "- nothing yet"}
${lastFailed ? `\nThe last attempt failed its checks (${lastFailed.test?.failing.join(", ")}): consider fixing what that revealed.\n` : ""}
Pick ONE improvement that makes the app better or stronger and can be finished and verified in one go: fix a bug or a
failing check first; then reliability and error handling, missing tests, accessibility and UX, performance, then a
small feature that clearly fits. Be specific to this code — name the screen, file or behaviour.

Answer with JSON only:
{"title": "<short commit-style title>", "why": "<one sentence: the problem or gain>", "kind": "fix|reliability|tests|ux|performance|feature|docs",
 "instruction": "<what to change, precisely, in 2-5 sentences, for the builder that will make the change>"}`
  );
  const parsed = extractJson(answer);
  const title = typeof parsed?.title === "string" ? parsed.title.trim().slice(0, 90) : "";
  const instruction = typeof parsed?.instruction === "string" ? parsed.instruction.trim().slice(0, 2000) : "";
  if (!title || instruction.length < 20) throw new Error("The model did not propose a usable improvement.");
  return {
    title,
    why: typeof parsed?.why === "string" ? parsed.why.slice(0, 300) : "",
    kind: typeof parsed?.kind === "string" ? parsed.kind.slice(0, 20) : "improvement",
    instruction
  };
};

const waitFor = async (session: string, done: () => boolean, everyMs: number, limitMs: number): Promise<boolean> => {
  const started = Date.now();
  while (!done()) {
    if (read().sessions.find((s) => s.id === session)?.state === "stopped") return false;
    if (Date.now() - started > limitMs) return false;
    await sleep(everyMs);
  }
  return true;
};

async function loop(id: string) {
  if (loops.has(id)) return;
  loops.add(id);
  let failures = 0;
  try {
    for (;;) {
      const store = read();
      const session = store.sessions.find((s) => s.id === id);
      if (!session || session.state === "stopped") return;
      const project = EcosystemStore.getProject(session.projectId);
      if (!project) {
        patchSession(id, { state: "stopped", stoppedAt: new Date().toISOString(), lastError: "The project is no longer in the list." });
        return;
      }
      if (GameMode.isOn()) {
        patchSession(id, { phase: "Paused for game mode" });
        await sleep(60_000);
        continue;
      }
      const mine = store.candidates.filter((c) => c.sessionId === id);
      const waiting = store.candidates.filter((c) => c.projectId === session.projectId && c.state === "awaiting").length;
      if (waiting >= MAX_WAITING) {
        patchSession(id, { state: "waiting", phase: `${waiting} improvements are waiting for your review` });
        await sleep(120_000);
        continue;
      }
      if (session.state === "waiting") patchSession(id, { state: "running" });

      let candidateId: string | null = null;
      try {
        patchSession(id, { phase: "Reading the project and choosing the next improvement" });
        const idea = await think(session, mine);
        if (read().sessions.find((s) => s.id === id)?.state === "stopped") return;

        patchSession(id, { phase: `Building: ${idea.title}` });
        const record = await ProjectBuilds.start(project, `${idea.title}\n\n${idea.instruction}`, { startedBy: `continuous:${id}`, profile: "balanced" });
        const candidate: Candidate = {
          id: `imp_${Date.now().toString(36)}`,
          sessionId: id,
          projectId: project.id,
          projectName: project.name,
          buildId: record.buildId,
          ...idea,
          state: "building",
          createdAt: new Date().toISOString(),
          decidedAt: null,
          files: [],
          test: null,
          commit: null,
          note: null
        };
        candidateId = candidate.id;
        update((s) => s.candidates.push(candidate));
        patchSession(id, { currentBuildId: record.buildId });

        const built = await waitFor(id, () => !BuildService.isRunning(record.buildId), 15_000, 6 * 3_600_000);
        if (!built) {
          if (BuildService.isRunning(record.buildId)) BuildService.control(record.buildId, "stop");
          patchCandidate(candidate.id, { state: "failed", note: "Stopped before it finished." });
          continue;
        }
        const changes = await ProjectBuilds.changes(record).catch(() => []);
        if (changes.length === 0) {
          patchCandidate(candidate.id, { state: "failed", note: "The build made no change." });
        } else {
          patchCandidate(candidate.id, { state: "testing", files: changes.map((c) => c.path) });
          patchSession(id, { phase: `Testing: ${idea.title}` });
          ProjectBuilds.startTest(ProjectBuilds.get(record.buildId) ?? record);
          await waitFor(id, () => ProjectBuilds.get(record.buildId)?.lastTest?.state !== "running", 10_000, 45 * 60_000);
          const test = ProjectBuilds.get(record.buildId)?.lastTest;
          const failing = (test?.checks ?? []).filter((c) => c.applicable && !c.passed).map((c) => c.name);
          const summary = { passed: Boolean(test?.passed), score: test?.score ?? null, failing };
          patchCandidate(candidate.id, test?.passed ? { state: "awaiting", test: summary } : { state: "failed", test: summary, note: test?.error ?? `Checks failed: ${failing.join(", ") || "unknown"}` });
        }
        failures = 0;
        patchSession(id, { cycles: (read().sessions.find((s) => s.id === id)?.cycles ?? 0) + 1, currentBuildId: null, lastError: null });
      } catch (error) {
        failures += 1;
        const message = (error as Error)?.message ?? String(error);
        Logger.warn("Continuous improvement cycle failed", { session: id, error: message });
        if (candidateId) patchCandidate(candidateId, { state: "failed", note: message });
        patchSession(id, { lastError: message, currentBuildId: null });
        if (failures >= 5) {
          patchSession(id, { state: "stopped", stoppedAt: new Date().toISOString(), phase: "Stopped after 5 failures in a row" });
          return;
        }
      }
      patchSession(id, { phase: "Resting before the next improvement" });
      await sleep(COOLDOWN_MS * Math.max(1, failures * 2));
    }
  } finally {
    loops.delete(id);
  }
}

export const ContinuousImprover = {
  list() {
    const store = read();
    return {
      sessions: [...store.sessions].reverse(),
      candidates: [...store.candidates].reverse()
    };
  },

  running(): string[] {
    return read()
      .sessions.filter((s) => s.state !== "stopped")
      .map((s) => s.projectName);
  },

  approvedCount(): number {
    return read().candidates.filter((c) => c.state === "approved").length;
  },

  start(projectId: string, focus = "", startedBy = "owner"): ImproveSession {
    const project = EcosystemStore.getProject(projectId);
    if (!project) throw new Error("Unknown project.");
    const existing = read().sessions.find((s) => s.projectId === projectId && s.state !== "stopped");
    if (existing) return existing;
    const session: ImproveSession = {
      id: `cont_${Date.now().toString(36)}`,
      projectId,
      projectName: project.name,
      projectPath: project.path,
      liveBranch: project.gitBranch,
      focus: focus.trim().slice(0, 500),
      state: "running",
      phase: "Starting",
      startedAt: new Date().toISOString(),
      stoppedAt: null,
      startedBy,
      cycles: 0,
      currentBuildId: null,
      lastError: null
    };
    update((s) => s.sessions.push(session));
    void loop(session.id);
    return session;
  },

  stop(sessionId: string): ImproveSession | null {
    const store = update((s) => {
      const session = s.sessions.find((x) => x.id === sessionId);
      if (session) Object.assign(session, { state: "stopped", stoppedAt: new Date().toISOString(), phase: "Stopped by you" });
    });
    const session = store.sessions.find((s) => s.id === sessionId) ?? null;
    if (session?.currentBuildId && BuildService.isRunning(session.currentBuildId)) BuildService.control(session.currentBuildId, "stop");
    return session;
  },

  async diff(candidateId: string): Promise<string> {
    const candidate = read().candidates.find((c) => c.id === candidateId);
    const record = candidate ? ProjectBuilds.get(candidate.buildId) : null;
    if (!record) throw new Error("That improvement's build is gone.");
    return ProjectBuilds.diff(record);
  },

  /**
   * Applies the improvement to the project and commits it on the live branch.
   * Refuses when the project is on another branch than when the session began.
   */
  async approve(candidateId: string): Promise<Candidate> {
    const candidate = read().candidates.find((c) => c.id === candidateId);
    if (!candidate) throw new Error("Unknown improvement.");
    if (candidate.state !== "awaiting" && candidate.state !== "conflict") throw new Error(`It is ${candidate.state}, not waiting for approval.`);
    const record = ProjectBuilds.get(candidate.buildId);
    if (!record) throw new Error("That improvement's build is gone.");
    const session = read().sessions.find((s) => s.id === candidate.sessionId);
    const project = EcosystemStore.getProject(candidate.projectId);
    if (session?.liveBranch && project?.gitBranch && project.gitBranch !== session.liveBranch) {
      throw new Error(`The project is on ${project.gitBranch} now, not ${session.liveBranch}; switch back before approving.`);
    }
    const result = await ProjectBuilds.apply(record);
    if (result.conflicts.length) {
      patchCandidate(candidateId, { state: "conflict", note: `Changed in the project since: ${result.conflicts.join(", ")}. Nothing was applied from those files.` });
      return read().candidates.find((c) => c.id === candidateId)!;
    }
    let commit: Candidate["commit"] = null;
    let note: string | null = null;
    try {
      const made = await ProjectBuilds.commitApplied(ProjectBuilds.get(candidate.buildId) ?? record, `${candidate.title}\n\n${candidate.why}\n\nContinuous improvement, approved by the owner.`);
      commit = { hash: made.hash, branch: made.branch };
    } catch (error) {
      note = `Applied, not committed: ${(error as Error)?.message}`;
    }
    patchCandidate(candidateId, { state: "approved", decidedAt: new Date().toISOString(), commit, note });
    EcosystemStore.recordEvent(candidate.projectId, "build", `Approved improvement: ${candidate.title}`);
    return read().candidates.find((c) => c.id === candidateId)!;
  },

  reject(candidateId: string, note = ""): Candidate {
    const candidate = read().candidates.find((c) => c.id === candidateId);
    if (!candidate) throw new Error("Unknown improvement.");
    patchCandidate(candidateId, { state: "rejected", decidedAt: new Date().toISOString(), note: note.slice(0, 300) || null });
    return read().candidates.find((c) => c.id === candidateId)!;
  },

  /** Picks up running sessions after a restart. */
  resume() {
    for (const session of read().sessions.filter((s) => s.state !== "stopped")) {
      // A build cut off by the restart is lost; its candidate says so.
      update((s) => {
        for (const c of s.candidates) if (c.sessionId === session.id && (c.state === "building" || c.state === "testing")) Object.assign(c, { state: "failed", note: "Agent Builder restarted during it." });
      });
      void loop(session.id);
    }
  }
};
