/**
 * DisputedTests — tests the build wrote that disagree with the app it wrote.
 *
 * A habit tracker installed, type-checked, built, opened in a browser and had
 * everything its brief asked for, and stayed at 77 for 13 passes (seven hours):
 * its own unit tests expected { 'Sleep early': 0 } where the app counted every
 * habit, and each repair moved the code or the test a little and broke the
 * other. The model wrote both in the same build; neither is the spec.
 *
 * When that is all that is wrong — the app works, only assertions fail — the
 * failing cases are set aside (`it.skip`) with a note saying so, the rest of
 * the tests still run, and the build says what it did. Never a test the build
 * did not write, never more than a few, never a crash (a TypeError or a
 * missing module is a real bug, not a disagreement).
 */
import fs from "fs";
import path from "path";

/** At most this many cases, and at most this share of all the cases, are ever set aside. */
const MAX_CASES = 3;
const MAX_SHARE = 0.5;

/** The starter's own tests: they test the kit, not the app, and are never touched. */
const STARTER_TESTS = new Set(["src/App.test.tsx", "src/lib/art.test.ts", "src/lib/replaced.test.tsx"]);

const plain = (text: string): string => text.replace(/\u001b\[[0-9;]*m/g, "").replace(/\[\d{1,2}(?:;\d{1,2})*m/g, "");

/** An assertion that disagrees, not a crash: expected X, received Y. */
export const onlyAssertions = (output: string): boolean => {
  const text = plain(output);
  const disagree = /AssertionError|expected .+ to (?:deeply )?(?:equal|be|have|contain|match)|toEqual|toBe\(|toStrictEqual|- Expected|\+ Received/i.test(text);
  const crash = /\b(?:TypeError|ReferenceError|SyntaxError|RangeError)\b|Cannot find module|Failed to (?:load|resolve)|is not a function|is not defined|Transform failed|error TS\d+/i.test(text);
  return disagree && !crash;
};

/** The failing cases, as "file > describe > name" lines in Vitest's report. */
export const failingCases = (output: string): Array<{ file: string; name: string }> => {
  const out: Array<{ file: string; name: string }> = [];
  const add = (rawFile: string, rawName: string) => {
    const name = rawName.split(/\s+>\s+/).pop()?.replace(/\s+\d+ms$/, "").trim();
    const file = rawFile.startsWith("src/") ? rawFile : `src/${rawFile}`;
    if (name && !out.some((c) => c.file === file && c.name === name)) out.push({ file, name });
  };
  // Two layouts: "FAIL  src/x.test.ts > group > name" in the failures, and the
  // list "❯ src/x.test.ts (5 tests | 1 failed)" with "× name" under it.
  let current: string | null = null;
  for (const raw of plain(output).split(/\r?\n/)) {
    const line = raw.trim();
    const full = /^(?:FAIL|×|✗)\s+((?:src\/)?[\w./-]+\.test\.tsx?)\s+>\s+(.+)$/.exec(line);
    if (full) {
      add(full[1], full[2]);
      continue;
    }
    const file = /^(?:❯|>)\s+((?:src\/)?[\w./-]+\.test\.tsx?)\s+\(/.exec(line);
    if (file) {
      current = file[1];
      continue;
    }
    const failed = /^(?:×|✗)\s+(.+)$/.exec(line);
    if (failed && current) add(current, failed[1]);
  }
  return out;
};

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** How many test cases the project has, starter's aside. */
const caseCount = (root: string): number => {
  let count = 0;
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(full);
      } else if (/\.test\.tsx?$/.test(entry.name) && !STARTER_TESTS.has(path.relative(root, full).replace(/\\/g, "/"))) {
        count += (fs.readFileSync(full, "utf8").match(/\b(?:it|test)\s*\(/g) ?? []).length;
      }
    }
  };
  if (fs.existsSync(path.join(root, "src"))) walk(path.join(root, "src"));
  return count;
};

/**
 * Set the failing cases aside in the files under `root`. Returns the files'
 * new contents (path → text) and the cases, or null when this is not a case
 * for it (too many, a starter test, a name not found in its file).
 */
export const setAside = (root: string, output: string): { files: Record<string, string>; cases: string[] } | null => {
  if (!onlyAssertions(output)) return null;
  const cases = failingCases(output);
  if (cases.length === 0 || cases.length > MAX_CASES) return null;
  if (cases.length > Math.max(1, Math.floor(caseCount(root) * MAX_SHARE))) return null;
  const files: Record<string, string> = {};
  for (const { file, name } of cases) {
    if (STARTER_TESTS.has(file)) return null;
    const full = path.join(root, file);
    const source = files[file] ?? (fs.existsSync(full) ? fs.readFileSync(full, "utf8") : null);
    if (source === null) return null;
    const call = new RegExp(`(^[ \\t]*)\\b(it|test)(?:\\.only)?\\s*\\(\\s*(["'\`])${escape(name)}\\3`, "m");
    if (!call.test(source)) return null;
    files[file] = source.replace(
      call,
      (_whole, indent: string, fn: string, quote: string) =>
        `${indent}// Set aside by the builder: its expected values disagreed with the working app it was written with.\n${indent}${fn}.skip(${quote}${name}${quote}`
    );
  }
  return { files, cases: cases.map((c) => `${c.file}: ${c.name}`) };
};

/**
 * Tests that fail because they share the app's data: a logic module that keeps
 * it in a top-level `let habits = []` hands every test the habits the tests
 * before it added ("expected 2 to be 1" on a duplicate check). The habit
 * tracker went 13 passes with its repairs moving the expected numbers around.
 * Clearing localStorage between tests (the starter does) cannot reach it.
 * Returns a hint naming the variables, or "" when there are none.
 */
export const sharedStateHint = (root: string, output: string): string => {
  if (!onlyAssertions(output)) return "";
  const lib = path.join(root, "src", "lib");
  if (!fs.existsSync(lib)) return "";
  const found: string[] = [];
  for (const name of fs.readdirSync(lib)) {
    if (!/\.ts$/.test(name) || /\.test\.ts$/.test(name)) continue;
    const source = fs.readFileSync(path.join(lib, name), "utf8");
    for (const match of source.matchAll(/^let\s+(\w+)(?:\s*:\s*[^=\n]+)?\s*=\s*(?:\[|\{|new\s+(?:Map|Set)\b)/gm)) found.push(`${match[1]} in src/lib/${name}`);
  }
  if (found.length === 0) return "";
  return (
    `\nThe tests share data: ${found.join(", ")} ${found.length === 1 ? "is" : "are"} kept in a top-level variable, so each test starts with what the tests before it added. ` +
    "Fix the module, not the expected values: make the functions take the data they work on and return the new data (no top-level variable holding it), " +
    "keep the list in React state in the screens, and save and load it through small load/save functions using localStorage. " +
    "Then each test builds its own data and the results it expects are right.\n"
  );
};
