/**
 * The Template Academy: Agent Builder teaching itself new website templates.
 *
 * An idea ("a dental practice site", "a law firm site") is practised: built
 * from the closest of our site templates into a new one, carried on pass after
 * pass, and started again from scratch when an attempt stalls, until a build
 * scores 100 and meets the template contract (every word in src/content.ts
 * about an invented sample business, the kit kept). Then it
 * graduates: its code is kept in data/academy/templates/<id> and it joins the
 * catalogue as a hidden draft for the owner to look at and publish with a price.
 *
 * It only practises when the PC is otherwise idle (no build running, no
 * order waiting, not in game mode), at most ACADEMY_DAILY_LIMIT attempts a
 * day, and an order that arrives stops its build at once (the work is kept
 * and carried on later). When it runs out of ideas it asks the model for new
 * ones the catalogue lacks, so it keeps making more on its own.
 *
 *   ACADEMY=off              stop practising (the queue and drafts stay)
 *   ACADEMY_DAILY_LIMIT=3    practice builds a day
 *   ACADEMY_MAX_ATTEMPTS=6   attempts on one idea before it is parked
 */
import fs from "fs";
import path from "path";

import { copyForBuild } from "../ecosystem/ProjectBuilds.js";
import { contentTokens } from "../knowledge/KnowledgeDb.js";
import { BuildService, buildEvents, type BuildRecord } from "../orchestrator/BuildService.js";
import { unshownItems } from "../orchestrator/Completeness.js";
import { sampleBusiness, starterFor as pickStarter } from "../orchestrator/SiteStarters.js";
import { Catalog } from "../orders/Catalog.js";
import { OrderStore } from "../orders/OrderStore.js";
import { ModelRouter } from "../tools/ModelRouter.js";
import { GameMode } from "../utils/GameMode.js";
import { Logger } from "../utils/Logger.js";

export type IdeaStatus = "idea" | "practising" | "graduated" | "published" | "parked";

export interface AcademyAttempt {
  buildId: string;
  /** "fresh" from the base template, or "continued" on the last attempt's folder. */
  kind: "fresh" | "continued";
  startedAt: string;
  finishedAt: string | null;
  score: number | null;
  /** What held it back, from the build's last pass. */
  failing: string[];
  outcome: "running" | "passed" | "short" | "failed" | "stopped";
}

export interface AcademyIdea {
  id: string;
  name: string;
  category: string;
  /** What the template is for and what it must have, in plain words. */
  brief: string;
  mustHave: string[];
  icon: string;
  status: IdeaStatus;
  /** Who suggested it: the owner, or the academy itself. */
  from: "owner" | "academy";
  attempts: AcademyAttempt[];
  bestScore: number;
  /** The folder the next "continued" attempt carries on from. */
  workspace: string | null;
  /** The site template its latest fresh attempt started from ("booking"). */
  starter?: string | null;
  /** Where its code lives once it graduates. */
  sourcePath: string | null;
  createdAt: string;
  updatedAt: string;
  note: string | null;
}

interface AcademyState {
  ideas: AcademyIdea[];
  /** Practice builds started, by day (YYYY-MM-DD), for the daily limit. */
  daily: Record<string, number>;
}

const DIR = () => path.resolve(process.env.ACADEMY_DIR ?? "data/academy");
const STATE = () => path.join(DIR(), "state.json");
const TEMPLATES = () => path.resolve(process.env.TEMPLATES_DIR ?? "templates/sites");
const enabled = () => process.env.ACADEMY !== "off";
const dailyLimit = () => Math.max(0, Number(process.env.ACADEMY_DAILY_LIMIT) || 3);
const maxAttempts = () => Math.max(1, Number(process.env.ACADEMY_MAX_ATTEMPTS) || 6);
/** Continued passes on one folder before starting fresh. */
const CONTINUES_PER_FRESH = 2;
const GRADUATION_SCORE = 100;

const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);
const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "template";

const read = (): AcademyState => {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE(), "utf8")) as AcademyState;
    return { ideas: Array.isArray(parsed.ideas) ? parsed.ideas : [], daily: parsed.daily ?? {} };
  } catch {
    return { ideas: [], daily: {} };
  }
};

const write = (state: AcademyState) => {
  fs.mkdirSync(DIR(), { recursive: true });
  // Keep a week of daily counts.
  const keep = Object.keys(state.daily).sort().slice(-7);
  state.daily = Object.fromEntries(keep.map((day) => [day, state.daily[day]]));
  fs.writeFileSync(STATE(), JSON.stringify(state, null, 2));
};

const update = (id: string, change: (idea: AcademyIdea) => void): AcademyIdea | null => {
  const state = read();
  const idea = state.ideas.find((entry) => entry.id === id);
  if (!idea) return null;
  change(idea);
  idea.updatedAt = now();
  write(state);
  return idea;
};

/**
 * The closest kind of site to start a new template from. A dental practice
 * from the hair salon's booking site needs its words and a few sections
 * changed; started from the solar company's landing page it needed the whole
 * page rebuilt, and the build model went round in type errors for hours.
 * Name and category decide first, the brief only when they say nothing.
 * (Shared with builds from a prompt: orchestrator/SiteStarters.ts.)
 */
export function starterFor(idea: Pick<AcademyIdea, "name" | "category" | "brief">): string {
  return pickStarter(idea);
}

/** The brief a practice build is given. */
export function practiceBrief(idea: AcademyIdea, starter = idea.starter ?? starterFor(idea)): string {
  const was = sampleBusiness(starter);
  return [
    `Build ${idea.name}: a reusable website template for ${idea.category} businesses, sold to many customers.`,
    "",
    "What it is for:",
    idea.brief,
    "",
    // Its own heading: the build's completeness check reads this list and grades it the way graduating does.
    "The site must show:",
    ...idea.mustHave.map((item) => `- ${item}`),
    "",
    "How to build it:",
    "- Every word on the site in src/content.ts, describing an invented sample business, so a customer's own details can replace it later",
    "- Every item above visible on the page: in the section it belongs to, or as a feature, an FAQ answer or a line in the team list when no section fits",
    "- The kit in src/lib (site.tsx, customize.ts, pro.tsx, hours.ts) kept as it is and used: Section, SmartForm, Header, Footer, DemoBanner, WhatsAppButton, brandStyle",
    `- Nothing left from ${was ? `${was}, the sample business` : "the template"} this started as (a ${starter} site): its name, wording, prices and features that do not fit replaced or removed`,
    "",
    "Look and feel:",
    "- Premium: the signature components in src/lib/pro.tsx (Aurora, SplitHeadline, Tilt, CountUp, Marquee, ScrollProgress) and cards with the spotlight and lift classes",
    "- Works on phones first"
  ].join("\n");
}

/** What stops a passing build from being a template we can sell. Empty when it is one. */
export function contractProblems(
  dir: string,
  idea: Pick<AcademyIdea, "name" | "category"> & { starter?: string | null; mustHave?: string[] }
): string[] {
  const problems: string[] = [];
  const file = (rel: string) => path.join(dir, rel);
  const content = fs.existsSync(file("src/content.ts")) ? fs.readFileSync(file("src/content.ts"), "utf8") : "";
  if (!content) problems.push("there is no src/content.ts");
  // Practised like an order, the build turns the preview ribbon off; graduating turns it back on.
  if (content && !/\bdemo\s*:/.test(content)) problems.push("src/content.ts has no demo flag for the preview ribbon");
  if (content && !/\bbusiness\s*:/.test(content)) problems.push("src/content.ts has no business");
  if (content && !/\bbrand\s*:/.test(content)) problems.push("src/content.ts has no brand colours");
  for (const kit of ["src/lib/site.tsx", "src/lib/customize.ts", "src/lib/pro.tsx"]) {
    if (!fs.existsSync(file(kit))) problems.push(`the kit file ${kit} is gone`);
  }
  // The template it started from must be gone.
  const starter = idea.starter ?? "landing";
  const was = sampleBusiness(starter);
  if (was && content.includes(was) && !idea.name.includes(was)) {
    problems.push(`${was}, the sample business it started from, is still in src/content.ts`);
  }
  if (starter === "landing" && !/solar|energy/i.test(`${idea.name} ${idea.category}`) && /solar|load-shedding/i.test(content)) {
    problems.push("the solar company it started from is still in src/content.ts");
  }
  // Its photographs must show this business, not the starter's.
  if (fs.existsSync(file("art.json")) && !fs.existsSync(file(".art-drawn.json"))) {
    problems.push("its photographs were not redrawn for this kind of business (is ComfyUI set up?)");
  }
  const app = fs.existsSync(file("src/App.tsx")) ? fs.readFileSync(file("src/App.tsx"), "utf8") : "";
  if (!app.includes("DemoBanner")) problems.push("App.tsx does not show the template preview ribbon (DemoBanner)");
  // What the idea must have. A score of 100 says the code is sound, not that
  // the brief was met: the first dental practice to score 100 had no medical
  // aids, dentists or emergency contact. Graded with the rule the build's own
  // completeness check uses (Completeness.unshownItems), so a build cannot
  // stop at 100 with items the academy then refuses: Law Firm did twice
  // (Blog, Newsletters) and was parked.
  for (const item of unshownItems(`${content}\n${app}`, idea.mustHave ?? [])) problems.push(`the site does not have: ${item}`);
  return problems;
}

/** Start a practice attempt: fresh from the base template, or carrying on the last one. */
async function startAttempt(idea: AcademyIdea): Promise<BuildRecord | null> {
  // Continued passes since the last fresh start; one stopped for an order does not count.
  let sinceFresh = 0;
  for (const attempt of [...idea.attempts].reverse()) {
    if (attempt.kind === "fresh") break;
    if (attempt.outcome !== "stopped") sinceFresh += 1;
  }
  const lastStopped = idea.attempts[idea.attempts.length - 1]?.outcome === "stopped";
  // The build it would carry on can be gone from the history (lost in a crash, or
  // forgotten): then carrying on fails every tick for ever, so start afresh.
  const lastBuild = [...idea.attempts].reverse().find((attempt) => attempt.buildId)?.buildId;
  const lastKnown = lastBuild ? BuildService.view(lastBuild) !== null : false;
  // A closer starter than the one it began on (the starter words grew) is a fresh start: carrying on a
  // real estate site rebuilt from the solar landing page kept it in type errors.
  const betterStarter = Boolean(idea.starter) && idea.starter !== starterFor(idea);
  const fresh = !idea.workspace || !fs.existsSync(idea.workspace) || !lastKnown || betterStarter || (!lastStopped && sinceFresh >= CONTINUES_PER_FRESH);
  let build: BuildRecord;
  if (fresh) {
    const starter = starterFor(idea);
    const { workDir } = await copyForBuild(path.join(TEMPLATES(), starter), `academy ${idea.name}`, "academy");
    // Built exactly like a customer order on that template: its template.json
    // stays, so the kit is locked and the model tailors the page instead of
    // rewriting it, and the art pass redraws the photographs for the new kind
    // of business. (Marked as a starter, the 7B model threw the page away and
    // went round in type errors.) It is renamed when it graduates.
    build = BuildService.start({
      projectName: idea.name,
      description: practiceBrief(idea, starter),
      targetPlatforms: ["web"],
      profile: "deep",
      qualityThreshold: GRADUATION_SCORE,
      maxIterations: 8,
      workingDir: workDir,
      startedBy: `academy:${idea.id}`
    });
    update(idea.id, (entry) => {
      entry.workspace = workDir;
      entry.starter = starter;
      entry.status = "practising";
      entry.attempts.push({ buildId: build.buildId, kind: "fresh", startedAt: now(), finishedAt: null, score: null, failing: [], outcome: "running" });
    });
  } else {
    const last = [...idea.attempts].reverse().find((attempt) => attempt.buildId);
    if (!last) return null;
    build = BuildService.continue(last.buildId, {
      instruction: [
        `Carry on until every check passes and the template is complete: score 100, every word in src/content.ts, the kit kept, nothing left from ${sampleBusiness(idea.starter ?? "landing") ?? "the template it started from"}.`,
        last.failing.length ? `Still missing after the last attempt: ${last.failing.join("; ")}. Add each one to src/content.ts, in the section it belongs to or, if none fits, as a feature, an FAQ answer or a line in the team list, and show it on the page.` : ""
      ]
        .filter(Boolean)
        .join(" "),
      startedBy: `academy:${idea.id}`
    });
    update(idea.id, (entry) => {
      entry.status = "practising";
      entry.attempts.push({ buildId: build.buildId, kind: "continued", startedAt: now(), finishedAt: null, score: null, failing: [], outcome: "running" });
    });
  }
  const state = read();
  state.daily[today()] = (state.daily[today()] ?? 0) + 1;
  write(state);
  Logger.log("Template Academy: practising", { idea: idea.name, build: build.buildId, fresh });
  return build;
}

/** A practice build ended: record it, and graduate the idea if it is ready. */
function finished(record: BuildRecord, outcome: "completed" | "failed" | "stopped"): void {
  const match = /^academy:(.+)$/.exec(record.startedBy ?? "");
  if (!match) return;
  const id = match[1];
  const idea = read().ideas.find((entry) => entry.id === id);
  if (!idea) return;
  const last = record.iterationDetail?.[record.iterationDetail.length - 1];
  const failing = (last?.checks ?? []).filter((check) => check.applicable && !check.passed).map((check) => check.name);
  const score = Math.round(record.qualityScore ?? 0);
  const problems = outcome === "completed" && score >= GRADUATION_SCORE ? contractProblems(record.outputDir, idea) : [];
  const passed = outcome === "completed" && score >= GRADUATION_SCORE && problems.length === 0;

  update(id, (entry) => {
    const attempt = entry.attempts.find((a) => a.buildId === record.buildId);
    if (attempt) {
      attempt.finishedAt = now();
      attempt.score = score;
      attempt.failing = problems.length ? [...failing, ...problems] : failing;
      attempt.outcome = outcome === "stopped" ? "stopped" : outcome === "failed" ? "failed" : passed ? "passed" : "short";
    }
    entry.bestScore = Math.max(entry.bestScore, score);
    entry.workspace = record.outputDir;
    if (!passed && outcome !== "stopped" && entry.attempts.filter((a) => a.outcome !== "stopped").length >= maxAttempts()) {
      entry.status = "parked";
      entry.note = `Parked after ${entry.attempts.length} attempts (best ${entry.bestScore}). It learned from each; try again later or adjust the idea.`;
    }
  });
  if (passed) graduate(id, record);
}

/** Keep its code and add it to the catalogue as a hidden draft. */
function graduate(id: string, record: BuildRecord): void {
  const idea = read().ideas.find((entry) => entry.id === id);
  if (!idea) return;
  let catalogId = slug(idea.name);
  for (let n = 2; Catalog.get(catalogId); n++) catalogId = `${slug(idea.name)}-${n}`;
  const target = path.join(DIR(), "templates", catalogId);
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(record.outputDir, target, {
    recursive: true,
    filter: (src) => !["node_modules", "dist", ".git"].includes(path.relative(record.outputDir, src).split(path.sep)[0])
  });
  // A template shows the preview ribbon until a customer's build turns it off.
  const contentFile = path.join(target, "src", "content.ts");
  if (fs.existsSync(contentFile)) {
    fs.writeFileSync(contentFile, fs.readFileSync(contentFile, "utf8").replace(/\bdemo(\s*):(\s*)false\b/, "demo$1:$2true"));
  }
  // Its own name now: customer builds tailor it instead of rewriting it.
  fs.writeFileSync(path.join(target, "template.json"), JSON.stringify({ name: idea.name, description: idea.brief.slice(0, 300), icon: idea.icon, academy: true }, null, 2));
  Catalog.create({
    id: catalogId,
    name: idea.name,
    kind: "website",
    category: idea.category,
    description: idea.brief.slice(0, 300),
    price: 4500,
    currency: "ZAR",
    timeframe: "1-2 weeks",
    icon: idea.icon,
    features: idea.mustHave.slice(0, 8),
    sourcePath: target,
    keywords: [idea.category.toLowerCase(), idea.name.toLowerCase()],
    hidden: true
  });
  update(id, (entry) => {
    entry.status = "graduated";
    entry.sourcePath = target;
    entry.note = `Graduated at ${Math.round(record.qualityScore)} as catalogue draft "${catalogId}" (hidden until you publish it).`;
  });
  Logger.log("Template Academy: a template graduated", { idea: idea.name, catalogId });
}

let wired = false;
let timer: NodeJS.Timeout | null = null;

export const TemplateAcademy = {
  list(): AcademyIdea[] {
    return read().ideas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  get(id: string): AcademyIdea | null {
    return read().ideas.find((idea) => idea.id === id) ?? null;
  },

  status() {
    const state = read();
    const running = BuildService.active().filter((build) => (build.startedBy ?? "").startsWith("academy:"));
    return {
      enabled: enabled(),
      dailyLimit: dailyLimit(),
      practisedToday: state.daily[today()] ?? 0,
      maxAttempts: maxAttempts(),
      running: running.map((build) => ({ buildId: build.buildId, idea: build.projectName })),
      counts: Object.fromEntries((["idea", "practising", "graduated", "published", "parked"] as IdeaStatus[]).map((s) => [s, state.ideas.filter((i) => i.status === s).length]))
    };
  },

  /** A new idea to practise. */
  add(input: { name: string; category?: string; brief: string; mustHave?: string[]; icon?: string }, from: "owner" | "academy" = "owner"): AcademyIdea {
    const name = String(input.name ?? "").trim().slice(0, 80);
    const brief = String(input.brief ?? "").trim().slice(0, 1500);
    if (name.length < 3 || brief.length < 10) throw new Error("An idea needs a name and a sentence or two about what the template is for.");
    const state = read();
    if (state.ideas.some((idea) => slug(idea.name) === slug(name) && idea.status !== "parked")) throw new Error(`"${name}" is already in the academy.`);
    const idea: AcademyIdea = {
      id: `idea-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      category: String(input.category ?? name).trim().slice(0, 60),
      brief,
      mustHave: (input.mustHave ?? []).map((item) => String(item).trim().slice(0, 160)).filter(Boolean).slice(0, 10),
      icon: String(input.icon ?? "🧩").slice(0, 4),
      status: "idea",
      from,
      attempts: [],
      bestScore: 0,
      workspace: null,
      sourcePath: null,
      createdAt: now(),
      updatedAt: now(),
      note: null
    };
    state.ideas.push(idea);
    write(state);
    return idea;
  },

  /** Ask the model for template ideas the catalogue lacks. Returns the ones added. */
  async propose(count = 3): Promise<AcademyIdea[]> {
    const have = [...Catalog.all().map((item) => `${item.name} (${item.category})`), ...read().ideas.map((idea) => idea.name)];
    const answer = await ModelRouter.generate(`You plan new website templates for a South African web studio that sells templates to small businesses.

Templates it already has or is working on:
${have.map((name) => `- ${name}`).join("\n")}

Suggest ${count} NEW templates for kinds of small business it does not cover yet, the ones most likely to buy a website
(for example: dental practice, law firm, gym, real estate agency, church, school, plumber, accounting firm, guest house,
car wash). For each: a name like "Dental Practice", the business category, two sentences on what the site does for that
business, 4-6 things it must have (sections or features specific to that kind of business), and one emoji.

Answer with JSON only: {"ideas": [{"name": "...", "category": "...", "brief": "...", "mustHave": ["..."], "icon": "..."}]}`);
    let parsed: { ideas?: Array<Record<string, unknown>> } = {};
    try {
      parsed = JSON.parse(/\{[\s\S]*\}/.exec(answer)?.[0] ?? "{}");
    } catch {
      return [];
    }
    const added: AcademyIdea[] = [];
    for (const raw of (parsed.ideas ?? []).slice(0, count)) {
      try {
        added.push(
          TemplateAcademy.add(
            {
              name: String(raw.name ?? ""),
              category: String(raw.category ?? raw.name ?? ""),
              brief: String(raw.brief ?? ""),
              mustHave: Array.isArray(raw.mustHave) ? raw.mustHave.map(String) : [],
              icon: typeof raw.icon === "string" ? raw.icon : "🧩"
            },
            "academy"
          )
        );
      } catch {
        // A duplicate or an empty one: skip it.
      }
    }
    return added;
  },

  /** Practise one idea now (the owner pressed the button), idle or not, within the daily limit. */
  async practise(id: string): Promise<BuildRecord> {
    const idea = TemplateAcademy.get(id);
    if (!idea) throw new Error("No such idea.");
    if (idea.status === "graduated" || idea.status === "published") throw new Error("That one has graduated already.");
    if (BuildService.active().some((build) => build.startedBy === `academy:${id}`)) throw new Error("It is practising right now.");
    if (idea.status === "parked") update(id, (entry) => ((entry.status = "idea"), (entry.attempts = []), (entry.note = null)));
    const build = await startAttempt(TemplateAcademy.get(id)!);
    if (!build) throw new Error("Could not start a practice build.");
    return build;
  },

  /** Put a graduated template in front of customers at a price. */
  publish(id: string, price?: number): AcademyIdea {
    const idea = TemplateAcademy.get(id);
    if (!idea || idea.status !== "graduated" || !idea.sourcePath) throw new Error("Only a graduated template can be published.");
    const item = Catalog.all().find((entry) => entry.sourcePath === idea.sourcePath);
    if (!item) throw new Error("Its catalogue draft is gone.");
    Catalog.update(item.id, { hidden: false, ...(price && price > 0 ? { price } : {}) });
    return update(id, (entry) => ((entry.status = "published"), (entry.note = `Published as "${item.id}".`)))!;
  },

  remove(id: string): boolean {
    const state = read();
    const idea = state.ideas.find((entry) => entry.id === id);
    if (!idea) return false;
    for (const build of BuildService.active().filter((b) => b.startedBy === `academy:${id}`)) BuildService.control(build.buildId, "stop");
    state.ideas = state.ideas.filter((entry) => entry.id !== id);
    write(state);
    return true;
  },

  /** Stop practice builds so a customer's order has the PC. Their work is kept and carried on later. */
  yieldToOrders(): number {
    let stopped = 0;
    for (const build of BuildService.active().filter((b) => (b.startedBy ?? "").startsWith("academy:"))) {
      if (BuildService.control(build.buildId, "stop")) stopped += 1;
    }
    if (stopped) Logger.log("Template Academy: stepped aside for a customer's order", { stopped });
    return stopped;
  },

  /** One step of practice, when the PC is idle. Run on a timer. */
  async tick(): Promise<string | null> {
    if (!enabled() || GameMode.isOn()) return null;
    if (BuildService.active().length > 0) return null;
    // Customers first: an order ready to build means not now. (One still waiting for you to
    // accept it does not hold the PC; when you accept it, the academy steps aside.)
    if (OrderStore.list({ status: "accepted" }).length > 0) return null;
    const state = read();
    if ((state.daily[today()] ?? 0) >= dailyLimit()) return null;

    let next = state.ideas.find((idea) => idea.status === "practising") ?? state.ideas.find((idea) => idea.status === "idea");
    if (!next) {
      const added = await TemplateAcademy.propose(3).catch(() => []);
      next = added[0];
      if (!next) return null;
    }
    const build = await startAttempt(next);
    return build?.buildId ?? null;
  },

  /** Listen for practice builds ending, and practise on a timer. Idempotent. */
  start(intervalMs = Number(process.env.ACADEMY_TICK_MS) || 10 * 60_000): void {
    if (!wired) {
      wired = true;
      buildEvents.on("completed", (record: BuildRecord) => finished(record, "completed"));
      buildEvents.on("failed", (record: BuildRecord) => finished(record, "failed"));
      // Stopped for a customer's order (or by the owner): kept, and carried on later.
      buildEvents.on("stopped", (record: BuildRecord) => finished(record, "stopped"));
    }
    if (timer) return;
    timer = setInterval(() => {
      TemplateAcademy.tick().catch((error) => Logger.warn("Template Academy tick failed", { error: error instanceof Error ? error.message : String(error) }));
    }, intervalMs);
    timer.unref?.();
  },

  stop(): void {
    if (timer) clearInterval(timer);
    timer = null;
  }
};
