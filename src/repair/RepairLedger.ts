/**
 * RepairLedger — every repair attempt, remembered by the errors it was for.
 *
 * The repair loop forgot each attempt as soon as it ended, so the model kept
 * trying the same fix: the same files, the same edit, the same errors after.
 * Each attempt is now recorded under the fingerprint of the errors it tried to
 * fix (ErrorFingerprint: the same problem, whatever the line numbers), with the
 * files it changed, a hash of exactly what it changed, the error count before
 * and after, and whether it helped. Before the next attempt:
 *   - `brief()` tells the model what was already tried for these errors and how
 *     it went, and asks for a different approach;
 *   - `repeated()` recognises a patch identical to one that already failed, so
 *     it is undone at once instead of being judged again;
 *   - `stuck()` says when the attempts for one problem have run out (across
 *     builds and sessions), so the caller stops and escalates to a person.
 *
 * Kept in data/repair-ledger.jsonl (the newest 5000 attempts).
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";

export type RepairResult = "fixed" | "better" | "same" | "worse" | "repeat";

export interface RepairAttempt {
  at: string;
  project: string;
  fingerprint: string;
  check: string;
  /** Who tried it: build repair, continuous step, stuck doctor, install doctor. */
  by: string;
  files: string[];
  patchHash: string;
  errorsBefore: number;
  errorsAfter: number;
  result: RepairResult;
  /** One line on the approach, when known. */
  approach?: string;
}

const FILE = () => path.resolve(process.env.REPAIR_LEDGER_PATH ?? "data/repair-ledger.jsonl");
const LIMIT = 5000;
let cache: RepairAttempt[] | null = null;

const load = (): RepairAttempt[] => {
  if (cache) return cache;
  try {
    cache = fs
      .readFileSync(FILE(), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RepairAttempt);
  } catch {
    cache = [];
  }
  return cache;
};

/** A stable hash of exactly what a patch changed: each changed file's path and new content. */
export const patchHash = (before: Record<string, string>, after: Record<string, string>): { hash: string; files: string[] } => {
  const files = Object.keys(after)
    .filter((file) => before[file] !== after[file])
    .concat(Object.keys(before).filter((file) => !(file in after)))
    .sort();
  const hash = crypto.createHash("sha1");
  for (const file of files) hash.update(`${file}\0${after[file] ?? "<deleted>"}\0`);
  return { hash: hash.digest("hex").slice(0, 16), files };
};

export const resultOf = (errorsBefore: number, errorsAfter: number, passedAfter: boolean): RepairResult =>
  passedAfter ? "fixed" : errorsAfter < errorsBefore ? "better" : errorsAfter > errorsBefore ? "worse" : "same";

/** Attempts that did not help, the most a problem gets before a person is asked (REPAIR_BUDGET). */
const BUDGET = () => Number(process.env.REPAIR_BUDGET ?? 12);

export const RepairLedger = {
  record(attempt: Omit<RepairAttempt, "at">): RepairAttempt {
    const entry: RepairAttempt = { at: new Date().toISOString(), ...attempt };
    const all = load();
    all.push(entry);
    if (all.length > LIMIT) all.splice(0, all.length - LIMIT);
    try {
      fs.mkdirSync(path.dirname(FILE()), { recursive: true });
      if (all.length === LIMIT) fs.writeFileSync(FILE(), all.map((a) => JSON.stringify(a)).join("\n") + "\n");
      else fs.appendFileSync(FILE(), `${JSON.stringify(entry)}\n`);
    } catch {
      // the ledger must never break a repair
    }
    return entry;
  },

  /** Attempts for these errors, newest last (in this project first, then anywhere). */
  history(fingerprint: string, project?: string): RepairAttempt[] {
    const matching = load().filter((a) => a.fingerprint === fingerprint);
    return project ? [...matching.filter((a) => a.project !== project), ...matching.filter((a) => a.project === project)] : matching;
  },

  /** A patch identical to one that already failed for these errors. */
  repeated(fingerprint: string, hash: string): RepairAttempt | null {
    return load().find((a) => a.fingerprint === fingerprint && a.patchHash === hash && a.result !== "fixed" && a.result !== "better") ?? null;
  },

  /** Failed attempts for these errors in this project, and whether the budget is spent. */
  stuck(fingerprint: string, project: string): { failed: number; budget: number; stuck: boolean } {
    const failed = load().filter((a) => a.fingerprint === fingerprint && a.project === project && (a.result === "same" || a.result === "worse" || a.result === "repeat")).length;
    return { failed, budget: BUDGET(), stuck: failed >= BUDGET() };
  },

  /** What to tell the model before it tries again: what was tried for these errors, and how it went. */
  brief(fingerprint: string, project: string, limit = 6): string {
    const history = RepairLedger.history(fingerprint, project).slice(-limit);
    if (!history.length) return "";
    const lines = history.map((a) => {
      const how = a.result === "fixed" ? "FIXED it" : a.result === "better" ? `helped (${a.errorsBefore} → ${a.errorsAfter} errors)` : a.result === "worse" ? `made it worse (${a.errorsBefore} → ${a.errorsAfter} errors)` : a.result === "repeat" ? "repeated an earlier failed patch exactly" : `changed nothing (${a.errorsAfter} errors still)`;
      return `- ${a.project === project ? "here" : `in ${a.project}`}, ${a.by}${a.approach ? ` (${a.approach.slice(0, 120)})` : ""}: changed ${a.files.slice(0, 5).join(", ") || "no files"}${a.files.length > 5 ? ` and ${a.files.length - 5} more` : ""}; ${how}`;
    });
    const failed = history.filter((a) => a.result !== "fixed" && a.result !== "better").length;
    return `\nAlready tried for these same errors (${history.length} attempt(s), ${failed} did not help):\n${lines.join("\n")}\n${failed ? "Do not repeat an approach that did not help: find a different cause or a different fix. If the same files were changed without effect, the problem is probably elsewhere (another file, a config, a dependency, the file's name or type).\n" : ""}`;
  },

  /** For tests. */
  _reset(): void {
    cache = null;
  }
};
