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

/**
 * The brief without research findings that have nothing to do with it. The
 * prompt page remembers the last research topic picked, so a phone game's
 * brief arrived with eight findings about LLM decoding and quantum annealing —
 * read by a small model on every pass. A finding stays when it shares two
 * words with the brief itself; a section left empty goes.
 */
/** Words too general to show two texts are about the same thing ("system" joined a game's progression system to the limbic system). */
const GENERAL = new Set(["system", "use", "using", "used", "data", "based", "new", "way", "time", "make", "work", "help", "need", "one", "two", "more", "less", "high", "low", "well", "real"]);

const topicWords = (text: string): Set<string> =>
  new Set(
    (text.replace(/\(https?:[^)]*\)|https?:\/\/\S+/g, " ").match(/[A-Za-z]{3,}/g) ?? [])
      .map((word) => word.toLowerCase())
      .filter((word) => !STOP.has(word) && !GENERAL.has(word))
      .map(stem)
      .filter((word) => !GENERAL.has(word))
  );

/** Whether a research finding is about the same thing as the brief: two specific words in common. */
export const relatedTo = (brief: string, claim: string): boolean => {
  const own = topicWords(brief);
  return Array.from(topicWords(claim)).filter((word) => own.has(word)).length >= 2;
};

export const dropUnrelatedResearch = (brief: string): string => {
  const match = /\n(What our research confirmed[^\n]*\n)((?:[ \t]*[-*•][^\n]*(?:\n|$))+)/i.exec(brief);
  if (!match) return brief;
  const own = brief.slice(0, match.index) + brief.slice(match.index + match[0].length);
  const kept = match[2].split("\n").filter((line) => line.trim() && relatedTo(own, line));
  const section = kept.length > 0 ? `\n${match[1]}${kept.join("\n")}\n` : "\n";
  return brief.slice(0, match.index) + section + brief.slice(match.index + match[0].length);
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

/**
 * How to make a dead button on a screen real, when the app switches screens
 * with state: the live Pgame build's Home had `<button onClick={() => {}}>Play
 * Game</button>` while App held `const [screen, setScreen] = useState<"home" |
 * "menu" | "game" | …>` and rendered `<Home />` with nothing to call. "A
 * button that does nothing" did not get it fixed; the exact wiring does.
 */
const wiring = (source: Record<string, string>, file: string, text: string): string => {
  const component = path.basename(file).replace(/\.(t|j)sx?$/, "");
  const label = /<button[^>]*on[A-Z]\w*=\{\s*\(\s*\)\s*=>\s*\{\s*\}\s*\}[^>]*>\s*([^<{]+?)\s*</.exec(text)?.[1]?.trim();
  for (const [owner, ownerText] of Object.entries(source)) {
    if (owner === file || !new RegExp(`<${component}\\b`).test(ownerText)) continue;
    const screens = /const\s*\[\s*(\w+)\s*,\s*(set\w+)\s*\]\s*=\s*useState<([^>]+)>/.exec(ownerText);
    if (!screens) continue;
    const values = Array.from(screens[3].matchAll(/["']([^"']+)["']/g)).map((m) => m[1]);
    if (values.length < 2) continue;
    const words = (label ?? "").toLowerCase();
    const target =
      values.find((value) => value !== component.toLowerCase() && words.includes(value.toLowerCase())) ??
      (/play|start|begin|new game/.test(words) ? values.find((value) => /game|play/.test(value)) : undefined) ??
      values.find((value) => value !== component.toLowerCase() && value !== values[0]) ??
      values[1];
    const prop = `on${target.charAt(0).toUpperCase()}${target.slice(1).replace(/[^\w]/g, "")}`;
    return `. ${owner} switches screens with ${screens[2]}, but renders <${component} /> with nothing to call: give ${component} a prop ${prop}: () => void, call it from the ${label ? `"${label}" ` : ""}button (onClick={${prop}}), and in ${owner} render <${component} ${prop}={() => ${screens[2]}("${target}")} />`;
  }
  return "";
};

/**
 * Code that only looks finished, found without asking a model — the local
 * reviewer signed off on all of these in one real build:
 *  - a placeholder comment ("// Render game logic here", "// TODO", "// implement …");
 *  - a function that only hands back its input (`getProgression = (s) => s`);
 *  - a click handler that does nothing (`onClick={() => {}}`).
 * Each is named with its file, so the fix can go straight at it.
 */
export const stubs = (source: Record<string, string>): string[] => {
  const found: string[] = [];
  for (const [file, text] of Object.entries(source)) {
    for (const match of text.matchAll(/\/\/[ \t]*([^\n]*)/g)) {
      const comment = match[1].trim();
      if (/\b(todo|fixme|implement(ation)?\b(?! detail)|placeholder|stub)\b|\b(goes|go|logic|code|content|stuff|something)\s+here\b/i.test(comment) && comment.length < 120) {
        found.push(`${file} has a placeholder comment "// ${comment}" where code should be`);
        break;
      }
    }
    for (const match of text.matchAll(/(?:const|let)\s+(\w+)\s*=\s*\(\s*(\w+)\s*(?::[^)]*)?\)\s*(?::[^=]+)?=>\s*(?:\{\s*return\s+\2\s*;?\s*\}|\2\s*[;\n])/g)) {
      found.push(`${file}: ${match[1]}() only returns what it is given`);
    }
    for (const match of text.matchAll(/function\s+(\w+)\s*\(\s*(\w+)[^)]*\)\s*(?::[^{]+)?\{\s*return\s+\2\s*;?\s*\}/g)) {
      found.push(`${file}: ${match[1]}() only returns what it is given`);
    }
    if (/on[A-Z]\w*=\{\s*\(\s*\)\s*=>\s*\{\s*\}\s*\}/.test(text)) found.push(`${file} has a button or handler that does nothing ({() => {}})${wiring(source, file, text)}`);
  }
  // A screen that "navigates" by changing the address (`window.location.hash = '/game'`)
  // in an app that switches screens with state: nothing reads the address, so the
  // Start button leads nowhere. It type-checks, renders and passes its tests.
  const all = Object.values(source).join("\n");
  const listens = /addEventListener\(\s*["'](hashchange|popstate)|on(hashchange|popstate)\b|useLocation|useNavigate|react-router|wouter|location\.(hash|pathname)(?!\s*=[^=])/.test(all);
  if (!listens) {
    for (const [file, text] of Object.entries(source)) {
      const move = /location\.(hash|href)\s*=\s*["'`][#/]|history\.pushState\(/.exec(text);
      if (move) {
        found.push(`${file} moves to another screen by changing the page address (${move[0].replace(/\s*=\s*["'`][#/]$/, " = …")}), but nothing in the app reads the address, so it leads nowhere: give the component a prop such as onStart: () => void and have App switch screens with state`);
      }
    }
  }
  return found.slice(0, 6);
};

/**
 * Whether the app uses the engine it started from: the share of the engine's
 * exported functions the rest of the app calls. An engine imported for a type
 * and never driven (no step(), no launch()) is a game that does not play.
 */
export const engineUse = (source: Record<string, string>, engineFiles: string[]): { file: string; used: string[]; unused: string[] }[] =>
  engineFiles
    .filter((file) => file in source)
    .map((file) => {
      const functions = Array.from(
        source[file].matchAll(/export\s+(?:async\s+)?(?:function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*(?::[^=]+)?=>)/g)
      ).map((m) => m[1] ?? m[2]);
      const others = Object.entries(source)
        .filter(([name]) => name !== file)
        .map(([, text]) => text)
        .join("\n");
      const used = functions.filter((name) => new RegExp(`\\b${name}\\s*\\(`).test(others));
      return { file, used, unused: functions.filter((name) => !used.includes(name)) };
    });

/**
 * Components the build started with (GameBoard: the canvas, loop and
 * controls) that no screen of the app renders. The engine calls itself from
 * inside them, so "the engine is used" holds even when the app shows four
 * buttons instead of the game; this is the check that does not.
 */
export const unshownComponents = (source: Record<string, string>, engineFiles: string[]): { file: string; components: string[] }[] => {
  const app = Object.entries(source)
    .filter(([file]) => !engineFiles.includes(file))
    .map(([, text]) => text)
    .join("\n");
  return engineFiles
    .filter((file) => file.endsWith(".tsx") && file in source)
    .map((file) => ({
      file,
      components: Array.from(source[file].matchAll(/export\s+(?:default\s+)?(?:function\s+([A-Z]\w*)|const\s+([A-Z]\w*)\s*=)/g))
        .map((match) => match[1] ?? match[2])
        .filter((name) => !new RegExp(`<${name}\\b`).test(app))
    }))
    .filter((entry) => entry.components.length > 0);
};

/** The brief's pages and must-haves that never appear in the app, and how much app there is. */
export const coverage = (brief: string, source: Record<string, string>, minLines?: number, engineFiles: string[] = []): CompletenessResult => {
  const text = Object.values(source).join("\n").toLowerCase();
  // An engine the build started from is ours, not the app: the app around it must stand on its own.
  const own = Object.fromEntries(Object.entries(source).filter(([file]) => !engineFiles.includes(file)));
  const requirements = requirementsFromBrief(brief);
  // One word must be there; for a longer item ("Pick a barber: Sipho"), two of its words.
  const missing = requirements.filter(
    (requirement) => requirement.stems.filter((s) => text.includes(s)).length < Math.min(2, requirement.stems.length)
  );
  // How much app a brief needs grows with what it lists: a tip calculator is
  // finished well before a game with six screens is.
  const needed = minLines ?? Math.min(150, Math.max(80, 60 + 15 * requirements.length));
  return { missing, lines: substantialLines(own), minLines: needed };
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
value, a button that does nothing, or something that only looks like the feature counts as not done. Check
each of these, and list every one you find:
- a game whose loop or canvas never moves or draws anything (a progress bar on a timer is not a game either);
- a screen that is only a heading and a Back button (a "Save" or "Load" screen that saves or loads nothing);
- a function that just returns its input, or a feature shown as a number nobody can change;
- data that is never saved where the brief says, or never read back.
Do not list style preferences, nice-to-haves or things the brief does not ask for.

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
