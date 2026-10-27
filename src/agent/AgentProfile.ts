/**
 * AgentProfile — Agent Builder as an agent that grows.
 *
 * Everything here is counted from what it has really done, never rolled:
 *   XP        from passed builds, research findings, lessons it has written,
 *             Unity levels, approved improvements, practice wins, rewarded
 *             tries in its learning policies and build lessons that proved out
 *   level     earned from XP, with a title for each band
 *   strength  is it getting better? the last 20 builds against the 20 before
 *             (pass rate, best score) and its learning policies' recent rewards
 *   abilities what it can do, each dated by the git commit that introduced it
 *             (so "new" is true), whether it is ready on this PC, how often used
 *   doing     what it is busy with right now
 *
 * A snapshot is appended to data/agent/growth.jsonl every few hours so the
 * app can draw its growth over time. Jarvis's town shows the same profile.
 */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

import { getKnowledgeDb } from "../knowledge/KnowledgeDb.js";
import { BuildService } from "../orchestrator/BuildService.js";
import { ResearchStore } from "../research/ResearchStore.js";
import { StudyCourse } from "../research/StudyCourse.js";
import { Reinforcement } from "../learning/Reinforcement.js";
import { LessonMemory } from "../learning/LessonMemory.js";
import { UnityLevelStudio } from "../media/UnityLevelStudio.js";
import { BlenderStudio } from "../media/BlenderStudio.js";
import { geminiConfigured } from "../tools/GeminiClient.js";
import { Logger } from "../utils/Logger.js";

export interface Ability {
  id: string;
  label: string;
  area: "build" | "learn" | "create" | "teach" | "connect";
  /** When the code for it first arrived (git), or null when it is not committed yet. */
  since: string | null;
  isNew: boolean;
  /** Whether it can run on this PC right now, and why not. */
  ready: boolean;
  note?: string;
  /** How often it has been used, where that is counted. */
  uses: number | null;
}

const ABILITY_DEFS: Array<Omit<Ability, "since" | "isNew" | "ready" | "uses" | "note"> & { file: string }> = [
  { id: "build", label: "Builds apps, sites and games from a prompt", area: "build", file: "src/orchestrator/AutonomousOrchestrator.ts" },
  { id: "repair", label: "Repairs failing builds, learning from every fix", area: "build", file: "src/repair/StuckDoctor.ts" },
  { id: "projects", label: "Diagnoses, repairs and carries on your projects", area: "build", file: "src/ecosystem/ProjectDoctor.ts" },
  { id: "continuous", label: "Improves a project around the clock, for your approval", area: "build", file: "src/agent/ContinuousImprover.ts" },
  { id: "databases", label: "Sets apps up for your database with plug-in keys", area: "build", file: "src/database/DbKit.ts" },
  { id: "research", label: "Researches any topic around the clock", area: "learn", file: "src/research/ResearchEngine.ts" },
  { id: "evidence", label: "Tells real evidence from speculation and fiction", area: "learn", file: "src/research/SourceCredibility.ts" },
  { id: "reinforcement", label: "Learns which way of working earns the best results", area: "learn", file: "src/learning/Reinforcement.ts" },
  { id: "practice", label: "Practises on its own training ground", area: "learn", file: "src/agent/TrainingGround.ts" },
  { id: "finetune", label: "Fine-tunes its own model from rated work", area: "learn", file: "scripts/train/finetune.py" },
  { id: "academy", label: "Teaches itself new website templates", area: "learn", file: "src/academy/TemplateAcademy.ts" },
  { id: "teach", label: "Teaches you: courses, lessons, quizzes and flashcards", area: "teach", file: "src/research/StudyCourse.ts" },
  { id: "talk", label: "Talks with you about its work, its knowledge and itself", area: "teach", file: "src/agent/AgentChat.ts" },
  { id: "art", label: "Draws sprites, icons and backgrounds", area: "create", file: "src/media/ArtStudio.ts" },
  { id: "unity", label: "Designs playable Unity levels", area: "create", file: "src/media/UnityLevelStudio.ts" },
  { id: "blender", label: "Models 3D assets in Blender", area: "create", file: "unity/blender/build_level_assets.py" },
  { id: "invites", label: "Designs invitations for ARP Invites", area: "create", file: "src/integrations/InviteStudio.ts" },
  { id: "jarvis", label: "Shares its knowledge with Jarvis, and reads his", area: "connect", file: "src/knowledge/SharedKnowledge.ts" },
  { id: "gemini", label: "Uses Gemini for visuals and 3D design", area: "connect", file: "src/tools/GeminiClient.ts" }
];

const NEW_DAYS = 14;
let sinceCache: Map<string, string | null> | null = null;

/** When each ability's file first entered the repository (git), read once per process. */
const firstCommitDates = (): Map<string, string | null> => {
  if (sinceCache) return sinceCache;
  sinceCache = new Map();
  for (const def of ABILITY_DEFS) {
    let since: string | null = null;
    try {
      const out = execFileSync("git", ["log", "--diff-filter=A", "--follow", "--format=%aI", "--", def.file], { encoding: "utf8", timeout: 10_000, windowsHide: true }).trim();
      since = out.split("\n").filter(Boolean).pop() ?? null;
    } catch {
      since = null;
    }
    sinceCache.set(def.id, since);
  }
  return sinceCache;
};

const TITLES: Array<[number, string]> = [
  [1, "Apprentice"],
  [3, "Journeyman Builder"],
  [6, "Craftsman"],
  [10, "Architect"],
  [15, "Master Builder"],
  [22, "Grandmaster"],
  [30, "Legend"]
];

const levelFor = (xp: number) => Math.floor(Math.sqrt(Math.max(0, xp) / 50)) + 1;
const xpForLevel = (level: number) => (level - 1) ** 2 * 50;
const titleFor = (level: number) => [...TITLES].reverse().find(([min]) => level >= min)?.[1] ?? "Apprentice";

const count = (sql: string, ...args: unknown[]): number => {
  try {
    return (getKnowledgeDb().prepare(sql).get(...args) as { n: number | null }).n ?? 0;
  } catch {
    return 0;
  }
};

/** Late-bound, so this module does not import the agents that import it. */
type Extra = { approvedImprovements: () => number; practiceWins: () => number; continuousRunning: () => string[]; practising: () => string | null };
let extra: Extra = { approvedImprovements: () => 0, practiceWins: () => 0, continuousRunning: () => [], practising: () => null };
export const registerProfileSources = (sources: Partial<Extra>) => {
  extra = { ...extra, ...sources };
};

const GROWTH_FILE = () => path.resolve("data", "agent", "growth.jsonl");

export const AgentProfile = {
  abilities(): Ability[] {
    const dates = firstCommitDates();
    const unity = UnityLevelStudio.detectUnity();
    const blender = BlenderStudio.detectBlender();
    const trainer = fs.existsSync(process.env.TRAIN_PYTHON ?? "E:/Tools/ab-train/Scripts/python.exe");
    const builds = BuildService.list();
    const uses: Record<string, number | null> = {
      build: builds.length,
      projects: builds.filter((b) => b.startedBy.startsWith("continuous:") || /project/i.test(b.outputDir ?? "")).length,
      continuous: extra.approvedImprovements(),
      research: ResearchStore.listTopics().length,
      teach: count("SELECT COUNT(*) AS n FROM study_lessons WHERE status = 'ready'"),
      talk: count("SELECT COUNT(*) AS n FROM agent_messages WHERE role = 'agent'"),
      unity: UnityLevelStudio.listJobs().filter((j) => j.status === "done").length,
      reinforcement: count("SELECT COUNT(*) AS n FROM rl_episodes WHERE reward IS NOT NULL"),
      practice: extra.practiceWins()
    };
    const readiness: Record<string, { ready: boolean; note?: string }> = {
      unity: unity.installed ? { ready: true, note: `Unity ${unity.version}` } : { ready: false, note: "No Unity editor found" },
      blender: blender.installed ? { ready: true } : { ready: false, note: "Blender not found (BLENDER_PATH)" },
      gemini: geminiConfigured() ? { ready: true } : { ready: false, note: "Add GEMINI_API_KEY to .env" },
      finetune: trainer ? { ready: true, note: "Training stack in E:\\Tools\\ab-train" } : { ready: false, note: "Training stack not installed" }
    };
    const now = Date.now();
    return ABILITY_DEFS.map((def) => {
      const since = dates.get(def.id) ?? null;
      return {
        id: def.id,
        label: def.label,
        area: def.area,
        since,
        isNew: since === null || now - Date.parse(since) < NEW_DAYS * 86_400_000,
        ready: readiness[def.id]?.ready ?? true,
        note: readiness[def.id]?.note,
        uses: uses[def.id] ?? null
      };
    });
  },

  /** XP, level and where it comes from. */
  experience() {
    const builds = BuildService.list();
    const finished = builds.filter((b) => b.state === "completed" || b.state === "error");
    const passed = builds.filter((b) => b.passed).length;
    const findings = ResearchStore.listTopics().reduce((n, t) => n + (t.findingCount ?? 0), 0);
    const lessons = count("SELECT COUNT(*) AS n FROM study_lessons WHERE status = 'ready'");
    const unity = UnityLevelStudio.listJobs().filter((j) => j.status === "done").length;
    const rewarded = (() => {
      try {
        return getKnowledgeDb().prepare("SELECT COUNT(*) AS n, AVG(reward) AS avg FROM rl_episodes WHERE reward IS NOT NULL").get() as { n: number; avg: number | null };
      } catch {
        return { n: 0, avg: null };
      }
    })();
    const proven = LessonMemory.list("build", 1000).filter((lesson) => lesson.timesHelped > 0).length;
    const sources = [
      { label: "Builds that passed", count: passed, each: 40 },
      { label: "Builds finished", count: finished.length, each: 8 },
      { label: "Research findings", count: findings, each: 0.5 },
      { label: "Lessons written", count: lessons, each: 25 },
      { label: "Unity levels built", count: unity, each: 30 },
      { label: "Build lessons proven", count: proven, each: 12 },
      { label: "Improvements you approved", count: extra.approvedImprovements(), each: 60 },
      { label: "Practice challenges won", count: extra.practiceWins(), each: 35 },
      { label: "Rewarded tries (× average reward)", count: rewarded.n, each: 10 * (rewarded.avg ?? 0) }
    ].map((s) => ({ ...s, xp: Math.round(s.count * s.each) }));
    const xp = sources.reduce((n, s) => n + s.xp, 0);
    const level = levelFor(xp);
    return { xp, level, title: titleFor(level), levelXp: xpForLevel(level), nextLevelXp: xpForLevel(level + 1), sources };
  },

  /** Is it getting better? Recent builds against the ones before, and its learning policies. */
  strength() {
    const builds = BuildService.list()
      .filter((b) => b.state === "completed" || b.state === "error")
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const recent = builds.slice(-20);
    const before = builds.slice(-40, -20);
    const rate = (list: typeof builds) => (list.length ? list.filter((b) => b.passed).length / list.length : null);
    const score = (list: typeof builds) => (list.length ? list.reduce((n, b) => n + (b.bestScore ?? 0), 0) / list.length : null);
    const policies = Reinforcement.stats().map((p) => {
      const leader = [...p.arms].sort((a, b) => b.chanceBest - a.chanceBest)[0];
      return { id: p.id, label: p.label, rewarded: p.rewarded, leader: p.rewarded >= 5 ? leader.label : null, confidence: p.rewarded >= 5 ? leader.chanceBest : null };
    });
    return {
      builds: {
        recent: recent.length,
        passRate: rate(recent),
        passRateBefore: rate(before),
        averageScore: score(recent),
        averageScoreBefore: score(before)
      },
      policies
    };
  },

  /** What it is busy with right now, in one line and in parts. */
  doing(): { line: string; busy: boolean; parts: string[] } {
    const parts: string[] = [];
    for (const build of BuildService.active().slice(0, 3)) parts.push(`Building ${build.projectName}`);
    for (const name of extra.continuousRunning()) parts.push(`Improving ${name} continuously`);
    const practice = extra.practising();
    if (practice) parts.push(`Practising: ${practice}`);
    const unity = UnityLevelStudio.listJobs().find((j) => !["done", "failed"].includes(j.status));
    if (unity) parts.push(`Designing a Unity level`);
    const researching = ResearchStore.listTopics().filter((t) => t.status === "running").length;
    if (researching) parts.push(`Researching ${researching} topic${researching === 1 ? "" : "s"}`);
    return { line: parts[0] ?? "Ready for work", busy: parts.length > 0 && !parts[0].startsWith("Researching"), parts };
  },

  /** Everything at once: what the app's agent page and Jarvis's town show. */
  profile() {
    const experience = AgentProfile.experience();
    const abilities = AgentProfile.abilities();
    return {
      name: "Agent Builder",
      ...experience,
      doing: AgentProfile.doing(),
      strength: AgentProfile.strength(),
      abilities,
      newAbilities: abilities.filter((a) => a.isNew).map((a) => a.label),
      growth: AgentProfile.growth(120)
    };
  },

  growth(limit = 120): Array<{ at: string; xp: number; level: number }> {
    try {
      return fs
        .readFileSync(GROWTH_FILE(), "utf8")
        .split("\n")
        .filter(Boolean)
        .slice(-limit)
        .map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  },

  /** Appends today's XP and level (at most once every few hours). */
  recordGrowth() {
    try {
      const history = AgentProfile.growth(1);
      const last = history[history.length - 1];
      if (last && Date.now() - Date.parse(last.at) < 3 * 3_600_000) return;
      const { xp, level } = AgentProfile.experience();
      fs.mkdirSync(path.dirname(GROWTH_FILE()), { recursive: true });
      fs.appendFileSync(GROWTH_FILE(), `${JSON.stringify({ at: new Date().toISOString(), xp, level })}\n`, "utf8");
    } catch (error) {
      Logger.warn("Could not record the agent's growth", { error: (error as Error)?.message });
    }
  },

  start() {
    AgentProfile.recordGrowth();
    setInterval(() => AgentProfile.recordGrowth(), 3_600_000).unref?.();
  }
};
