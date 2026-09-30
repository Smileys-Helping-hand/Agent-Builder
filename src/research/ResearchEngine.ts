/**
 * ResearchEngine - continuous, self-directing research.
 *
 * A topic runs in cycles until you pause or stop it, and resumes after a
 * restart. Each cycle takes the highest-priority open questions, searches every
 * reachable source, reads only material it hasn't read before, and has the
 * local model extract findings — which are then checked against the source
 * text before they're kept. Follow-up questions go back onto the frontier, so
 * each answer points at the next thing to look for. When a topic stops
 * yielding anything new, the engine generates fresh angles and backs off
 * exponentially instead of rereading the same pages every minute. Study
 * documents are regenerated as findings accumulate and synced to Second-Brain.
 */
import { ModelRouter } from "../tools/ModelRouter.js";
import { Logger } from "../utils/Logger.js";
import { emitServerEvent } from "../server/eventBus.js";
import { WorkloadCoordinator } from "../utils/WorkloadCoordinator.js";
import { SecondBrainClient } from "../integrations/SecondBrainClient.js";
import { contentTokens, jaccard, nowIso } from "../knowledge/KnowledgeDb.js";
import {
  ResearchStore,
  type ResearchDocument,
  type ResearchFinding,
  type ResearchQuestion,
  type ResearchTopic
} from "./ResearchStore.js";
import { fetchDocument, keywordQuery, searchAll, type SearchResult } from "./SourceProviders.js";

const envMs = (name: string, fallback: number): number => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

const BASE_DELAY_MS = envMs("RESEARCH_CYCLE_DELAY_MS", 60_000);
const MAX_BACKOFF_MS = envMs("RESEARCH_MAX_BACKOFF_MS", 30 * 60_000);
const BUILD_YIELD_DELAY_MS = 30_000;
const QUESTIONS_PER_CYCLE = 2;
const SOURCES_PER_QUESTION = 3;
const RESULTS_PER_PROVIDER = 3;
const SOURCE_CHARS_FOR_MODEL = 6_000;
const DOC_REFRESH_AFTER_NEW_FINDINGS = 8;
const FIRST_DOCS_AFTER_FINDINGS = 3;
const MIN_GROUNDING = 0.5;
const MAX_FINDINGS_PER_SOURCE = 8;
const MAX_FOLLOW_UPS_PER_SOURCE = 3;

type Extraction = {
  relevant?: boolean;
  findings?: Array<{ claim?: unknown; confidence?: unknown }>;
  contradictions?: Array<{ knownFinding?: unknown; sourceSays?: unknown }>;
  followUpQuestions?: unknown[];
};

type CycleOutcome = { newFindings: number; newSources: number; newQuestions: number };

const truncate = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const extractJson = <T>(raw: string): T | null => {
  const cleaned = raw.replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
};

const generateJson = async <T>(prompt: string): Promise<T | null> => {
  const first = extractJson<T>(await ModelRouter.generate(prompt));
  if (first) return first;
  return extractJson<T>(
    await ModelRouter.generate(`${prompt}\n\nYour previous reply was not valid JSON. Reply with ONLY the JSON object, nothing else.`)
  );
};

/**
 * Share of a claim's content words that appear in the source text (loose
 * prefix match, so "indexes" grounds "indexing"). A local model will sometimes
 * state things the page never said; below MIN_GROUNDING the claim is dropped.
 */
const groundingScore = (claim: string, sourceText: string): number => {
  const words = [...new Set(contentTokens(claim))];
  if (words.length === 0) return 0;
  const haystack = sourceText.toLowerCase();
  const grounded = words.filter((word) => haystack.includes(word.length > 5 ? word.slice(0, word.length - 2) : word));
  return grounded.length / words.length;
};

export class ResearchEngine {
  private static instance: ResearchEngine | null = null;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly cyclesInFlight = new Set<string>();
  private readonly documentJobs = new Set<string>();

  static getInstance(): ResearchEngine {
    if (!ResearchEngine.instance) ResearchEngine.instance = new ResearchEngine();
    return ResearchEngine.instance;
  }

  /** Re-arm every topic that was running when the process last stopped — research survives restarts. */
  resumeAll(): number {
    const running = ResearchStore.listTopics().filter((topic) => topic.status === "running");
    // Stagger so several topics don't all hit the GPU the moment the server boots.
    running.forEach((topic, index) => this.schedule(topic.id, 5_000 + index * 15_000));
    return running.length;
  }

  /**
   * Switch research back on, for the power controls. resumeAll only restarts
   * topics already marked running (what a boot should do), but "Free the GPU"
   * marks them paused — so the app's Start buttons, which used to call
   * resumeAll, could never bring research back once it had been paused.
   * Stopped topics stay stopped: that was a decision about the topic, not the GPU.
   */
  startAll(): number {
    for (const topic of ResearchStore.listTopics()) {
      if (topic.status === "paused") this.changeStatus(topic.id, "running", "Research resumed");
    }
    return this.resumeAll();
  }

  start(title: string, question: string): ResearchTopic {
    const topic = ResearchStore.createTopic(title, question);
    ResearchStore.logActivity(topic.id, 0, "status", "Research started");
    this.emit(topic.id, "started");
    this.schedule(topic.id, 0);
    return topic;
  }

  pause(id: string): ResearchTopic | null {
    return this.changeStatus(id, "paused", "Research paused");
  }

  resume(id: string): ResearchTopic | null {
    const topic = this.changeStatus(id, "running", "Research resumed");
    if (topic) this.schedule(id, 0);
    return topic;
  }

  stop(id: string): ResearchTopic | null {
    return this.changeStatus(id, "stopped", "Research stopped");
  }

  /** Start a cycle now instead of waiting for the next scheduled one. */
  runNow(id: string): boolean {
    const topic = ResearchStore.getTopic(id);
    if (!topic || topic.status !== "running") return false;
    if (!this.isCycleRunning(id)) this.schedule(id, 0);
    return true;
  }

  remove(id: string): boolean {
    this.clearTimer(id);
    const removed = ResearchStore.deleteTopic(id);
    if (removed) this.emit(id, "deleted");
    return removed;
  }

  isCycleRunning(id: string): boolean {
    return this.cyclesInFlight.has(id);
  }

  isGeneratingDocuments(id: string): boolean {
    return this.documentJobs.has(id);
  }

  async regenerateDocuments(id: string, cycle?: number): Promise<ResearchDocument[]> {
    const topic = ResearchStore.getTopic(id);
    if (!topic) throw new Error("Research topic not found.");
    if (this.documentJobs.has(id)) throw new Error("Documents are already being generated for this topic.");

    const findings = ResearchStore.listFindings(id, 80, "strongest");
    if (findings.length === 0) {
      throw new Error("No findings yet — documents are generated once the research has found something.");
    }

    this.documentJobs.add(id);
    try {
      const cycleNumber = cycle ?? topic.cycles;
      const citations = new Map<number, number>();
      const bibliography: Array<{ n: number; title: string; url: string }> = [];
      const cite = (finding: ResearchFinding): string => {
        if (finding.sourceId === null || !finding.sourceUrl) return "";
        if (!citations.has(finding.sourceId)) {
          citations.set(finding.sourceId, bibliography.length + 1);
          bibliography.push({ n: bibliography.length + 1, title: finding.sourceTitle ?? finding.sourceUrl, url: finding.sourceUrl });
        }
        return `[${citations.get(finding.sourceId)}]`;
      };
      const describe = (finding: ResearchFinding): string =>
        finding.status === "contested"
          ? "CONTESTED"
          : finding.status === "corroborated"
            ? `corroborated by ${finding.supportCount} sources`
            : `confidence ${finding.confidence.toFixed(2)}`;
      const findingLines = findings.map((finding) => `- ${finding.claim} ${cite(finding)} (${describe(finding)})`);
      // The model gets claims and citations only. Given status/confidence notes, it
      // copied them verbatim into the prose ("... [1] (confidence 0.90)").
      const modelLines = findings.map(
        (finding) => `- ${finding.claim} ${cite(finding)}${finding.status === "contested" ? " (CONTESTED)" : ""}`
      );
      const hasContested = findings.some((finding) => finding.status === "contested");
      // Each document already carries its own title; drop a leading H1 the model adds anyway.
      const withoutTitle = (markdown: string): string => markdown.trim().replace(/^#\s+[^\n]*\n+/, "");
      const openQuestions = ResearchStore.listQuestions(id, 15, "open").map((question) => question.text);
      const sourcesMarkdown = bibliography.map((source) => `${source.n}. [${source.title}](${source.url})`).join("\n");
      const summary = ResearchStore.getTopicSummary(id);
      const header =
        `_${findings.length} findings from ${bibliography.length} sources · ${summary?.corroboratedCount ?? 0} corroborated · ` +
        `${summary?.contestedCount ?? 0} contested · after ${cycleNumber} research cycles · generated ${new Date().toLocaleString()}_`;
      const caveat =
        "> Findings are extracted from the cited sources by a local model and checked against the source text. " +
        "Verify anything important against the original source.";

      const documents: ResearchDocument[] = [];

      documents.push(
        ResearchStore.saveDocument(
          id,
          "report",
          `Research report: ${topic.title}`,
          this.buildReport(topic, findings, cite, describe, openQuestions, sourcesMarkdown, header, caveat),
          findings.length
        )
      );

      const summaryBody = await ModelRouter.generate(
        `Write an executive summary of this research for someone who needs to understand it quickly.

Topic: ${topic.title}
Question: ${topic.question}

Findings (each ends with its citation number${hasContested ? "; CONTESTED means sources disagree" : ""}):
${modelLines.join("\n")}

Open questions still being researched:
${openQuestions.map((question) => `- ${question}`).join("\n") || "- none"}

Write Markdown with:
- A direct answer to the question in 2-4 sentences, as far as the findings support one.
- "## Key points": 5 to 8 bullets, each ending with its citation(s) like [2].
${hasContested ? `- "## Where sources disagree": explain each CONTESTED finding.\n` : ""}- "## What is still unknown": the real gaps, informed by the open questions.

Rules: no title heading; use ONLY the findings above; keep citation numbers exactly as given; never invent a source or statistic; stay under 400 words.`
      );
      documents.push(
        ResearchStore.saveDocument(
          id,
          "summary",
          `Summary: ${topic.title}`,
          `# Summary: ${topic.title}\n\n${header}\n\n${caveat}\n\n${withoutTitle(summaryBody)}\n\n## Sources\n\n${sourcesMarkdown}\n`,
          findings.length
        )
      );

      const guideBody = await ModelRouter.generate(
        `Create a study guide that teaches this material from the ground up.

Topic: ${topic.title}
Question: ${topic.question}

Findings (with citation numbers${hasContested ? "; CONTESTED means sources disagree" : ""}):
${modelLines.join("\n")}

Write Markdown with these sections:
## Core concepts: each concept in bold with a plain-language explanation of 2-3 sentences and its citations
## How it fits together: a short explanation of how the concepts connect
## Flashcards: 10 cards, each formatted exactly as "**Q:** question" on one line and "**A:** answer" on the next
## Common misconceptions: ${hasContested ? "drawn from the CONTESTED findings and other likely confusions" : "likely confusions about this material"}
## Test yourself: 5 questions that require applying the material, then a "### Answers" subsection

Rules: no title heading; use ONLY the findings; keep citation numbers exactly as given; never invent facts.`
      );
      documents.push(
        ResearchStore.saveDocument(
          id,
          "study_guide",
          `Study guide: ${topic.title}`,
          `# Study guide: ${topic.title}\n\n${header}\n\n${caveat}\n\n${withoutTitle(guideBody)}\n\n## Sources\n\n${sourcesMarkdown}\n`,
          findings.length
        )
      );

      for (const document of documents) {
        SecondBrainClient.enqueueDocument(`research:${id}:${document.kind}`, document.title, document.markdown);
      }
      void SecondBrainClient.processQueue().catch(() => undefined);

      ResearchStore.logActivity(
        id,
        cycleNumber,
        "document",
        `Updated summary, study guide and report from ${findings.length} findings (queued for Second-Brain)`
      );
      this.emit(id, "documents-updated", { versions: documents.map((document) => ({ kind: document.kind, version: document.version })) });
      return documents;
    } finally {
      this.documentJobs.delete(id);
    }
  }

  // --- scheduling --------------------------------------------------------

  private changeStatus(id: string, status: "running" | "paused" | "stopped", message: string): ResearchTopic | null {
    if (!ResearchStore.getTopic(id)) return null;
    if (status !== "running") {
      this.clearTimer(id);
      ResearchStore.setNextCycleAt(id, null);
    }
    const topic = ResearchStore.setStatus(id, status);
    ResearchStore.logActivity(id, topic?.cycles ?? 0, "status", message);
    this.emit(id, `status-${status}`);
    return topic;
  }

  private clearTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
  }

  private schedule(id: string, delayMs: number): void {
    this.clearTimer(id);
    ResearchStore.setNextCycleAt(id, new Date(Date.now() + delayMs).toISOString());
    const timer = setTimeout(() => {
      this.timers.delete(id);
      void this.runCycle(id);
    }, delayMs);
    this.timers.set(id, timer);
  }

  private emit(topicId: string, event: string, detail: Record<string, unknown> = {}): void {
    emitServerEvent({ type: "research", payload: { ...detail, topicId, event, timestamp: nowIso() } });
  }

  // --- the cycle ---------------------------------------------------------

  private async runCycle(id: string): Promise<void> {
    if (this.cyclesInFlight.has(id)) return;
    const topic = ResearchStore.getTopic(id);
    if (!topic || topic.status !== "running") return;

    if (WorkloadCoordinator.isBuildActive()) {
      this.schedule(id, BUILD_YIELD_DELAY_MS);
      return;
    }

    this.cyclesInFlight.add(id);
    const cycle = topic.cycles + 1;
    const outcome: CycleOutcome = { newFindings: 0, newSources: 0, newQuestions: 0 };
    let error: string | null = null;

    try {
      ResearchStore.logActivity(id, cycle, "cycle", `Cycle ${cycle} started`);
      this.emit(id, "cycle-started", { cycle });

      let questions = ResearchStore.nextQuestions(id, QUESTIONS_PER_CYCLE);
      if (questions.length === 0 || topic.consecutiveEmptyCycles >= 2) {
        const added = await this.broaden(topic, cycle);
        outcome.newQuestions += added;
        if (questions.length === 0 && added === 0) ResearchStore.reopenExploredQuestions(id, QUESTIONS_PER_CYCLE * 2);
        questions = ResearchStore.nextQuestions(id, QUESTIONS_PER_CYCLE);
      }

      for (const question of questions) {
        if (!this.stillRunning(id) || WorkloadCoordinator.isBuildActive()) break;
        const result = await this.investigate(topic, question, cycle);
        outcome.newFindings += result.newFindings;
        outcome.newSources += result.newSources;
        outcome.newQuestions += result.newQuestions;
        ResearchStore.markQuestionExplored(question.id);
      }

      await this.maybeRefreshDocuments(id, cycle);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
      Logger.warn("Research cycle failed", { topicId: id, cycle, error });
      ResearchStore.logActivity(id, cycle, "error", error);
    } finally {
      this.cyclesInFlight.delete(id);
      const current = ResearchStore.getTopic(id);
      if (current) {
        const found = error ? 0 : outcome.newFindings;
        // Nothing new: back off exponentially so a saturated topic idles
        // politely instead of re-querying the same sources every minute —
        // but it never gives up.
        const delay =
          found > 0 ? BASE_DELAY_MS : Math.min(MAX_BACKOFF_MS, BASE_DELAY_MS * 2 ** Math.min(current.consecutiveEmptyCycles + 1, 10));
        ResearchStore.completeCycle(id, {
          cycle,
          newFindings: found,
          error,
          nextCycleAt: new Date(Date.now() + delay).toISOString()
        });
        ResearchStore.logActivity(
          id,
          cycle,
          "cycle",
          `Cycle ${cycle} finished: ${outcome.newSources} new source(s), ${outcome.newFindings} new finding(s), ${outcome.newQuestions} new question(s)`
        );
        if (found === 0) {
          ResearchStore.logActivity(
            id,
            cycle,
            "backoff",
            `Nothing new this cycle — looking again in ${(delay / 60_000).toFixed(1)} min with new angles`
          );
        }
        this.emit(id, "cycle-completed", { cycle, ...outcome, error, nextCycleInMs: delay });
        if (current.status === "running") this.schedule(id, delay);
      }
    }
  }

  private stillRunning(id: string): boolean {
    return ResearchStore.getTopic(id)?.status === "running";
  }

  private async investigate(topic: ResearchTopic, question: ResearchQuestion, cycle: number): Promise<CycleOutcome> {
    const outcome: CycleOutcome = { newFindings: 0, newSources: 0, newQuestions: 0 };
    // Follow-up questions get the topic's own keywords added so searches stay on topic.
    const query = question.text === topic.question ? question.text : `${question.text} ${keywordQuery(topic.title, 3)}`;
    const { results, errors } = await searchAll(query, RESULTS_PER_PROVIDER);
    const unavailable = Object.keys(errors);
    ResearchStore.logActivity(
      topic.id,
      cycle,
      "search",
      `Searched "${truncate(question.text, 120)}": ${results.length} results` +
        (unavailable.length > 0 ? ` (unavailable right now: ${unavailable.join(", ")})` : "")
    );

    const unread = results.filter((result) => !ResearchStore.hasSource(topic.id, result.url)).slice(0, SOURCES_PER_QUESTION);
    if (unread.length === 0) {
      ResearchStore.logActivity(topic.id, cycle, "search", "Every result for this question has already been read");
      return outcome;
    }

    const knownClaims = ResearchStore.strongestClaims(topic.id, 25);

    for (const result of unread) {
      if (!this.stillRunning(topic.id) || WorkloadCoordinator.isBuildActive()) break;
      const read = await this.readSource(topic, question, result, knownClaims, cycle);
      outcome.newFindings += read.newFindings;
      outcome.newSources += read.newSources;
      outcome.newQuestions += read.newQuestions;
    }
    return outcome;
  }

  /**
   * Whether a page plausibly concerns the topic at all. Deliberately loose — the
   * model still judges real relevance — it only keeps obviously unrelated pages
   * from costing a model call.
   *
   * For titles with distinctive (8+ letter) words: at least half the title's words
   * must appear, including one of its longest words (length is a cheap proxy for
   * the most specific term). This used to require *every* distinctive word, which
   * skipped Tauri's own "Node.js as a sidecar" docs for a topic titled "Node.js
   * backends as Tauri sidecars" — the page never says "backends". Titles without
   * distinctive words keep the plain majority rule.
   */
  static mentionsTopic(topicTitle: string, text: string): boolean {
    const terms = [...new Set(contentTokens(topicTitle))];
    if (terms.length === 0) return true;
    const haystack = text.toLowerCase();
    const present = (term: string) => haystack.includes(term.length > 5 ? term.slice(0, term.length - 2) : term);
    const coverage = terms.filter(present).length / terms.length;
    const distinctive = terms.filter((term) => term.length >= 8);
    if (distinctive.length === 0) return coverage >= 0.6;
    const longest = Math.max(...distinctive.map((term) => term.length));
    return coverage >= 0.5 && distinctive.filter((term) => term.length === longest).some(present);
  }

  private async readSource(
    topic: ResearchTopic,
    question: ResearchQuestion,
    result: SearchResult,
    knownClaims: string[],
    cycle: number
  ): Promise<CycleOutcome> {
    const outcome: CycleOutcome = { newFindings: 0, newSources: 0, newQuestions: 0 };
    const document = await fetchDocument(result).catch(() => null);
    if (!document || document.text.length < 200) return outcome;

    const mirror = ResearchStore.hasContentHash(topic.id, document.contentHash);
    const source = ResearchStore.addSource(
      topic.id,
      {
        url: result.url,
        title: document.title || result.title,
        provider: result.provider,
        contentHash: document.contentHash,
        excerpt: document.text.slice(0, 400)
      },
      cycle
    );
    if (!source) return outcome;
    outcome.newSources += 1;
    if (mirror) {
      ResearchStore.logActivity(topic.id, cycle, "source", `Skipped "${truncate(source.title, 80)}": same content as a source already read`);
      return outcome;
    }

    // Search engines return loosely matching pages — Wikipedia answered a
    // WebAssembly question with "Climate change" and "TRS-80" — and each one
    // cost a full extraction on the GPU just to be judged irrelevant.
    if (!ResearchEngine.mentionsTopic(topic.title, `${source.title}\n${document.text}`)) {
      ResearchStore.logActivity(
        topic.id,
        cycle,
        "source",
        `Skipped "${truncate(source.title, 80)}" (${result.provider}): doesn't mention the topic`
      );
      return outcome;
    }

    const extraction = await generateJson<Extraction>(
      `You are a meticulous research analyst extracting knowledge from ONE source.

Research topic: ${topic.title}
Main question: ${topic.question}
Current sub-question: ${question.text}

Findings already known (do not repeat them; flag any this source contradicts):
${knownClaims.map((claim) => `- ${claim}`).join("\n") || "- none yet"}

Source: ${source.title} (${source.url})
"""
${document.text.slice(0, SOURCE_CHARS_FOR_MODEL)}
"""

Rules:
- Only state what THIS source text supports. No outside knowledge.
- Each finding is one self-contained sentence, specific (names, numbers, mechanisms), 15-60 words.
- Ignore navigation text, advertising and anything off-topic.
- confidence: 0.9 for an established fact stated plainly, 0.6 for a claim made without evidence, 0.3 for speculation.
- followUpQuestions: 1-3 specific questions this source raises but does not answer.
- contradictions: only when the source clearly conflicts with a known finding; quote that finding exactly.

Reply with ONLY this JSON:
{"relevant": true, "findings": [{"claim": "...", "confidence": 0.8}], "contradictions": [{"knownFinding": "...", "sourceSays": "..."}], "followUpQuestions": ["..."]}
If the source is not relevant to the topic, reply {"relevant": false, "findings": [], "contradictions": [], "followUpQuestions": []}`
    );

    if (!extraction) {
      ResearchStore.logActivity(topic.id, cycle, "error", `Could not parse the model's reading of "${truncate(source.title, 80)}"`);
      return outcome;
    }
    if (extraction.relevant === false) {
      ResearchStore.logActivity(topic.id, cycle, "source", `Read "${truncate(source.title, 80)}" (${result.provider}): not relevant`);
      return outcome;
    }

    let discarded = 0;
    for (const item of (extraction.findings ?? []).slice(0, MAX_FINDINGS_PER_SOURCE)) {
      const claim = typeof item.claim === "string" ? item.claim.replace(/\s+/g, " ").trim() : "";
      if (claim.length < 30 || claim.length > 500) continue;
      if (groundingScore(claim, document.text) < MIN_GROUNDING) {
        discarded += 1;
        continue;
      }
      const confidence = typeof item.confidence === "number" ? Math.min(0.95, Math.max(0.05, item.confidence)) : 0.5;
      const { isNew } = ResearchStore.addOrReinforceFinding(topic.id, { claim, sourceId: source.id, confidence }, cycle);
      if (isNew) {
        outcome.newFindings += 1;
        knownClaims.push(claim);
      }
    }

    for (const contradiction of extraction.contradictions ?? []) {
      const known = typeof contradiction.knownFinding === "string" ? contradiction.knownFinding : "";
      const says = typeof contradiction.sourceSays === "string" ? contradiction.sourceSays.replace(/\s+/g, " ").trim() : "";
      if (!known || says.length < 30 || groundingScore(says, document.text) < MIN_GROUNDING) continue;
      const existing = ResearchStore.findFindingByText(topic.id, known, 0.6);
      if (!existing) continue;
      ResearchStore.markContested(existing.id);
      const { finding, isNew } = ResearchStore.addOrReinforceFinding(topic.id, { claim: says, sourceId: source.id, confidence: 0.5 }, cycle);
      ResearchStore.markContested(finding.id);
      if (isNew) outcome.newFindings += 1;
      ResearchStore.logActivity(topic.id, cycle, "finding", `Contested: "${truncate(existing.claim, 120)}" — "${truncate(says, 120)}"`);
    }

    // Follow-ups drift as a topic runs for hours: a topic about code quality
    // ended up asking about "implications for ethical AI practices". Rank each
    // one by how much it still shares with the topic rather than trusting them
    // all equally — drifting questions sink to the bottom of the frontier and
    // are only explored once the focused ones run dry, and a question with
    // nothing in common is dropped.
    const topicTokens = new Set(contentTokens(`${topic.title} ${topic.question}`));
    for (const followUp of (extraction.followUpQuestions ?? []).slice(0, MAX_FOLLOW_UPS_PER_SOURCE)) {
      if (typeof followUp !== "string") continue;
      const overlap = jaccard(contentTokens(followUp), topicTokens);
      if (overlap === 0) continue;
      const priority = Math.min(0.9, 0.35 + overlap * 2);
      if (ResearchStore.addQuestion(topic.id, followUp, priority, cycle)) outcome.newQuestions += 1;
    }

    ResearchStore.logActivity(
      topic.id,
      cycle,
      "source",
      `Read "${truncate(source.title, 80)}" (${result.provider}): ${outcome.newFindings} new finding(s)` +
        (discarded > 0 ? `, ${discarded} claim(s) discarded as not supported by the source` : "")
    );
    return outcome;
  }

  /** Generate new research angles when the frontier is empty or the topic has gone quiet. */
  private async broaden(topic: ResearchTopic, cycle: number): Promise<number> {
    const known = ResearchStore.strongestClaims(topic.id, 20);
    const explored = ResearchStore.listQuestions(topic.id, 25, "explored").map((question) => question.text);
    const reply = await generateJson<{ questions?: unknown[] }>(
      `You direct an open-ended research effort whose job is to keep finding NEW information.

Topic: ${topic.title}
Main question: ${topic.question}

What is already known:
${known.map((claim) => `- ${claim}`).join("\n") || "- nothing yet"}

Questions already investigated:
${explored.map((question) => `- ${question}`).join("\n") || "- none"}

Propose 4 NEW research questions that would uncover information not covered above. Mix these angles: deeper mechanisms,
recent developments, opposing views or failure cases, real-world applications, adjacent fields, and questions that test
whether a known finding actually holds. Each must be specific enough to search for.

Reply with ONLY this JSON: {"questions": ["...", "...", "...", "..."]}`
    );

    let added = 0;
    for (const question of reply?.questions ?? []) {
      if (typeof question === "string" && ResearchStore.addQuestion(topic.id, question, 0.8, cycle)) added += 1;
    }
    if (added > 0) ResearchStore.logActivity(topic.id, cycle, "question", `Generated ${added} new research angle(s)`);
    return added;
  }

  private async maybeRefreshDocuments(id: string, cycle: number): Promise<void> {
    if (this.documentJobs.has(id) || WorkloadCoordinator.isBuildActive()) return;
    const summary = ResearchStore.getTopicSummary(id);
    if (!summary) return;
    const due =
      summary.documentCount > 0
        ? ResearchStore.findingsSinceLatestDocument(id) >= DOC_REFRESH_AFTER_NEW_FINDINGS
        : summary.findingCount >= FIRST_DOCS_AFTER_FINDINGS;
    if (due) await this.regenerateDocuments(id, cycle);
  }

  /** The report is assembled directly from stored data — no model call, so it can't misstate what was found. */
  private buildReport(
    topic: ResearchTopic,
    findings: ResearchFinding[],
    cite: (finding: ResearchFinding) => string,
    describe: (finding: ResearchFinding) => string,
    openQuestions: string[],
    sourcesMarkdown: string,
    header: string,
    caveat: string
  ): string {
    const section = (heading: string, items: ResearchFinding[]) =>
      items.length === 0
        ? ""
        : `## ${heading}\n\n${items.map((finding) => `- ${finding.claim} ${cite(finding)} _(${describe(finding)})_`).join("\n")}\n\n`;
    return (
      `# Research report: ${topic.title}\n\n**Question:** ${topic.question}\n\n${header}\n\n${caveat}\n\n` +
      section("Corroborated findings", findings.filter((finding) => finding.status === "corroborated")) +
      section("Findings", findings.filter((finding) => finding.status === "open")) +
      section("Contested findings", findings.filter((finding) => finding.status === "contested")) +
      (openQuestions.length > 0 ? `## Open questions still being researched\n\n${openQuestions.map((q) => `- ${q}`).join("\n")}\n\n` : "") +
      `## Sources\n\n${sourcesMarkdown}\n`
    );
  }
}
