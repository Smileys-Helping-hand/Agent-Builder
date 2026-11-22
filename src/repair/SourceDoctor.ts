/**
 * SourceDoctor — fixes, without a model, the source mistakes models keep making
 * and then cannot see past.
 *
 * JSX in a .ts file: TypeScript reads `<div>` in a .ts file as a broken
 * comparison or regular expression ("')' expected", "Unterminated regular
 * expression literal"), so the errors never mention JSX and the model rewrites
 * the code without renaming the file. NexusOS's typecheck failed this way for
 * days (src/app/ai-assistant/page.ts, beside a page.tsx of the same page).
 *   - a .tsx of the same name exists: the .ts is a stray duplicate and is removed;
 *   - otherwise it is renamed to .tsx.
 * Only files the typecheck names, only when they really contain JSX, and only
 * in a working copy under git, so every change can be seen and undone.
 */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

export interface SourceFix {
  changed: boolean;
  actions: string[];
  summary: string;
}

/** Syntax errors TypeScript gives for JSX in a .ts file. */
const JSX_SYMPTOMS = /TS(1005|1109|1128|1161|1003|1434|1136|17008|2304)\b/;

/** Whether source text contains JSX (an element returned or assigned), not just a generic or a comparison. */
export const looksLikeJsx = (text: string): boolean =>
  /(return|=>|=)\s*\(?\s*<([A-Z][\w.]*|[a-z][\w-]*)(\s[^<>]*)?\/?>/m.test(text) && /<\/([A-Za-z][\w.-]*)>|\/>/.test(text);

/** The .ts files a typecheck output blames for JSX-like syntax errors (exported for tests). */
export const tsFilesWithJsxErrors = (output: string): string[] => {
  const files = new Set<string>();
  for (const line of output.replace(/\r/g, "").split("\n")) {
    const match = /^([^\s(][^(]*?\.ts)\(\d+,\d+\): error (TS\d+)/.exec(line.trim());
    if (match && JSX_SYMPTOMS.test(match[2]) && !match[1].endsWith(".d.ts")) files.add(match[1].replace(/\\/g, "/"));
  }
  return [...files];
};

/** Members reported missing, by the symbol they are missing from: "Property 'warn' does not exist on type 'typeof Logger'". */
export const missingMembers = (output: string): Map<string, Set<string>> => {
  const found = new Map<string, Set<string>>();
  // A class or constant ("typeof Logger") or an interface or type ("EcosystemProject") that lost its members.
  for (const m of output.matchAll(/error TS2339: Property '([^']+)' does not exist on type '(?:typeof )?(\w+)'/g)) {
    const set = found.get(m[2]) ?? new Set<string>();
    set.add(m[1]);
    found.set(m[2], set);
  }
  return found;
};

/** How many errors name each symbol (kept for callers that only need counts). */
export const missingMembersBySymbol = (output: string): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const m of output.matchAll(/error TS2339: Property '[^']+' does not exist on type '(?:typeof )?(\w+)'/g)) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  return counts;
};

/** A file declares the symbol itself (not `import { type X }`, which once restored the wrong file). */
export const declares = (text: string, symbol: string): boolean =>
  new RegExp(`^\\s*(export\\s+)?(default\\s+)?(declare\\s+)?(abstract\\s+)?(class|const|let|function|interface|type|enum)\\s+${symbol}\\b`, "m").test(text);

/** Which of `members` a source text mentions as identifiers. */
const mentions = (text: string, members: Set<string>) => [...members].filter((member) => new RegExp(`\\b${member.replace(/[^\w$]/g, "")}\\b`).test(text)).length;

const git = (dir: string, args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });

export const SourceDoctor = {
  /**
   * TS5090 "Non-relative paths are not allowed when 'baseUrl' is not set": a tsconfig `paths` entry without a
   * baseUrl stops the whole typecheck (NexusOS, 22 November: one error, every step "changed nothing" because the
   * model rewrote code, not the config). Adds `"baseUrl": "."` to compilerOptions.
   */
  fixTsconfigBaseUrl(dir: string, output: string, options: { dryRun?: boolean } = {}): SourceFix {
    const none = (summary: string): SourceFix => ({ changed: false, actions: [], summary });
    const hit = /([\w./-]*tsconfig[\w.-]*\.json)\(\d+,\d+\): error TS5090/.exec(output);
    if (!hit) return none("No TS5090 error.");
    const file = path.resolve(dir, hit[1]);
    if (!file.startsWith(path.resolve(dir)) || !fs.existsSync(file)) return none("The tsconfig named is not in the project.");
    const text = fs.readFileSync(file, "utf8");
    if (/"baseUrl"\s*:/.test(text)) return none("baseUrl is already set.");
    const fixed = text.replace(/("compilerOptions"\s*:\s*\{)/, '$1\n    "baseUrl": ".",');
    if (fixed === text) return none("No compilerOptions block to add baseUrl to.");
    if (!options.dryRun) fs.writeFileSync(file, fixed);
    return { changed: true, actions: [`added "baseUrl": "." to ${hit[1]}`], summary: `${hit[1]} had "paths" without a "baseUrl" (TS5090), which stops the whole typecheck: added "baseUrl": ".".` };
  },

  /**
   * A core module rewritten: many errors say members are missing from the same symbol (60 times "Property 'warn'
   * does not exist on type 'typeof Logger'" in the self-improvement copy, whose Logger a step had replaced with a
   * generic class). The file that declares the symbol is put back as it was at `ref`, but only on evidence:
   *  - `ref` is the last commit whose checks passed when there is one, else the session's starting point;
   *  - the file declares the symbol now and did at `ref` (a real declaration, not an import);
   *  - the version at `ref` mentions most of the members the errors say are missing, and the current one does not.
   * Without that evidence it does nothing: on 22 November a looser version reverted a game's engine and rules to the
   * empty template (the starting point of a game is a template, not a good version). The caller rechecks and undoes it if worse.
   */
  restoreRewrittenModules(dir: string, output: string, ref: string | null, options: { minErrors?: number; dryRun?: boolean; refLabel?: string } = {}): SourceFix {
    const actions: string[] = [];
    if (!ref) return { changed: false, actions, summary: "No good version to compare with." };
    const label = options.refLabel ?? "the starting point";
    let changedSince: string[] = [];
    try {
      changedSince = git(dir, ["diff", "--name-only", ref, "HEAD", "--", "src"]).split("\n").filter(Boolean);
    } catch {
      return { changed: false, actions, summary: `Could not compare with ${label}.` };
    }
    for (const [symbol, members] of missingMembers(output)) {
      const count = [...output.matchAll(new RegExp(`does not exist on type '(?:typeof )?${symbol}'`, "g"))].length;
      if (count < (options.minErrors ?? 8)) continue;
      let definer: string | null = null;
      let original = "";
      for (const file of changedSince.filter((f) => /\.(ts|tsx|js)$/.test(f))) {
        const now = path.join(dir, file);
        if (!fs.existsSync(now)) continue;
        const current = fs.readFileSync(now, "utf8");
        if (!declares(current, symbol)) continue;
        let before = "";
        try {
          before = git(dir, ["show", `${ref}:${file}`]);
        } catch {
          continue; // new since then: not the module the code was written against
        }
        // Evidence: the old version has the members the code expects, and the current one has lost them.
        if (!declares(before, symbol) || mentions(before, members) < members.size * 0.8 || mentions(current, members) >= members.size * 0.5) continue;
        definer = file;
        original = before;
        break;
      }
      if (!definer) continue;
      const already = actions.findIndex((a) => a.startsWith(`restored ${definer} `));
      if (already >= 0) {
        actions[already] = actions[already].replace(/ were missing: it had been rewritten\)$/, `, and ${count} for ${symbol}, were missing: it had been rewritten)`);
        continue;
      }
      if (!options.dryRun) fs.writeFileSync(path.join(dir, definer), original);
      actions.push(`restored ${definer} from ${label} (${count} errors said members of ${symbol} were missing: it had been rewritten)`);
    }
    return { changed: actions.length > 0, actions, summary: actions.length ? `A core module had been rewritten: ${actions.join("; ")}.` : "No rewritten module found." };
  },

  /** Fix JSX-in-.ts files named by a failing typecheck's output, inside `dir`. */
  fixJsxInTs(dir: string, output: string, options: { dryRun?: boolean } = {}): SourceFix {
    const actions: string[] = [];
    const root = path.resolve(dir);
    for (const rel of tsFilesWithJsxErrors(output)) {
      const file = path.resolve(root, rel);
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) continue;
      const text = fs.readFileSync(file, "utf8");
      if (!looksLikeJsx(text)) continue;
      const tsx = file.replace(/\.ts$/, ".tsx");
      if (fs.existsSync(tsx)) {
        if (!options.dryRun) fs.rmSync(file);
        actions.push(`removed ${rel} (JSX in a .ts file, beside ${path.basename(tsx)} of the same name)`);
      } else {
        if (!options.dryRun) fs.renameSync(file, tsx);
        actions.push(`renamed ${rel} to ${path.basename(tsx)} (it contains JSX)`);
      }
    }
    return { changed: actions.length > 0, actions, summary: actions.length ? `JSX in .ts files, which TypeScript reads as broken syntax: ${actions.join("; ")}.` : "No .ts file with JSX among the errors." };
  }
};
