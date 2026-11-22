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

export const SourceDoctor = {
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
