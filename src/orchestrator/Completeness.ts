/**
 * Completeness — whether a new app does what its brief asked for, not only
 * whether it compiles. A small model's first answer to "a fun phone game with
 * progression" was a menu and a progress bar that filled itself: it built,
 * its one test passed, and it scored 100. These are the checks that would have
 * caught it, cheapest first:
 *
 *  - every page and must-have listed in the brief turns up in the code;
 *  - there is enough of an app to be one (not a skeleton);
 *  - a reviewer (the model, with only the brief and the code in front of it)
 *    names anything asked for that is missing or faked.
 */
import fs from "fs";
import path from "path";

export interface Requirement {
  /** As the brief puts it: "Progression", "Save". */
  label: string;
  /** Word stems at least one of which must appear in the app's code. */
  stems: string[];
}

/** Brief sections that list what must be built, as the prompt builder writes them. */
const LIST_SECTIONS = /^(pages\s*\/\s*screens|pages|screens|it must have|must have|features)\s*:\s*$/i;
const STOP = new Set(["and", "the", "for", "are", "not", "but", "any", "all", "can", "its", "our", "out", "own", "between", "already", "available", "anything", "every", "only", "just", "like", "with", "that", "this", "from", "your", "their", "have", "will", "into", "each", "page", "screen", "able", "should", "must", "users", "user", "also", "when", "then", "than", "them", "they", "what", "which", "some", "more", "most", "very", "easy", "nice", "good"]);

/** A crude stem, enough to match "Progression" with `progress` and "Saving" with `save`. */
export const stem = (word: string): string => {
  let w = word.toLowerCase();
  for (const suffix of ["ations", "ation", "ions", "ion", "ings", "ing", "ments", "ment", "ers", "er", "es", "ed", "s", "e"]) {
    if (w.length - suffix.length >= 4 && w.endsWith(suffix)) {
      w = w.slice(0, -suffix.length);
      break;
    }
  }
  return w;
};

export const requirementsFromBrief = (brief: string): Requirement[] => {
  const out: Requirement[] = [];
  const seen = new Set<string>();
  let inList = false;
  for (const raw of brief.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (LIST_SECTIONS.test(line)) {
      inList = true;
      continue;
    }
    if (!line || /^[A-Z][^:]{2,40}:\s*$/.test(line)) {
      // A blank line or the next heading ends the list.
      if (line) inList = false;
      continue;
    }
    if (!inList || !/^[-*•]\s+/.test(line)) {
      if (inList && !/^[-*•]/.test(line)) inList = false;
      continue;
    }
    for (const item of line.replace(/^[-*•]\s+/, "").split(/[,;]| and (?=[A-Z])/)) {
      const label = item.trim().replace(/[.!]+$/, "");
      if (label.length < 3 || label.length > 80) continue;
      const stems = Array.from(new Set((label.match(/[A-Za-z]{3,}/g) ?? []).filter((word) => !STOP.has(word.toLowerCase())).map(stem)));
      if (stems.length === 0) continue;
      const key = stems.join(" ");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ label, stems });
    }
  }
  return out;
};

const SKIP = /(^|\/)(node_modules|dist|build|\.git)(\/|$)/;
const APP_FILE = /\.(t|j)sx?$/;
const TEST_FILE = /\.(test|spec)\.(t|j)sx?$/;
/** The starter's own plumbing, which says nothing about the app built on it. */
const PLUMBING = /^src\/(main\.tsx|lib\/testing\.tsx|vite-env\.d\.ts)$/;

/** The app's own source (no tests, no starter plumbing), path → content. */
export const appSource = (root: string): Record<string, string> => {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).replace(/\\/g, "/");
      if (SKIP.test(rel)) continue;
      if (entry.isDirectory()) walk(full);
      else if (APP_FILE.test(entry.name) && !TEST_FILE.test(entry.name) && !PLUMBING.test(rel) && !entry.name.endsWith(".d.ts")) {
        out[rel] = fs.readFileSync(full, "utf8");
      }
    }
  };
  walk(path.join(root, "src"));
  return out;
};

/** Lines that do something: not blank, not only a brace, not a comment or an import. */
export const substantialLines = (source: Record<string, string>): number =>
  Object.values(source)
    .flatMap((text) => text.split(/\r?\n/))
    .map((line) => line.trim())
    .filter((line) => line.length > 2 && !/^(\/\/|\/\*|\*|import\s|[)}\]>;,]+$)/.test(line)).length;

export interface CompletenessResult {
  missing: Requirement[];
  lines: number;
  minLines: number;
}

/** The brief's pages and must-haves that never appear in the app, and how much app there is. */
export const coverage = (brief: string, source: Record<string, string>, minLines?: number): CompletenessResult => {
  const text = Object.values(source).join("\n").toLowerCase();
  const requirements = requirementsFromBrief(brief);
  // One word must be there; for a longer item ("Pick a barber: Sipho"), two of its words.
  const missing = requirements.filter(
    (requirement) => requirement.stems.filter((s) => text.includes(s)).length < Math.min(2, requirement.stems.length)
  );
  // How much app a brief needs grows with what it lists: a tip calculator is
  // finished well before a game with six screens is.
  const needed = minLines ?? Math.min(150, Math.max(80, 60 + 15 * requirements.length));
  return { missing, lines: substantialLines(source), minLines: needed };
};

/** The prompt for the reviewer: the brief and the code, and a strict answer format. */
export const reviewPrompt = (brief: string, source: Record<string, string>, budget = 14_000): string => {
  let used = 0;
  const files = Object.entries(source)
    .sort(([a], [b]) => (a.endsWith("App.tsx") ? -1 : b.endsWith("App.tsx") ? 1 : a.localeCompare(b)))
    .map(([file, content]) => {
      if (used >= budget) return `FILE: ${file} (not shown)`;
      const body = content.slice(0, budget - used);
      used += body.length;
      return `FILE: ${file}\n\`\`\`\n${body}\n\`\`\``;
    })
    .join("\n\n");
  return `You are checking a finished app against what the customer asked for, before it is handed over.

What they asked for:
${brief.split(/\nWhat our research confirmed/i)[0].slice(0, 3500)}

The app's code:
${files}

List only the things the brief clearly asks for that this code does NOT really do. A stub, a hard-coded
value, a button that does nothing, or something that only looks like the feature counts as not done (for
example, a progress bar that fills on a timer is not a game). Do not list style preferences, nice-to-haves
or things the brief does not ask for.

Answer with JSON only, nothing else:
{"missing": ["short description of each missing thing"]}
If everything asked for is really there, answer {"missing": []}.`;
};

/** The reviewer's list, read leniently: JSON first, then bullet lines. Null when it said nothing usable. */
export const parseReview = (reply: string): string[] | null => {
  const json = /\{[\s\S]*\}/.exec(reply)?.[0];
  if (json) {
    try {
      const parsed = JSON.parse(json) as { missing?: unknown };
      if (Array.isArray(parsed.missing)) {
        return parsed.missing.map((item) => String(item).trim()).filter((item) => item.length > 3 && item.length < 240).slice(0, 6);
      }
    } catch {
      // fall through
    }
  }
  return null;
};
