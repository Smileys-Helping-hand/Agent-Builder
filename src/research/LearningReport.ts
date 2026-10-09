/**
 * LearningReport — what the builder has learned so far, written to teach.
 *
 * One report across every research topic and every lesson the builds have
 * taught it: the strongest findings, explained plainly, the rules it now
 * follows when building, what it is still unsure about, and questions to test
 * yourself with. The model writes it from the findings alone; when the model
 * is not available, a plain report is put together from the same material, so
 * there is always something to read.
 *
 * A report can then be handed on, so learning does not stay in one place:
 *   - teach the builder: each rule becomes a build lesson, retrieved into
 *     future builds whose task it fits, and scored on whether it helped
 *   - send to Jarvis: stored in Second-Brain's knowledge (which Jarvis recalls
 *     from) and announced on his webhook
 *
 * Reports are kept in data/learning-reports.json, newest first.
 */
import fs from "fs";
import path from "path";

import { JarvisClient } from "../integrations/JarvisClient.js";
import { SecondBrainClient } from "../integrations/SecondBrainClient.js";
import { LessonMemory, type Lesson } from "../learning/LessonMemory.js";
import { ModelRouter } from "../tools/ModelRouter.js";
import { Logger } from "../utils/Logger.js";
import { ResearchStore, type ResearchFinding } from "./ResearchStore.js";

const FILE = path.resolve("./data/learning-reports.json");
const KEEP = 20;
const FINDINGS_PER_TOPIC = 8;

export interface LearningReport {
  id: string;
  createdAt: string;
  title: string;
  markdown: string;
  /** Short, actionable rules for building, drawn from the findings. */
  rules: string[];
  stats: { topics: number; findings: number; confirmed: number; contested: number; lessons: number };
  /** Written by the model, or put together without one. */
  writtenBy: "model" | "plain";
  taughtAt: string | null;
  taughtCount: number;
  sentToJarvisAt: string | null;
  sentResult: string | null;
}

export interface ReportJob {
  state: "running" | "done" | "failed";
  startedAt: string;
  step: string;
  reportId: string | null;
  error: string | null;
}

let job: ReportJob | null = null;

const read = (): LearningReport[] => {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8")) as LearningReport[];
  } catch {
    return [];
  }
};

const write = (reports: LearningReport[]) => {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(reports.slice(0, KEEP), null, 2));
};

const save = (report: LearningReport) => write([report, ...read().filter((entry) => entry.id !== report.id)]);

interface Material {
  topics: Array<{ title: string; question: string; findings: ResearchFinding[]; open: string[]; contested: number }>;
  lessons: Lesson[];
  stats: LearningReport["stats"];
}

const gather = (): Material => {
  const topics = ResearchStore.listTopics().map((topic) => {
    const findings = ResearchStore.listFindings(topic.id, FINDINGS_PER_TOPIC, "strongest");
    return {
      title: topic.title,
      question: topic.question,
      findings,
      open: ResearchStore.listQuestions(topic.id, 4, "open").map((question) => question.text),
      contested: findings.filter((finding) => finding.status === "contested").length
    };
  });
  // What builds taught it — rules taught from research reports are not that, and would only echo back.
  const lessons = LessonMemory.list(undefined, 200)
    .filter((lesson) => !lesson.signature.startsWith("Research: ") && lesson.utility >= 0.4)
    .slice(0, 15);
  const all = topics.flatMap((topic) => topic.findings);
  return {
    topics: topics.filter((topic) => topic.findings.length > 0),
    lessons,
    stats: {
      topics: topics.length,
      findings: all.length,
      confirmed: all.filter((finding) => finding.status === "corroborated").length,
      contested: all.filter((finding) => finding.status === "contested").length,
      lessons: lessons.length
    }
  };
};

const strength = (finding: ResearchFinding) =>
  finding.status === "corroborated" ? "confirmed" : finding.status === "contested" ? "CONTESTED" : `${Math.round(finding.confidence * 100)}% sure`;

const track = (lesson: Lesson) => (lesson.timesApplied ? `helped ${lesson.timesHelped} of ${lesson.timesApplied} times` : "not used yet");

/** Lines starting "- " under the rules heading. */
export const parseRules = (markdown: string): string[] => {
  const section = markdown.split(/^##\s+Rules for the builder.*$/im)[1];
  if (!section) return [];
  return section
    .split(/^##\s/m)[0]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^([-*]|\d+[.)])\s+/.test(line))
    .map((line) => line.replace(/^([-*]|\d+[.)])\s+/, "").replace(/\*\*/g, "").trim())
    .filter((line) => line.length >= 12 && line.length <= 300)
    .slice(0, 12);
};

/** Without a model: the same material, laid out plainly. */
const plainReport = (material: Material): { markdown: string; rules: string[] } => {
  const lines: string[] = ["## What I have learned", ""];
  for (const topic of material.topics) {
    lines.push(`### ${topic.title}`, "", `_${topic.question}_`, "");
    for (const finding of topic.findings) lines.push(`- ${finding.claim} (${strength(finding)}${finding.sourceTitle ? ` — ${finding.sourceTitle}` : ""})`);
    if (topic.open.length) lines.push("", "Still open:", ...topic.open.map((question) => `- ${question}`));
    lines.push("");
  }
  const rules = material.topics
    .flatMap((topic) => topic.findings.filter((finding) => finding.status !== "contested"))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 8)
    .map((finding) => finding.claim);
  lines.push("## Rules for the builder", "", ...rules.map((rule) => `- ${rule}`), "");
  if (material.lessons.length) {
    lines.push("## What the builds have taught it", "", ...material.lessons.map((lesson) => `- ${lesson.lesson} (${track(lesson)})`), "");
  }
  return { markdown: lines.join("\n"), rules };
};

const generate = async (): Promise<LearningReport> => {
  const material = gather();
  if (!material.topics.length && !material.lessons.length) {
    throw new Error("Nothing learned yet: start a research topic (or run a few builds) and come back once it has findings.");
  }
  const date = new Date();
  const title = `What I have learned — ${date.toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" })}`;
  const header = `_${material.stats.findings} findings across ${material.topics.length} topic(s) (${material.stats.confirmed} confirmed, ${material.stats.contested} contested) and ${material.lessons.length} lesson(s) from builds._`;

  let body: { markdown: string; rules: string[] };
  let writtenBy: LearningReport["writtenBy"] = "model";
  try {
    if (job) job.step = "Writing it up (the local model)…";
    const material_lines = material.topics
      .map(
        (topic) =>
          `TOPIC: ${topic.title}\nQUESTION: ${topic.question}\n${topic.findings.map((finding) => `- ${finding.claim} [${strength(finding)}]`).join("\n")}${
            topic.open.length ? `\nSTILL OPEN: ${topic.open.join(" | ")}` : ""
          }`
      )
      .join("\n\n");
    const lessonLines = material.lessons.map((lesson) => `- ${lesson.lesson} (${track(lesson)})`).join("\n");
    const written = await ModelRouter.generate(
      `You are a builder of websites and apps teaching your owner what your research has taught you so far.

${material_lines || "(no research topics yet)"}

${lessonLines ? `Lessons your own builds taught you (what fixed real failures):\n${lessonLines}` : ""}

Write Markdown with exactly these sections:
## In short: 3-5 sentences on the most important things learned, in plain language
## What I have learned: for each topic a "### <topic>" heading, then its key points explained simply (what it means, why it matters), confirmed points first; say plainly where something is CONTESTED
## Rules for the builder: 5 to 10 bullets, each one short, concrete rule a website/app builder can follow when building (start each with a verb, e.g. "Use…", "Keep…", "Never…"), drawn only from the findings and lessons
## Still unsure about: the real gaps and contested points
## Test yourself: 5 questions with the answers underneath each, as "**Q:** …" then "**A:** …"

Rules: no title heading; use ONLY the material above; never invent facts, numbers or sources.`
    );
    const rules = parseRules(written);
    if (written.trim().length < 200 || rules.length === 0) throw new Error("The model's report came back too thin.");
    body = { markdown: written.replace(/^#\s+.*\n+/, ""), rules };
  } catch (error) {
    Logger.warn("Learning report: writing it plainly instead", { error: error instanceof Error ? error.message : String(error) });
    writtenBy = "plain";
    body = plainReport(material);
  }

  const sources = material.topics
    .flatMap((topic) => topic.findings)
    .filter((finding) => finding.sourceUrl)
    .reduce<Map<string, string>>((map, finding) => map.set(finding.sourceUrl!, finding.sourceTitle ?? finding.sourceUrl!), new Map());

  const markdown = [
    `# ${title}`,
    "",
    header,
    "",
    body.markdown.trim(),
    "",
    sources.size ? `## Sources\n\n${[...sources].slice(0, 40).map(([url, name]) => `- [${name}](${url})`).join("\n")}` : "",
    ""
  ].join("\n");

  return {
    id: `report-${date.getTime()}`,
    createdAt: date.toISOString(),
    title,
    markdown,
    rules: body.rules,
    stats: material.stats,
    writtenBy,
    taughtAt: null,
    taughtCount: 0,
    sentToJarvisAt: null,
    sentResult: null
  };
};

export const LearningReports = {
  list(): LearningReport[] {
    return read();
  },

  get(id: string): LearningReport | null {
    return read().find((report) => report.id === id) ?? null;
  },

  job(): ReportJob | null {
    return job;
  },

  /** Start writing a new report; follow it with job(). */
  start(): ReportJob {
    if (job?.state === "running") return job;
    const current: ReportJob = { state: "running", startedAt: new Date().toISOString(), step: "Gathering findings and lessons…", reportId: null, error: null };
    job = current;
    void generate()
      .then((report) => {
        save(report);
        current.state = "done";
        current.step = "Ready";
        current.reportId = report.id;
        Logger.log("Learning report written", { id: report.id, writtenBy: report.writtenBy, rules: report.rules.length });
      })
      .catch((error: unknown) => {
        current.state = "failed";
        current.error = error instanceof Error ? error.message : String(error);
      });
    return current;
  },

  /**
   * Teach the builder: each rule becomes a build lesson. Retrieval only hands
   * a lesson to a build whose task shares its words, and every use is scored,
   * so a rule that does not help sinks on its own.
   */
  teach(id: string, rules?: string[]): { report: LearningReport; taught: number; fresh: number } {
    const report = this.get(id);
    if (!report) throw new Error("Unknown report.");
    const chosen = (rules?.length ? rules : report.rules).map((rule) => rule.trim()).filter((rule) => rule.length >= 12).slice(0, 20);
    if (!chosen.length) throw new Error("This report has no rules to teach.");
    let fresh = 0;
    for (const rule of chosen) {
      if (LessonMemory.recordTaught("build", `Research: ${rule.slice(0, 200)}`, rule, `From "${report.title}"`).created) fresh += 1;
    }
    const updated = { ...report, taughtAt: new Date().toISOString(), taughtCount: chosen.length };
    save(updated);
    return { report: updated, taught: chosen.length, fresh };
  },

  /** Send to Jarvis: into Second-Brain's knowledge (what he recalls from) and onto his webhook. */
  async sendToJarvis(id: string): Promise<{ report: LearningReport; knowledge: string; webhook: string; ok: boolean }> {
    const report = this.get(id);
    if (!report) throw new Error("Unknown report.");
    SecondBrainClient.enqueueDocument(`agent-builder-learning-${report.id}`, report.title, report.markdown);
    const synced = await SecondBrainClient.processQueue().catch(() => null);
    const knowledge = synced?.synced
      ? "stored in Second-Brain's knowledge"
      : `queued for Second-Brain — sent as soon as it answers${synced?.reason ? ` (${synced.reason})` : ""}`;
    const sent = await JarvisClient.send({
      type: "research",
      subject: report.title,
      body: `${report.markdown.slice(0, 6000)}${report.markdown.length > 6000 ? "\n\n…(the full report is in your knowledge base)" : ""}`,
      metadata: { reportId: report.id, rules: report.rules, stats: report.stats }
    });
    // His own words when he sends them; an older Jarvis only answers 201.
    const webhook = sent.ok ? (sent.acknowledgement ? `Jarvis: ${sent.acknowledgement}` : "Jarvis has it") : JarvisClient.isConfigured() ? `Jarvis did not answer (${sent.detail}); it is retried` : "Jarvis is not set up on this PC (JARVIS_HOST / JARVIS_API_KEY)";
    const updated = { ...report, sentToJarvisAt: new Date().toISOString(), sentResult: `${knowledge}; ${webhook}` };
    save(updated);
    return { report: updated, knowledge, webhook, ok: sent.ok };
  },

  remove(id: string): boolean {
    const reports = read();
    const next = reports.filter((report) => report.id !== id);
    if (next.length === reports.length) return false;
    write(next);
    return true;
  }
};
