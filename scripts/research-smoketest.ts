/*
 * Research & learning smoke test. Exercises the new modules against live keyless
 * sources, a throwaway database, and a mock Second-Brain. No model calls.
 */
import http from "http";
import os from "os";
import path from "path";
import fs from "fs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ab-knowledge-"));
process.env.KNOWLEDGE_DB_PATH = path.join(tmp, "knowledge.db");

const results: Array<[string, boolean, string]> = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push([name, ok, detail]);
};

const { ResearchStore } = await import("../src/research/ResearchStore.js");
const { LessonMemory } = await import("../src/learning/LessonMemory.js");
const { SecondBrainClient } = await import("../src/integrations/SecondBrainClient.js");
const Sources = await import("../src/research/SourceProviders.js");
const { getKnowledgeDb } = await import("../src/knowledge/KnowledgeDb.js");

// 1. SSRF guard -------------------------------------------------------------
const ssrfCases: Record<string, boolean> = {
  "http://localhost:4000/api": false,
  "http://127.0.0.1/": false,
  "http://10.1.2.3/": false,
  "http://192.168.0.5/": false,
  "http://172.20.0.1/": false,
  "http://169.254.169.254/latest/meta-data": false,
  "http://[::1]/": false,
  "file:///etc/passwd": false,
  "https://en.wikipedia.org/wiki/Retrieval-augmented_generation": true
};
for (const [url, expected] of Object.entries(ssrfCases)) {
  check(`isPublicHttpUrl(${url}) === ${expected}`, Sources.isPublicHttpUrl(url) === expected);
}

// 2. Live search -------------------------------------------------------------
const { results: hits, errors } = await Sources.searchAll("retrieval augmented generation", 2);
const byProvider = hits.reduce<Record<string, number>>((acc, hit) => {
  acc[hit.provider] = (acc[hit.provider] ?? 0) + 1;
  return acc;
}, {});
check(
  "searchAll returns results from several providers",
  Object.keys(byProvider).length >= 3,
  JSON.stringify(byProvider) + (Object.keys(errors).length ? ` unavailable=${JSON.stringify(errors)}` : "")
);
check("searchAll de-duplicates URLs", new Set(hits.map((hit) => hit.url)).size === hits.length);
{
  // A provider in cooldown must not be called again on the next search.
  const throttled = Object.entries(errors).filter(([, message]) => /HTTP (429|403)\b|timed out after/.test(message as string));
  if (throttled.length > 0) {
    const again = await Sources.searchAll("retrieval augmented generation", 1);
    check(
      "a throttled provider is skipped on the next search instead of being hit again",
      throttled.every(([name]) => /cooling down/.test((again.errors as Record<string, string>)[name] ?? "")),
      JSON.stringify(again.errors)
    );
  }
}

// 3. Reading -----------------------------------------------------------------
for (const provider of ["wikipedia", "web", "arxiv", "github"] as const) {
  const hit = hits.find((candidate) => candidate.provider === provider);
  if (!hit && errors[provider] && /HTTP (429|403)\b|timed out after/.test(errors[provider] as string)) {
    // The provider is throttling this machine — not something this code can fix.
    // Proving the loop backs off from it is the meaningful check here.
    check(
      `fetchDocument(${provider}) skipped: provider throttling (${errors[provider]}); cooldown engaged`,
      Boolean(Sources.providerCooldowns()[provider])
    );
    continue;
  }
  if (!hit) {
    check(`fetchDocument(${provider})`, false, errors[provider] ?? "provider returned no result");
    continue;
  }
  try {
    const doc = await Sources.fetchDocument(hit);
    check(`fetchDocument(${provider}) yields readable text`, Boolean(doc && doc.text.length >= 200), doc ? `${doc.text.length} chars — "${doc.title.slice(0, 60)}"` : "null");
  } catch (error) {
    check(`fetchDocument(${provider})`, false, (error as Error).message);
  }
}

// 4. Store behaviour -----------------------------------------------------------
const topic = ResearchStore.createTopic("Retrieval augmented generation", "How does RAG work and where does it fail?");
check("new topic's question seeds the frontier", ResearchStore.nextQuestions(topic.id, 5).length === 1);

const sourceA = ResearchStore.addSource(topic.id, { url: "https://example.org/a", title: "A", provider: "web", contentHash: "h1", excerpt: null }, 1)!;
const sourceB = ResearchStore.addSource(topic.id, { url: "https://example.org/b", title: "B", provider: "web", contentHash: "h2", excerpt: null }, 1)!;
check(
  "a URL already read is rejected",
  ResearchStore.addSource(topic.id, { url: "https://example.org/a", title: "A again", provider: "web", contentHash: "h3", excerpt: null }, 2) === null
);

const claim = "Retrieval augmented generation retrieves passages from an external corpus and adds them to the prompt before generation.";
const first = ResearchStore.addOrReinforceFinding(topic.id, { claim, sourceId: sourceA.id, confidence: 0.6 }, 1);
const sameSource = ResearchStore.addOrReinforceFinding(topic.id, { claim, sourceId: sourceA.id, confidence: 0.9 }, 1);
check(
  "the same source restating a claim does not corroborate it",
  first.isNew && !sameSource.isNew && sameSource.finding.supportCount === 1 && sameSource.finding.status === "open"
);
const reworded = "Retrieval-augmented generation retrieves passages from an external corpus and adds them into the prompt before generation.";
const second = ResearchStore.addOrReinforceFinding(topic.id, { claim: reworded, sourceId: sourceB.id, confidence: 0.7 }, 2);
check(
  "a reworded claim from a second source corroborates instead of duplicating",
  !second.isNew && second.finding.supportCount === 2 && second.finding.status === "corroborated",
  JSON.stringify({ support: second.finding.supportCount, status: second.finding.status })
);
ResearchStore.markContested(first.finding.id);
check("contested status persists", ResearchStore.findFindingByText(topic.id, claim)?.status === "contested");

check("a new question is added to the frontier", ResearchStore.addQuestion(topic.id, "What chunking strategies improve retrieval precision?", 0.6, 1));
check("a reworded question is rejected", !ResearchStore.addQuestion(topic.id, "Which chunking strategies improve retrieval precision?", 0.6, 1));

const docV1 = ResearchStore.saveDocument(topic.id, "summary", "Summary", "# Summary\nEarly draft about embeddings", 1);
const docV2 = ResearchStore.saveDocument(topic.id, "summary", "Summary", "# Summary\nHNSW vector indexes accelerate nearest neighbour lookup", 2);
check("document versions increment", docV1.version === 1 && docV2.version === 2);
check("only the latest version of a document is listed", ResearchStore.latestDocuments(topic.id).map((doc) => doc.version).join() === "2");

const hitsForIndex = ResearchStore.search("vector index lookup", 10);
const summaryHits = hitsForIndex.filter((hit) => hit.kind === "document:summary");
check(
  "full-text search finds the latest document with a highlighted snippet (stemmed match)",
  summaryHits.length === 1 && summaryHits[0].snippet.includes("«"),
  JSON.stringify(hitsForIndex.map((hit) => [hit.kind, hit.snippet]))
);
check("superseded document versions are not searchable", ResearchStore.search("early draft embeddings", 10).every((hit) => hit.kind !== "document:summary"));

let unsafeQueryOk = true;
try {
  ResearchStore.search('"unbalanced AND (quote OR NEAR(', 5);
} catch {
  unsafeQueryOk = false;
}
check("search tolerates FTS operator syntax in user input", unsafeQueryOk);

ResearchStore.deleteTopic(topic.id);
const leftover = (getKnowledgeDb().prepare("SELECT COUNT(*) AS c FROM knowledge_fts WHERE topic_id = ?").get(topic.id) as { c: number }).c;
check("deleting a topic removes its searchable text", leftover === 0 && ResearchStore.getTopic(topic.id) === null);

// 4b. Topic relevance gate ------------------------------------------------------
const { ResearchEngine } = await import("../src/research/ResearchEngine.js");
check(
  "topic gate skips a page that never mentions the topic",
  !ResearchEngine.mentionsTopic(
    "WebAssembly component model",
    "Climate change is the long-term shift in temperatures and weather patterns. Climate models have many components."
  )
);
check(
  "topic gate keeps a page about the topic",
  ResearchEngine.mentionsTopic("WebAssembly component model", "The WebAssembly Component Model defines how components interoperate across languages.")
);
check(
  "topic gate handles hyphenated titles and plurals",
  ResearchEngine.mentionsTopic("Retrieval-augmented generation", "RAG systems combine retrieval with augmented text generation.")
);

// 5. Lesson memory -------------------------------------------------------------
check("seed lessons insert once", LessonMemory.seed() === 5 && LessonMemory.seed() === 0);

const jestOutput = [
  "> eager-exec-regression-check@1.0.0 test",
  "> jest",
  "  console.error",
  "    Usage: node index.js <string>",
  '  ●  process.exit called with "1"',
  "      at Object.<anonymous> (src/index.js:20:11)",
  "      at Object.<anonymous> (test/index.test.js:1:46)"
].join("\n");
const signature = LessonMemory.errorSignature("test", jestOutput);
check(
  "error signature keeps the error and normalises numbers and file paths",
  signature.startsWith("test:") && signature.includes("process.exit called with") && !signature.includes("src/index.js") && !/\d/.test(signature),
  signature
);
const relevant = LessonMemory.relevant("build", `${signature}\n${jestOutput}`, 4);
check("relevant() ranks the CLI-guard lesson first for that failure", relevant[0]?.lesson.includes("require.main") === true, relevant.map((lesson) => lesson.signature).join(" || "));

// The exact vitest output from the live build that exposed both bugs.
const vitestOutput = [
  " RUN  v2.1.9 E:/Projects/Agent-Builder/builds/build_1789250201840",
  " ❯ yield-check/test/index.test.js (2 tests | 1 failed) 9ms",
  "   × reverseString > reverses a string",
  "     → reverseString is not a function",
  " FAIL  yield-check/test/index.test.js > reverseString > reverses a string",
  "TypeError: reverseString is not a function",
  " Test Files  1 failed (1)",
  "      Tests  1 failed | 1 passed (2)",
  "   Duration  412ms"
].join("\n");
const vitestSignature = LessonMemory.errorSignature("test", vitestOutput);
check(
  "signature takes the concrete error over runner summary lines, with no project name or duration",
  vitestSignature.includes("is not a function") && !/yield-check|\d|tests \||ms\b/.test(vitestSignature),
  vitestSignature
);
const vitestLessons = LessonMemory.relevant("build", `${vitestSignature}\n${vitestOutput}`, 4);
check(
  "unrelated lessons are not retrieved (and so can't be credited) for an unrelated failure",
  !vitestLessons.some((lesson) => /No test files found|from 'jest'|ERR_MODULE_NOT_FOUND|require is not defined/.test(lesson.signature)),
  vitestLessons.map((lesson) => lesson.signature).join(" || ") || "(none retrieved)"
);

const fix = LessonMemory.recordFix("build", "typecheck: TS2307 cannot find module <file>", "Fix the import path or install the missing package and its types.", null);
check("a new confirmed fix starts at utility 2/3", Math.abs(fix.utility - 2 / 3) < 1e-9 && fix.timesHelped === 1 && fix.timesApplied === 1);
const again = LessonMemory.recordFix("build", "typecheck: TS2307 cannot find module <file>", "Different wording that should not replace a good lesson", null);
check("a repeated fix reinforces the existing lesson", again.id === fix.id && again.timesHelped === 2 && again.lesson === fix.lesson);

const tenFailures = Array.from({ length: 10 }, () => fix.id);
LessonMemory.markApplied(tenFailures);
LessonMemory.recordOutcome(tenFailures, false);
const retired = LessonMemory.list("build").find((lesson) => lesson.id === fix.id)!;
check(
  "a lesson that keeps failing drops out of retrieval",
  retired.utility < 0.25 && !LessonMemory.relevant("build", "typecheck TS2307 cannot find module", 10).some((lesson) => lesson.id === fix.id),
  `utility=${retired.utility.toFixed(3)} applied=${retired.timesApplied} helped=${retired.timesHelped}`
);

// 6. Second-Brain client against a mock server --------------------------------------
const received: Array<{ externalId: string; title: string; content: string }> = [];
let rejectKey = false;
const mock = http.createServer((req, res) => {
  if (req.url === "/api/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"status":"ok"}');
    return;
  }
  if (req.url === "/api/ecosystem/knowledge" && req.method === "POST") {
    if (rejectKey || req.headers["x-jarvis-api-key"] !== "jb_test_key") {
      res.writeHead(401, { "content-type": "application/json" });
      res.end('{"error":"Invalid or revoked Jarvis API key"}');
      return;
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      received.push(JSON.parse(body));
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: `doc-${received.length}`, created: true }));
    });
    return;
  }
  res.writeHead(404);
  res.end();
});
await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", resolve));
const port = (mock.address() as { port: number }).port;
process.env.SECOND_BRAIN_HOST = `http://127.0.0.1:${port}`;
process.env.SECOND_BRAIN_API_KEY = "jb_test_key";
process.env.DASHBOARD_URL = "http://localhost:3000";

SecondBrainClient.enqueueDocument("research:test:summary", "Summary: test", "# hello");
SecondBrainClient.enqueueDocument("research:test:report", "Report: test", "# report");
const pass1 = await SecondBrainClient.processQueue();
check(
  "sync delivers queued documents with the API key",
  pass1.synced === 2 && received.length === 2 && received.some((doc) => doc.externalId === "research:test:summary"),
  JSON.stringify(pass1)
);

SecondBrainClient.enqueueDocument("research:test:summary", "Summary: test", "# hello v2");
rejectKey = true;
const pass2 = await SecondBrainClient.processQueue();
const item = SecondBrainClient.listQueue(10).find((entry) => entry.externalId === "research:test:summary");
check(
  "a rejected key is recorded with a clear error and backs off",
  pass2.failed === 1 && item?.attempts === 1 && /rejected the API key/.test(item?.lastError ?? ""),
  JSON.stringify({ pass2, lastError: item?.lastError })
);
const pass3 = await SecondBrainClient.processQueue();
check("a backed-off document is not retried immediately", pass3.synced === 0 && pass3.failed === 0);

const status = await SecondBrainClient.status();
check(
  "status verifies Second-Brain via /api/health and reports the queue",
  status.reachable && status.identityVerified && status.queue.synced === 1 && status.queue.retrying === 1,
  JSON.stringify(status.queue)
);
process.env.SECOND_BRAIN_HOST = "http://localhost:3000";
const collision = await SecondBrainClient.status();
check(
  "status warns when Second-Brain points at the dashboard's own address",
  collision.warnings.some((warning) => warning.includes("same address as the Agent-Builder dashboard"))
);
mock.close();
getKnowledgeDb().close();

// Report --------------------------------------------------------------------------
let failures = 0;
for (const [name, ok, detail] of results) {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n        ${detail}` : ""}`);
}
console.log(`\n${results.length - failures}/${results.length} checks passed`);
process.exit(failures > 0 ? 1 : 0);
