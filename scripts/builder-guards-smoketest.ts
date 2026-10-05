/**
 * Smoke test for the build guards: CodeGuard (model answers must be code and
 * must not break working files) and AutoFix (Jest in Vitest, missing packages).
 *
 *   npm run test:builder-guards
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

import { CodeGuard } from "../src/orchestrator/CodeGuard.js";
import { AutonomousOrchestrator } from "../src/orchestrator/AutonomousOrchestrator.js";
import { AutoFix } from "../src/orchestrator/AutoFix.js";
import { TypeFixer } from "../src/orchestrator/TypeFixer.js";
import { Verifier } from "../src/orchestrator/Verifier.js";
import { applyFacts, readFacts, sampleFactsLeft } from "../src/orchestrator/Tailoring.js";
import { coverage, engineUse, parseReview, requirementsFromBrief, stubs } from "../src/orchestrator/Completeness.js";
import { candidates, projectKey } from "../src/orchestrator/SelfHeal.js";
import type { BuildView } from "../src/orchestrator/BuildService.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ab-guards-"));
fs.mkdirSync(path.join(root, "src"), { recursive: true });

const working = `import React, { useState } from "react";\n\nexport const Reservation = () => {\n  const [date, setDate] = useState("");\n  return <input value={date} onChange={(e) => setDate(e.target.value)} />;\n};\n`;
fs.writeFileSync(path.join(root, "src/Reservation.tsx"), working);

// The real failure: prose, a numbered list, then the code in a fence.
const proseAnswer = `The provided code is relatively simple and straightforward, which means the potential for performance optimization is limited.\n\n1. **Avoid Redundant Date Parsing**: store it.\n\nHere's the optimized code:\n\n\`\`\`tsx\n${working}\`\`\`\n\nThis keeps behaviour the same.`;
assert.equal(CodeGuard.clean("src/Reservation.tsx", proseAnswer).trim(), working.trim(), "code is taken out of the prose");

// A whole file wrapped in one fence.
assert.equal(CodeGuard.clean("src/a.ts", "```ts\nexport const a = 1;\n```").trim(), "export const a = 1;");

// Plain code is left exactly alone.
assert.equal(CodeGuard.clean("src/Reservation.tsx", working), working);

// A README keeps its prose.
const readme = "This project does X.\n\n```bash\nnpm i\n```\n";
assert.equal(CodeGuard.clean("README.md", readme), readme);

// An answer that is only prose would break a working file: refused, old content kept.
const guarded = CodeGuard.guard({ "src/Reservation.tsx": "The provided code is relatively simple and I would keep it as it is." }, root);
assert.equal(guarded.refused.length, 1, "breaking a working file is refused");
assert.equal(guarded.files["src/Reservation.tsx"], working, "the working version stays");

// The prose-wrapped answer is cleaned and accepted.
const accepted = CodeGuard.guard({ "src/Reservation.tsx": proseAnswer }, root);
assert.equal(accepted.refused.length, 0);
assert.deepEqual(accepted.cleaned, ["src/Reservation.tsx"]);

// A brand-new file that does not parse is still written (the checks will report it).
const fresh = CodeGuard.guard({ "src/New.tsx": "const = ;" }, root);
assert.ok(fresh.files["src/New.tsx"], "new broken files still go through to the checks");

// Broken JSON over working JSON is refused.
fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "app", devDependencies: { vitest: "^2.1.8" }, dependencies: { react: "^18.3.1" } }, null, 2));
assert.equal(CodeGuard.guard({ "package.json": "{ name: broken" }, root).refused.length, 1, "broken JSON refused");

// AutoFix: Jest calls in a Vitest project, missing imports, missing packages.
fs.writeFileSync(
  path.join(root, "src/App.test.tsx"),
  `import { render } from "@testing-library/react";\nimport { BrowserRouter } from "react-router-dom";\ndescribe("app", () => {\n  it("works", () => {\n    const fn = jest.fn();\n    expect(fn).not.toHaveBeenCalled();\n  });\n});\n`
);
fs.writeFileSync(path.join(root, "src/Page.tsx"), `import { Link } from "react-router-dom";\nimport fs from "node:fs";\nimport { x } from "./local";\nexport const Page = () => <Link to="/">home</Link>;\n`);
const notes = await AutoFix.run(root);
const test = fs.readFileSync(path.join(root, "src/App.test.tsx"), "utf8");
assert.match(test, /vi\.fn\(\)/, "jest.fn became vi.fn");
assert.match(test, /^import \{ describe, it, expect, vi \} from "vitest";/, "vitest imports added");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
assert.equal(pkg.dependencies["react-router-dom"], "latest", "missing runtime package added");
assert.equal(pkg.devDependencies["@testing-library/react"], "latest", "test-only package added as dev");
assert.equal(pkg.dependencies["node:fs"], undefined, "node builtins left alone");
assert.equal(pkg.dependencies["./local"], undefined, "relative imports left alone");
assert.ok(notes.length >= 2, "it says what it fixed");

// Template content keeps its shape: values may change, exports and keys may not.
const content = `import type { Business } from "./lib/site";\nexport const site = {\n  // the sample business\n  demo: true,\n  business: { name: "Salt & Ember", phone: "021" } satisfies Business,\n  menu: [{ title: "Start", dishes: [] }],\n  "quoted-key": 1,\n  hours: "x, y"\n};\nexport type Site = typeof site;\n`;
assert.equal(CodeGuard.templateShapeProblem(content, content.replace("Salt & Ember", "Green Fork").replace("demo: true", "demo: false")), null, "changing values is fine");
assert.equal(CodeGuard.templateShapeProblem(content, content.replace('menu: [{ title: "Start", dishes: [] }],', 'menu: [{ title: "Start", dishes: [] }, { title: "Mains", dishes: [] }],')), null, "adding list items is fine");
assert.match(CodeGuard.templateShapeProblem(content, `export const business = { name: "x" };\nexport const menu = [];\n`) ?? "", /no longer exports site/, "a rewritten shape is caught");
assert.match(CodeGuard.templateShapeProblem(content, content.replace('  menu: [{ title: "Start", dishes: [] }],\n', "")) ?? "", /site lost menu/, "a dropped key is caught");

// A browser app never gets a server-only package: `canvas` broke npm install for a whole game.
const browserApp = fs.mkdtempSync(path.join(os.tmpdir(), "ab-browser-"));
fs.mkdirSync(path.join(browserApp, "src"));
fs.writeFileSync(path.join(browserApp, "package.json"), JSON.stringify({ name: "g", dependencies: { react: "^18", express: "latest" }, devDependencies: { vite: "^5" } }));
fs.writeFileSync(path.join(browserApp, "src/Game.tsx"), "import { createCanvas } from 'canvas';\nimport confetti from 'canvas-confetti';\nexport default () => null;\n");
const browserNotes = await AutoFix.run(browserApp);
const browserPkg = JSON.parse(fs.readFileSync(path.join(browserApp, "package.json"), "utf8"));
assert.equal(browserPkg.dependencies.canvas, undefined, "canvas is not added");
assert.equal(browserPkg.dependencies.express, undefined, "a server package the model added is taken out");
assert.equal(browserPkg.dependencies["canvas-confetti"], "latest", "a browser package still is");
assert.ok(browserNotes.some((note) => /removed express/.test(note)));
assert.match(await AutoFix.missingModules(browserApp, "src/Game.tsx(1,30): error TS2307: Cannot find module 'canvas' or its corresponding type declarations."), /canvas: the browser's own <canvas> element/);

// Running it again changes nothing.
assert.deepEqual(await AutoFix.run(root), [], "fixes are idempotent");

// Missing modules: the repair is told exactly which file to write and what it must export.
const game = fs.mkdtempSync(path.join(os.tmpdir(), "ab-imports-"));
fs.mkdirSync(path.join(game, "src/components"), { recursive: true });
fs.writeFileSync(path.join(game, "package.json"), JSON.stringify({ name: "g", devDependencies: { vitest: "^2" } }));
fs.writeFileSync(path.join(game, "src/App.tsx"), `import { loadGame, saveGame } from "../lib/gameLogic";\nimport Menu from "./components/Menu";\nexport default () => null;\n`);
fs.writeFileSync(path.join(game, "src/components/SaveLoad.tsx"), `import { saveGame, type Save } from "../lib/gameLogic";\nexport const SaveLoad = () => null;\n`);
const typecheck = [
  "src/App.tsx(1,36): error TS2307: Cannot find module '../lib/gameLogic' or its corresponding type declarations.",
  "src/App.tsx(2,18): error TS2307: Cannot find module './components/Menu' or its corresponding type declarations.",
  "src/components/SaveLoad.tsx(1,40): error TS2307: Cannot find module '../lib/gameLogic' or its corresponding type declarations."
].join("\n");
const hint = await AutoFix.missingModules(game, typecheck);
assert.match(hint, /Create FILE: src\/lib\/gameLogic\.ts .*must export: loadGame, saveGame, Save\./, "one module to create, with every name the app uses");
assert.match(hint, /Create FILE: src\/components\/Menu\.tsx .*Menu \(default export\)/, "a component is a .tsx with its default export");

// A module that is there but lacks a name: say which file to add it to, and what it has.
fs.writeFileSync(path.join(game, "src/engine.ts"), "export const step = () => 1;\nexport interface GameState { score: number }\n");
const absentHint = await AutoFix.missingModules(game, "src/components/Save.tsx(2,21): error TS2305: Module '\"../engine\"' has no exported member 'saveGame'.");
assert.match(absentHint, /src\/engine\.ts does not export saveGame\. Add it to src\/engine\.ts .*\(step, GameState\)/);
fs.rmSync(path.join(game, "src/engine.ts"));

// The same type declared twice is named, with the engine's as the one to keep.
fs.mkdirSync(path.join(game, "src/engine"), { recursive: true });
fs.mkdirSync(path.join(game, "src/lib"), { recursive: true });
fs.writeFileSync(path.join(game, "src/engine/game.ts"), "export interface GameState { score: number }\n");
fs.writeFileSync(path.join(game, "src/lib/gameLogic.ts"), "export interface GameState { points: number }\n");
assert.match(
  await AutoFix.duplicateTypes(game, "src/App.tsx(43,34): error TS2345: Argument of type 'GameState' is not assignable to parameter of type 'GameState'."),
  /GameState is declared in .*: keep only the one in src\/engine\/game\.ts, delete it from src\/lib\/gameLogic\.ts/
);
assert.equal(await AutoFix.duplicateTypes(game, "src/App.tsx(1,1): error TS2304: Cannot find name 'x'."), "", "only when the errors are about it");
fs.rmSync(path.join(game, "src/engine"), { recursive: true });
fs.rmSync(path.join(game, "src/lib"), { recursive: true });

// An engine the build started from can grow but not be replaced.
const engineBefore = "export const step = (s: number) => {\n  const next = s + 1;\n  return next;\n};\nexport const launch = () => {\n  return 1;\n};\nexport type State = { a: number };\n";
assert.equal(CodeGuard.engineRewriteProblem(engineBefore, `${engineBefore}export const saveGame = () => 1;\n`), null, "adding an export is fine");
assert.match(CodeGuard.engineRewriteProblem(engineBefore, "export const step = (s: number) => {};\nexport type State = { a: number };\n") ?? "", /drops launch/);
assert.match(CodeGuard.engineRewriteProblem(engineBefore, "export const step = (s: number) => {};\nexport const launch = () => {};\nexport type State = { a: number };\n") ?? "", /keeps only 3 of its 8 lines/);

// A truncated engine rewrite that adds saveGame: the addition is kept, the engine is not lost.
const truncated = "export const step = (s: number) => s + 1;\nexport const saveGame = (s: State): void => {\n  localStorage.setItem('game', JSON.stringify(s));\n};\nexport function loadGame(): State | null {\n  return null;\n}\n";
const salvage = CodeGuard.mergeEngineAdditions("src/engine/game.ts", engineBefore, truncated);
assert.deepEqual(salvage?.added, ["saveGame", "loadGame"]);
assert.ok(salvage!.merged.startsWith(engineBefore.trimEnd()), "the engine is kept whole");
assert.match(salvage!.merged, /export const saveGame[\s\S]*export function loadGame/);
assert.equal(CodeGuard.mergeEngineAdditions("src/engine/game.ts", engineBefore, "export const step = () => 0;\n"), null, "nothing new: nothing to keep");

// Once the module exists, the import that points at the wrong folder is pointed at it.
fs.mkdirSync(path.join(game, "src/lib"));
fs.writeFileSync(path.join(game, "src/lib/gameLogic.ts"), "export const loadGame = () => null;\n");
assert.deepEqual(await AutoFix.fixImportPaths(game), ['src/App.tsx: import "../lib/gameLogic" now points at src/lib/gameLogic.ts']);
assert.match(fs.readFileSync(path.join(game, "src/App.tsx"), "utf8"), /from "\.\/lib\/gameLogic"/);
assert.match(fs.readFileSync(path.join(game, "src/components/SaveLoad.tsx"), "utf8"), /from "\.\.\/lib\/gameLogic"/, "a correct import is left alone");
assert.deepEqual(await AutoFix.fixImportPaths(game), [], "import fixes are idempotent");

// Two files that differ only in extension are named in the repair prompt.
fs.writeFileSync(path.join(game, "src/Game.ts"), "export interface Game { id: number }\n");
fs.writeFileSync(path.join(game, "src/Game.tsx"), "export default () => null;\n");
assert.match(await AutoFix.nameClashes(game), /src\/Game\.ts and src\/Game\.tsx: "\.\/Game" means src\/Game\.ts/);
fs.rmSync(path.join(game, "src/Game.ts"));
assert.equal(await AutoFix.nameClashes(game), "");

// The real case: Game.ts (logic) beside Game.tsx (screen), and App asking for { Game }.
const clash = fs.mkdtempSync(path.join(os.tmpdir(), "ab-clash-"));
fs.mkdirSync(path.join(clash, "src"));
fs.writeFileSync(path.join(clash, "src/Game.ts"), "type P = { score: number };\nexport const saveProgress = () => {};\nexport const loadProgress = () => {};\n");
fs.writeFileSync(path.join(clash, "src/Game.tsx"), "const Game = () => {\n  return <div>Game Screen</div>;\n};\n\nexport default Game;\n");
fs.writeFileSync(path.join(clash, "src/App.tsx"), 'import { useState } from "react";\nimport { Game } from "./Game";\nexport default () => <Game />;\n');
fs.writeFileSync(path.join(clash, "src/Game.test.tsx"), 'import { saveProgress, loadProgress } from "./Game";\n');
assert.equal((await AutoFix.splitNameClashes(clash)).length, 1);
assert.ok(fs.existsSync(path.join(clash, "src/Game.logic.ts")) && !fs.existsSync(path.join(clash, "src/Game.ts")), "the logic moved out of the screen's way");
assert.match(fs.readFileSync(path.join(clash, "src/Game.test.tsx"), "utf8"), /from "\.\/Game\.logic"/, "imports of the logic follow it");
assert.match(fs.readFileSync(path.join(clash, "src/App.tsx"), "utf8"), /import \{ Game \} from "\.\/Game"/, "imports of the screen stay");
assert.equal((await AutoFix.fixDefaultImports(clash)).length, 1);
assert.match(fs.readFileSync(path.join(clash, "src/App.tsx"), "utf8"), /^import Game from "\.\/Game";$/m, "{ Game } becomes the default import it is");
assert.match(fs.readFileSync(path.join(clash, "src/App.tsx"), "utf8"), /import \{ useState \} from "react";/, "package imports are left alone");
assert.deepEqual(await AutoFix.splitNameClashes(clash), []);
assert.deepEqual(await AutoFix.fixDefaultImports(clash), [], "default-import fix is idempotent");

// game.ts beside Game.tsx: one name to Windows. The logic moves out of the way.
const caseClash = fs.mkdtempSync(path.join(os.tmpdir(), "ab-case-"));
fs.mkdirSync(path.join(caseClash, "src"));
fs.writeFileSync(path.join(caseClash, "src/game.ts"), "export const step = () => 1;\n");
fs.writeFileSync(path.join(caseClash, "src/Game.tsx"), "export default function Game() { return null; }\n");
fs.writeFileSync(path.join(caseClash, "src/App.tsx"), 'import { step } from "./game";\nimport Game from "./Game";\n');
assert.match(await AutoFix.nameClashes(caseClash), /src\/game\.ts and src\/Game\.tsx|src\/Game\.tsx and src\/game\.ts/, "a clash that differs only in case is named");
assert.deepEqual(await AutoFix.splitNameClashes(caseClash), ["src/game.ts moved to src/game.logic.ts: it shared its name with src/Game.tsx, so the screen could never be imported"]);
assert.match(fs.readFileSync(path.join(caseClash, "src/App.tsx"), "utf8"), /import \{ step \} from "\.\/game\.logic";\nimport Game from "\.\/Game";/);

// A component used without being imported gets its import.
fs.writeFileSync(path.join(clash, "src/Save.tsx"), "export default function Save() {\n  return <p>Save</p>;\n}\n");
fs.writeFileSync(path.join(clash, "src/Load.tsx"), "export const Load = () => <p>Load</p>;\n");
fs.writeFileSync(path.join(clash, "src/Shell.tsx"), 'import { useState } from "react";\nimport Game from "./Game";\n\nexport const Shell = () => <main><Game /><Save /><Load /><Missing /></main>;\n');
assert.equal((await AutoFix.addMissingComponentImports(clash)).length, 2, "Save and Load, not Game (imported) or Missing (no file)");
const shell = fs.readFileSync(path.join(clash, "src/Shell.tsx"), "utf8");
assert.match(shell, /import Game from "\.\/Game";\nimport Save from "\.\/Save";\nimport \{ Load \} from "\.\/Load";\n/, "default and named imports, after the others");
assert.deepEqual(await AutoFix.addMissingComponentImports(clash), [], "component import fix is idempotent");

// A hook used without its import gets one: merged into the React import, or a new one.
fs.writeFileSync(path.join(clash, "src/Hooks.tsx"), 'import React, { useEffect } from "react";\nexport const A = () => { const [n, setN] = useState<number>(0); useEffect(() => {}, []); return null; };\n');
fs.writeFileSync(path.join(clash, "src/NoReact.tsx"), "export const B = () => { const r = useRef(null); return null; };\n");
const hookNotes = await AutoFix.addMissingReactImports(clash);
assert.equal(hookNotes.length, 2);
assert.match(fs.readFileSync(path.join(clash, "src/Hooks.tsx"), "utf8"), /^import React, \{ useEffect, useState \} from "react";/);
assert.match(fs.readFileSync(path.join(clash, "src/NoReact.tsx"), "utf8"), /^import \{ useRef \} from "react";/);
assert.deepEqual(await AutoFix.addMissingReactImports(clash), [], "hook import fix is idempotent");

// The real Pgame App.tsx: type-checks, and blanks the page on load.
fs.writeFileSync(
  path.join(clash, "src/Main.tsx"),
  "import React, { useState } from 'react';\nimport { renderAt } from './lib/testing';\n\nconst [currentPage, setCurrentPage] = useState<'Home' | 'Game'>('Home'); // Added 'Game' to the state type\n\nexport default function Main() {\n  return <button onClick={() => setCurrentPage('Game')}>{currentPage}</button>;\n}\n\nrenderAt(<Main />);\n"
);
const hookFix = await AutoFix.fixHooksOutsideComponents(clash);
const main = fs.readFileSync(path.join(clash, "src/Main.tsx"), "utf8");
assert.equal(hookFix.length, 2);
assert.match(main, /export default function Main\(\) \{\n  const \[currentPage, setCurrentPage\] = useState<'Home' \| 'Game'>\('Home'\);\n  return/, "the hook is inside the component");
assert.ok(!/^const \[currentPage/m.test(main) && !/Added 'Game'/.test(main), "and gone from the top, comment and all");
assert.ok(!/renderAt\(<Main/.test(main), "the test helper call is gone from the app");
assert.deepEqual(await AutoFix.fixHooksOutsideComponents(clash), [], "hook fix is idempotent");

// JSX in a .ts file is renamed; a broken .ts copy of a .tsx that exists is removed.
fs.writeFileSync(path.join(game, "src/Card.ts"), "export const Card = () => <div>card</div>;\n");
fs.writeFileSync(path.join(game, "src/Menu.test.ts"), "const view = <Menu games={[]} onSelect={() => {}} />;\n");
fs.writeFileSync(path.join(game, "src/Menu.test.tsx"), "const view = <Menu games={[]} />;\n");
const jsxFixes = await Verifier.fixJsxExtensions({ root: game } as any);
assert.ok(fs.existsSync(path.join(game, "src/Card.tsx")) && !fs.existsSync(path.join(game, "src/Card.ts")), "renamed");
assert.ok(!fs.existsSync(path.join(game, "src/Menu.test.ts")) && fs.existsSync(path.join(game, "src/Menu.test.tsx")), "broken twin removed");
assert.equal(jsxFixes.length, 2);

// Completeness: a new app that compiles but is a skeleton of the brief is not done.
const gameBrief = "Build Pgame: a website.\n\nPages / screens:\n- Home,Menu, save, load, game\n\nIt must have:\n- Progression\n- Pick a barber: Sipho\n\nLook and feel:\n- Bold and colourful\n";
assert.deepEqual(
  requirementsFromBrief(gameBrief).map((item) => item.label),
  ["Home", "Menu", "save", "load", "game", "Progression", "Pick a barber: Sipho"],
  "pages and must-haves are read from the brief, and nothing else"
);
const stub = { "src/App.tsx": 'export default () => <main><h2>Menu</h2><button>Save</button><button>Load</button><progress /><p>game</p></main>;\n' };
const stubCoverage = coverage(gameBrief, stub);
assert.deepEqual(stubCoverage.missing.map((item) => item.label), ["Home", "Pick a barber: Sipho"], "missing pages are named; a long item needs two of its words");
assert.ok(stubCoverage.lines < stubCoverage.minLines, "a skeleton is too small to be the app");
assert.equal(stubCoverage.minLines, 150, "a seven-item brief needs a full app");
assert.equal(coverage("It must have:\n- Tip percentage\n", stub).minLines, 80, "a one-item brief needs less");
// The fakes a real build shipped at "100": found without asking a model.
const shipped = {
  "src/App.tsx": "const render = () => {\n  ctx.clearRect(0, 0, w, h);\n  // Render game logic here\n  requestAnimationFrame(render);\n};\nexport default () => <button onClick={() => {}}>Save</button>;\nimport { newGame } from './game';\nconst s = newGame(cfg);\n",
  "src/lib/progression.ts": "export const getProgressionState = (gameState: GameState): GameState => {\n  return gameState;\n};\n",
  "src/game.ts": "export const newGame = (c: Cfg) => ({});\nexport function step(s: State, dt: number) { return []; }\nexport const launch = (s: State) => s;\nexport const movePaddle = (s: State, x: number) => s;\n"
};
const fakes = stubs(shipped);
assert.ok(fakes.some((f) => /App\.tsx has a placeholder comment "\/\/ Render game logic here"/.test(f)), "placeholder comment");
assert.ok(fakes.some((f) => /getProgressionState\(\) only returns what it is given/.test(f)), "identity function");
assert.ok(fakes.some((f) => /does nothing/.test(f)), "empty handler");
assert.deepEqual(stubs({ "src/a.ts": "// Score goes up by ten for each brick.\nexport const add = (a: number) => a + 10;\n" }), [], "an ordinary comment and a real function are fine");
const use = engineUse(shipped, ["src/game.ts"])[0];
assert.deepEqual(use.used, ["newGame"]);
assert.deepEqual(use.unused, ["step", "launch", "movePaddle"], "an engine imported and never driven is caught");
assert.equal(coverage("x", shipped, undefined, ["src/game.ts"]).lines < coverage("x", shipped).lines, true, "the engine's own lines are not the app's");

assert.deepEqual(parseReview('Here you go: {"missing": ["Real gameplay: the bar fills on a timer"]}'), ["Real gameplay: the bar fills on a timer"]);
assert.deepEqual(parseReview('{"missing": []}'), []);
assert.equal(parseReview("Looks fine to me."), null, "an answer without the format is not a verdict");

// TypeFixer: type errors with a mechanical fix are fixed by TypeScript, not the model.
const typed = fs.mkdtempSync(path.join(os.tmpdir(), "ab-types-"));
fs.mkdirSync(path.join(typed, "src"));
fs.writeFileSync(path.join(typed, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, target: "ES2020", module: "ESNext", moduleResolution: "Bundler", noEmit: true, lib: ["ES2020"] }, include: ["src"] }));
fs.writeFileSync(path.join(typed, "src/util.ts"), "export const add = (a: number, b: number): number => a + b;\nexport const handleStep = (): number => 1;\n");
fs.writeFileSync(
  path.join(typed, "src/game.ts"),
  [
    "interface Question { text: string; options: string[] }",
    "const state: { current: Question | null } = { current: null };",
    "export const first = (): string[] => [1].map(() => state.current.options[0]);",
    "export const total = add(1, 2);",
    "export const scoreValue = 10;",
    "export const doubled = scoreVaule * 2;",
    "export const save = () => handleSave();",
    ""
  ].join("\n")
);
const typeNotes = TypeFixer.run(typed);
const fixedGame = fs.readFileSync(path.join(typed, "src/game.ts"), "utf8");
assert.match(fixedGame, /state\.current!\.options\[0\]/, "possibly-null: marked as set");
assert.match(fixedGame, /import \{ add(, handleStep)? \} from "\.\/util";/, "missing import added");
assert.match(fixedGame, /scoreValue \* 2/, "a one-letter typo is corrected");
assert.match(fixedGame, /handleSave\(\)/, "a different name is NOT swapped in (handleSave is not handleStep)");
assert.ok(typeNotes.length >= 3, `notes: ${typeNotes.join(" | ")}`);
assert.deepEqual(TypeFixer.run(typed).filter((note) => !/handleSave/.test(note)), [], "nothing left to fix but the real gap");

// The live Pgame build's mistakes: engine mutators used as if they returned the
// state, a type imported from a file that only uses it, and a second local copy
// of an imported type.
const mutators = fs.mkdtempSync(path.join(os.tmpdir(), "ab-void-"));
fs.mkdirSync(path.join(mutators, "src", "engine"), { recursive: true });
fs.writeFileSync(path.join(mutators, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, target: "ES2020", module: "ESNext", moduleResolution: "Bundler", noEmit: true, lib: ["ES2020"] }, include: ["src"] }));
fs.writeFileSync(
  path.join(mutators, "src/engine/game.ts"),
  "export interface GameState { x: number; status: string }\nexport function launch(state: GameState): void { state.status = 'playing'; }\nexport function movePaddle(state: GameState, x: number): void { state.x = x; }\n"
);
fs.writeFileSync(
  path.join(mutators, "src/logic.ts"),
  [
    "import { GameState, launch, movePaddle } from './engine/game';",
    "interface GameState { x: number; status: string }",
    "export function serve(state: GameState): GameState {",
    "  return launch(state);",
    "}",
    "export function move(state: GameState, x: number): GameState {",
    "  state = movePaddle(state, x);",
    "  return state;",
    "}",
    ""
  ].join("\n")
);
fs.writeFileSync(path.join(mutators, "src/menu.ts"), "import { GameState } from './logic';\nexport const label = (s: GameState): string => s.status;\n");
const voidNotes = TypeFixer.run(mutators);
const logic = fs.readFileSync(path.join(mutators, "src/logic.ts"), "utf8");
assert.match(logic, /\n  launch\(state\);\n  return state;\n/, `a void mutator is called, then the state returned (notes: ${voidNotes.join(" | ")})`);
assert.match(logic, /\n  movePaddle\(state, x\);\n/, "a void mutator is no longer assigned");
assert.ok(!/^interface GameState/m.test(logic), "the second local GameState is removed");
assert.match(fs.readFileSync(path.join(mutators, "src/menu.ts"), "utf8") + logic, /export (type )?\{ GameState \}|GameState \} from '\.\/engine\/game'/, "GameState reaches menu.ts");
assert.deepEqual(TypeFixer.run(mutators), [], `nothing left: ${TypeFixer.run(mutators).join(" | ")}`);

// A Start button that sets the address in an app that switches screens with state leads nowhere.
const deadStart = stubs({
  "src/App.tsx": "const [screen, setScreen] = useState('home');\nexport default () => (screen === 'home' ? <Home /> : <Game />);\n",
  "src/components/Home.tsx": "export default () => <button onClick={() => { window.location.hash = '/game'; }}>Start</button>;\n"
});
assert.ok(deadStart.some((f) => /Home\.tsx moves to another screen.*leads nowhere/.test(f)), `dead navigation: ${deadStart.join(" | ")}`);
assert.deepEqual(
  stubs({
    "src/App.tsx": "useEffect(() => { const go = () => setScreen(window.location.hash.slice(1)); window.addEventListener('hashchange', go); }, []);\n",
    "src/Home.tsx": "export default () => <button onClick={() => { window.location.hash = '/game'; }}>Start</button>;\n"
  }),
  [],
  "an app that listens for the address is fine"
);

// The starter's <main> test is relaxed only for an App that dropped its <main>.
const starter = fs.mkdtempSync(path.join(os.tmpdir(), "ab-starter-"));
fs.mkdirSync(path.join(starter, "src"));
const stockTest = 'describe("the app", () => {\n  it("renders", () => {\n    expect(renderAt(<App />)).toContain("<main");\n  });\n});\n';
fs.writeFileSync(path.join(starter, "src/App.test.tsx"), stockTest);
fs.writeFileSync(path.join(starter, "src/App.tsx"), "export default () => <main>Hi</main>;\n");
assert.deepEqual(await AutoFix.relaxStarterTest(starter), [], "an App with a <main> keeps the test");
fs.writeFileSync(path.join(starter, "src/App.tsx"), "export default () => <div style={{ height: '100vh' }}><canvas /></div>;\n");
assert.equal((await AutoFix.relaxStarterTest(starter)).length, 1);
assert.match(fs.readFileSync(path.join(starter, "src/App.test.tsx"), "utf8"), /toMatch\(\/<\[a-z\]\/\)/, "the test now asks only that App renders");

// Planned builds: the plan is read leniently and kept to safe, unique files under src/.
const plan = AutonomousOrchestrator.parsePlan(
  'Here is the plan:\n{"files":[{"path":"src/lib/progress.ts","purpose":"levels and XP","exports":["nextLevel(xp: number): number"]},{"path":"./src/components/Menu.tsx","purpose":"menu"},{"path":"src/main.tsx","purpose":"no"},{"path":"src/lib/testing.tsx","purpose":"no"},{"path":"../evil.ts","purpose":"no"},{"path":"src/lib/Progress.ts","purpose":"dupe"},{"path":"src/App.tsx","purpose":"screens"}]}',
  new Set(["src/lib/testing.tsx", "src/main.tsx"])
);
assert.deepEqual(plan.map((file) => file.path), ["src/lib/progress.ts", "src/components/Menu.tsx", "src/App.tsx"]);
assert.deepEqual(plan[0].exports, ["nextLevel(xp: number): number"]);
assert.deepEqual(AutonomousOrchestrator.parsePlan("I think we should build a game.", new Set()), []);

// Export signatures: what another file needs to call it right, props included.
assert.deepEqual(CodeGuard.exportSignatures("const Menu = ({ onPlay }: { onPlay: () => void }) => <button onClick={onPlay}>Play</button>;\nexport default Menu;\n"), ["default Menu({ onPlay }: { onPlay: () => void })"]);
assert.deepEqual(
  CodeGuard.exportSignatures("/** Levels. */\nexport interface Level { /** n */ n: number }\nexport function next(l: Level): Level { return l; }\nexport const START: Level = { n: 1 };\n"),
  ["interface Level { n: number }", "next(l: Level): Level", "const START: Level"]
);

// Tailoring: the customer's own contact details come from the brief, not the model.
const brief = "We are Mama Nandi's Kitchen. Phone 011 555 0199, bookings on WhatsApp +27 82 555 0199, email hello@mamanandis.co.za.\n\nBusiness: Mama Nandi's Kitchen\n";
const facts = readFacts(brief);
assert.deepEqual(facts, { business: "Mama Nandi's Kitchen", email: "hello@mamanandis.co.za", phone: "011 555 0199", whatsapp: "+27 82 555 0199" });
const sampleContent = `export const site = {
  demo: true,
  business: {
    name: "Salt & Ember",
    phone: "021 555 0133",
    email: "table@saltandember.example",
    whatsapp: "+27 71 555 0133",
    instagram: "@saltandember"
  },
  hero: { title: "Welcome to Salt & Ember" }
};
`;
const tailored = applyFacts(sampleContent, facts).source;
assert.ok(tailored.includes(`name: "Mama Nandi's Kitchen"`) && tailored.includes("Welcome to Mama Nandi's Kitchen"), "the name goes in everywhere");
assert.ok(tailored.includes(`"011 555 0199"`) && tailored.includes(`"+27 82 555 0199"`) && tailored.includes(`"hello@mamanandis.co.za"`), "contact details go in");
assert.equal(sampleFactsLeft(sampleContent, sampleContent, facts).length, 4, "sample contact details and brand are caught");
assert.deepEqual(
  sampleFactsLeft(sampleContent, tailored, facts),
  [`the sample's invented brand "saltandember" is still in it (social handles, links or addresses)`],
  "the leftover handle is caught"
);
assert.deepEqual(sampleFactsLeft(sampleContent, tailored.replace("@saltandember", "@mamanandis"), facts), [], "fully tailored passes");
assert.deepEqual(sampleFactsLeft(sampleContent, sampleContent, readFacts("A restaurant in Durban.")), [], "no details in the brief, nothing demanded");

// Self-heal: the latest build of each project that ended short is retried, once per builder version.
const healDir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-heal-"));
const run = (over: Partial<BuildView>): BuildView =>
  ({
    buildId: "b", projectName: "Pgame", description: "", startedAt: "2026-10-05T10:00:00Z", finishedAt: "2026-10-05T11:00:00Z",
    state: "completed", iterations: 3, qualityScore: 35, outputDir: healDir, startedBy: "user", orderId: null, profile: "deep",
    qualityThreshold: 90, maxIterations: 60, continuedFrom: null, passed: false, bestScore: 35, outcome: null, stage: null,
    repairAttempt: null, stageSince: null, passSince: null, guidance: [], iterationDetail: [], events: [], thoughts: [], audit: null, live: false,
    ...over
  }) as BuildView;
const later = Date.parse("2026-10-05T12:00:00Z");
const healRuns = [
  run({ buildId: "pg-old", startedAt: "2026-10-04T10:00:00Z" }),
  run({ buildId: "pg-new" }),
  run({ buildId: "works", projectName: "Blog", bestScore: 100, passed: true }),
  run({ buildId: "order", projectName: "Restaurant", orderId: "o1" }),
  run({ buildId: "stopped", projectName: "Salon", state: "stopped" }),
  run({ buildId: "yielded", projectName: "Quiz", state: "stopped", startedBy: "self-heal" }),
  run({ buildId: "fresh", projectName: "Shop", finishedAt: "2026-10-05T11:55:00Z" }),
  run({ buildId: "gone", projectName: "Old", outputDir: path.join(healDir, "missing") })
];
assert.deepEqual(candidates(healRuns, "v1", { healed: {} }, later).map((b) => b.buildId).sort(), ["pg-new", "yielded"], "the latest short build per project; not working, order, stopped, just-finished or missing ones");
const healedOnV1 = { healed: { [projectKey(healRuns[1])]: { version: "v1", buildId: "x", at: "" } } };
assert.deepEqual(candidates(healRuns, "v1", healedOnV1, later).map((b) => b.buildId), ["yielded"], "retried once per version");
assert.ok(candidates(healRuns, "v2", healedOnV1, later).some((b) => b.buildId === "pg-new"), "a new builder version retries it again");

console.log("builder guards: all checks passed");
