/**
 * ErrorFingerprint — a check's output read as errors, and a name for "the
 * same errors again".
 *
 * A build stuck at 55 for eight passes was failing on the same two TypeScript
 * errors every time, but nothing could tell: the output changed (line numbers,
 * paths, the order) while the problem did not. Here each error is reduced to
 * what does not change between passes — its code and its message with the
 * specifics taken out — so "still the same problem" is a comparison, and a
 * fix learned on one project can be recognised on another.
 */
export interface ParsedError {
  file: string | null;
  line: number | null;
  /** "TS2339", "vite", "vitest", or "error" when it has no code. */
  code: string;
  message: string;
  /** The message with names of files, numbers and string literals generalised: what a fix is about. */
  pattern: string;
}

export interface ErrorGroup {
  key: string;
  code: string;
  pattern: string;
  /** One real message, for prompts and searches. */
  example: string;
  files: string[];
  count: number;
}

const TS_LINE = /^(.+?)\((\d+),\d+\):\s+error\s+(TS\d+):\s+(.+)$/;
const TS_LINE_COLON = /^(.+?):(\d+):\d+\s+-\s+error\s+(TS\d+):\s+(.+)$/;
const GENERIC = /^\s*(?:error|Error|ERROR)[:\s]+(.{8,})$/;
const VITE = /^\s*(?:\[vite\]|vite\b).*?(error|failed).*$/i;
const FAIL_TEST = /^\s*(?:FAIL|×|✗)\s+(.+)$/;

/** What a message says once its particulars are out: quoted names stay (they are the point), numbers and paths go. */
export const generalise = (message: string): string =>
  message
    .replace(/\r/g, "")
    .replace(/(["'`])([^"'`]{1,80})\1/g, (_m, q, inner: string) => (/[\\/]|\.(t|j)sx?$/.test(inner) ? `${q}<path>${q}` : `${q}${inner.replace(/\d+/g, "#")}${q}`))
    .replace(/\b\d+\b/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);

export const parseErrors = (output: string): ParsedError[] => {
  const errors: ParsedError[] = [];
  const lines = output.replace(/\r/g, "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ts = TS_LINE.exec(line) ?? TS_LINE_COLON.exec(line);
    if (ts) {
      // A TypeScript message continues on indented lines ("Types of property … are incompatible").
      let message = ts[4].trim();
      while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]) && !TS_LINE.test(lines[i + 1])) {
        message += ` ${lines[++i].trim()}`;
      }
      errors.push({ file: ts[1].trim().replace(/\\/g, "/"), line: Number(ts[2]), code: ts[3], message, pattern: generalise(message) });
      continue;
    }
    const test = FAIL_TEST.exec(line);
    if (test) {
      errors.push({ file: null, line: null, code: "test", message: test[1].trim(), pattern: generalise(test[1]) });
      continue;
    }
    if (VITE.test(line)) {
      errors.push({ file: null, line: null, code: "vite", message: line.trim(), pattern: generalise(line) });
      continue;
    }
    const generic = GENERIC.exec(line);
    if (generic && !/^\s*(?:npm|at)\b/.test(line)) {
      errors.push({ file: null, line: null, code: "error", message: generic[1].trim(), pattern: generalise(generic[1]) });
    }
  }
  return errors;
};

/** The same problem in several places is one group: one fix, one search. */
export const groupErrors = (errors: ParsedError[]): ErrorGroup[] => {
  const groups = new Map<string, ErrorGroup>();
  for (const error of errors) {
    const key = `${error.code}: ${error.pattern}`;
    const group = groups.get(key);
    if (group) {
      group.count += 1;
      if (error.file && !group.files.includes(error.file)) group.files.push(error.file);
    } else {
      groups.set(key, { key, code: error.code, pattern: error.pattern, example: error.message, files: error.file ? [error.file] : [], count: 1 });
    }
  }
  return Array.from(groups.values()).sort((a, b) => b.count - a.count);
};

/** One name for a whole set of errors, order and count aside: equal fingerprints are "the same problem again". */
export const fingerprint = (output: string): string => {
  const keys = Array.from(new Set(parseErrors(output).map((error) => `${error.code}: ${error.pattern}`))).sort();
  return keys.length ? keys.join("\n") : generalise(output.slice(-600));
};

export const errorCount = (output: string): number => parseErrors(output).length;
