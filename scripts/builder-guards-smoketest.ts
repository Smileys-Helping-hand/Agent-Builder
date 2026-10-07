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
import { execFileSync } from "node:child_process";

import { CodeGuard } from "../src/orchestrator/CodeGuard.js";
import { AutonomousOrchestrator } from "../src/orchestrator/AutonomousOrchestrator.js";
import { AutoFix } from "../src/orchestrator/AutoFix.js";
import { TypeFixer } from "../src/orchestrator/TypeFixer.js";
import { Verifier } from "../src/orchestrator/Verifier.js";
import { applyFacts, readFacts, sampleFactsLeft } from "../src/orchestrator/Tailoring.js";
import { coverage, dropUnrelatedResearch, engineUse, parseReview, relatedTo, requirementsFromBrief, reviewPrompt, stubs, unreachableScreens, unshownComponents } from "../src/orchestrator/Completeness.js";
import { candidates, projectKey } from "../src/orchestrator/SelfHeal.js";
import type { BuildView } from "../src/orchestrator/BuildService.js";
import { ModelRouter, modelServerDown } from "../src/tools/ModelRouter.js";

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
// A board that hands the engine's actions over (act(attack)) drives it; the engine's own helpers are not the app's to call.
const rpgUse = engineUse(
  {
    "src/engine/game.ts": "export function random(s: number) { return s; }\nexport function enterFloor(state: object) { random(1); }\nexport function newGame() { enterFloor({}); return {}; }\nexport function attack(state: object) { return []; }\nexport function flee(state: object) { return []; }\n",
    "src/engine/play.tsx": "import { attack, flee, newGame } from './game';\nexport function GameBoard() { const s = newGame(); act(attack); return <button onClick={() => act(flee)} />; }\n",
    "src/App.tsx": "import { GameBoard } from './engine/play';\nexport default () => <GameBoard />;\n"
  },
  ["src/engine/game.ts", "src/engine/play.tsx"]
);
assert.deepEqual(rpgUse[0].used.sort(), ["attack", "flee", "newGame"]);
assert.deepEqual(rpgUse[0].unused, [], "random and enterFloor are the engine's own helpers");

// Screens nothing can switch to are named; a screen reached another way is not.
const screensApp = [
  "const App = () => {",
  "  const [screen, setScreen] = useState<'title' | 'game' | 'sheet' | 'hall'>('title');",
  "  const handlePlay = () => {",
  "    setScreen('game');",
  "  };",
  "  const handleSheet = () => {",
  "    setScreen('sheet');",
  "  };",
  "  const handleHall = () => {",
  "    setScreen('hall');",
  "  };",
  "  const goHall = () => {",
  "    setScreen('hall');",
  "  };",
  "  if (screen === 'title') return <Title onPlay={handlePlay} onScores={goHall} />;",
  "  return null;",
  "};",
  ""
].join("\n");
assert.deepEqual(unreachableScreens({ "src/App.tsx": screensApp }), [{ screen: "sheet", handler: "handleSheet" }], "the hall is reached through goHall; the sheet never is");
assert.deepEqual(unreachableScreens({ "src/App.tsx": screensApp.replace("onScores={goHall}", "onScores={goHall} onSheet={handleSheet}") }), [], "every screen reachable");
assert.deepEqual(unreachableScreens({ "src/Other.tsx": "x" }), [], "no App, nothing to say");
// No handler at all: a screen App shows that nothing switches to (the hall's own Back button goes elsewhere).
const inlineApp = [
  "function App() {",
  "  const [currentScreen, setCurrentScreen] = React.useState<'title' | 'game' | 'hall'>('title');",
  "  return (",
  "    <div>",
  "      {currentScreen === 'title' && <TitleScreen onPlay={() => setCurrentScreen('game')} />}",
  "      {currentScreen === 'game' && <GameScreen />}",
  "      {currentScreen === 'hall' && <HallOfHeroes onBack={() => setCurrentScreen('title')} />}",
  "    </div>",
  "  );",
  "}",
  ""
].join("\n");
assert.deepEqual(unreachableScreens({ "src/App.tsx": inlineApp }), [{ screen: "hall", handler: "" }]);
assert.deepEqual(unreachableScreens({ "src/App.tsx": inlineApp.replace("<TitleScreen onPlay={() => setCurrentScreen('game')} />", "<TitleScreen onPlay={() => setCurrentScreen('game')} onScores={() => setCurrentScreen('hall')} />") }), []);
assert.deepEqual(engineUse({ "src/engine/game.ts": "export function attack() {}\n", "src/App.tsx": "import { attack } from './engine/game';\n" }, ["src/engine/game.ts"])[0].unused, ["attack"], "an import alone is not use");
assert.equal(coverage("x", shipped, undefined, ["src/game.ts"]).lines < coverage("x", shipped).lines, true, "the engine's own lines are not the app's");

assert.deepEqual(parseReview('Here you go: {"missing": ["Real gameplay: the bar fills on a timer"]}'), ["Real gameplay: the bar fills on a timer"]);
assert.deepEqual(parseReview('{"missing": []}'), []);
assert.equal(parseReview("Looks fine to me."), null, "an answer without the format is not a verdict");
// The engine is described to the reviewer (what it does, what it exports), never cut off by the budget.
const reviewed = reviewPrompt(
  "Build an RPG with turn-based battles",
  {
    "src/App.tsx": "export default function App() { return null; }\n",
    "src/engine/game.ts": `/**\n * Turn-based battles, levels and a boss.\n */\nexport function attack() {}\n${"// rule\n".repeat(3000)}`
  },
  2_000,
  ["src/engine/game.ts"]
);
assert.match(reviewed, /Already in the app, complete and tested[^\n]*\n- src\/engine\/game\.ts: Turn-based battles, levels and a boss\. \(exports attack\)/, reviewed.slice(0, 600));
assert.ok(!reviewed.includes("FILE: src/engine/game.ts"), "the engine's code is not spent from the budget");

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

// With a playable board, the plan does not redo input, the loop or drawing; the rest of the app stays.
assert.equal(AutonomousOrchestrator.duplicatesBoard({ path: "src/lib/inputHandler.ts", purpose: "handles paddle movement and ball launch" }), true);
assert.equal(AutonomousOrchestrator.duplicatesBoard({ path: "src/lib/gameLoop.ts", purpose: "runs the frame loop" }), true);
assert.equal(AutonomousOrchestrator.duplicatesBoard({ path: "src/lib/storage.ts", purpose: "save and load the game in localStorage" }), false);
assert.equal(AutonomousOrchestrator.duplicatesBoard({ path: "src/lib/progression.ts", purpose: "unlock levels and track high scores" }), false);
assert.equal(AutonomousOrchestrator.duplicatesBoard({ path: "src/lib/gameLogic.ts", purpose: "handles game events and updates the game state" }), true, "a reducer around the board's own actions");
assert.equal(AutonomousOrchestrator.duplicatesScores({ path: "src/lib/highScores.ts", purpose: "keeps the best heroes" }), true, "the engine's score table does this");
assert.equal(AutonomousOrchestrator.duplicatesScores({ path: "src/lib/leaderboard.ts", purpose: "top ten" }), true);
assert.equal(AutonomousOrchestrator.duplicatesScores({ path: "src/lib/hallOfFame.ts", purpose: "" }), true);
assert.equal(AutonomousOrchestrator.duplicatesScores({ path: "src/components/HallOfHeroes.tsx", purpose: "shows the best scores" }), false, "a screen that shows the table stays");
assert.equal(AutonomousOrchestrator.duplicatesScores({ path: "src/lib/progression.ts", purpose: "unlock levels and track high scores" }), false, "a module with other work stays");
assert.equal(AutonomousOrchestrator.duplicatesScores({ path: "src/lib/highScores.test.ts", purpose: "" }), false);
assert.equal(AutonomousOrchestrator.duplicatesBoard({ path: "src/lib/combat.ts", purpose: "turn-based battle rules" }), true);
assert.equal(AutonomousOrchestrator.duplicatesBoard({ path: "src/lib/gameSave.ts", purpose: "save and load the hero and high scores" }), false, "saving stays");
assert.equal(AutonomousOrchestrator.duplicatesBoard({ path: "src/components/Game.tsx", purpose: "the game screen with the canvas" }), false, "screens stay: the game screen is where the board goes");
assert.equal(AutonomousOrchestrator.duplicatesBoard({ path: "src/components/GameScreen.tsx", purpose: "the battle and the map" }), false);
assert.equal(AutonomousOrchestrator.duplicatesBoard({ path: "src/components/BattleScreen.tsx", purpose: "turn-based battles" }), true, "the board has its own battle panel");
assert.equal(AutonomousOrchestrator.duplicatesBoard({ path: "src/components/GameControls.tsx", purpose: "on-screen buttons" }), true);
assert.equal(AutonomousOrchestrator.duplicatesBoard({ path: "src/components/CharacterSheet.tsx", purpose: "hero stats" }), false, "other screens stay");
assert.equal(AutonomousOrchestrator.duplicatesBoard({ path: "src/components/HallOfHeroes.tsx", purpose: "high scores" }), false);

// With a playable board, the builder writes the game screen itself: the board, nothing else.
const screenFor = AutonomousOrchestrator.builtInGameScreen([
  { file: "src/engine/game.ts", text: "export interface GameState { score: number }\nexport const DEFAULT_SETTINGS = {};\n" },
  { file: "src/engine/play.tsx", text: "export function GameBoard() { return null; }\n" }
]);
assert.ok(screenFor, "an engine with a board, settings and a state gets a built-in game screen");
const builtScreen = screenFor!("src/components/GameScreen.tsx");
assert.match(builtScreen, /import \{ GameBoard \} from "\.\.\/engine\/play";/);
assert.match(builtScreen, /import \{ DEFAULT_SETTINGS, type GameState \} from "\.\.\/engine\/game";/);
assert.match(builtScreen, /<GameBoard settings=\{DEFAULT_SETTINGS\} onScore=\{onScore\} onChange=\{onChange\} \/>/);
assert.ok(builtScreen.includes(AutonomousOrchestrator.BUILT_IN_MARK), "marked, so repairs leave it alone");
assert.match(builtScreen, /onBack\?: \(\) => void;[\s\S]*\{onBack && \(/, "a way back to the menu when the app gives one");
assert.equal(AutonomousOrchestrator.builtInGameScreen([{ file: "src/engine/game.ts", text: "export const x = 1;\n" }]), null, "no board, no built-in screen");

// A copied project (no head-start commit) still has its catalogue engine recognised by its header.
const copiedEngine = fs.mkdtempSync(path.join(os.tmpdir(), "ab-copied-"));
fs.writeFileSync(path.join(copiedEngine, "game.ts"), fs.readFileSync(path.resolve("templates/sites/rpg/src/game.ts"), "utf8").replace("export function", "// changed since\nexport function"));
assert.equal(AutonomousOrchestrator.catalogueEngine(path.join(copiedEngine, "game.ts"), path.resolve("templates/sites")), true, "an RPG engine, changed below its header, is still ours");
fs.writeFileSync(path.join(copiedEngine, "play.tsx"), "/**\n * A board the model wrote itself, with a long enough comment to be compared.\n */\nexport const x = 1;\n");
assert.equal(AutonomousOrchestrator.catalogueEngine(path.join(copiedEngine, "play.tsx"), path.resolve("templates/sites")), false, "a file of the same name that is not ours");

// A carried-on build knows how its predecessor ended, so its first pass repairs instead of rewriting.
assert.equal(AutonomousOrchestrator.inheritedBlocker("Build Pgame.\n\nThis project was started by an earlier build and is already in the folder.\nCarry on.\n\nWhen it last ran, the typecheck check failed with:\nsrc/a.ts(1,1): error"), "typecheck");
assert.equal(AutonomousOrchestrator.inheritedBlocker("Build Pgame.\n\nWhen it last ran, the test check failed with:\n1 failed"), undefined, "a failing test is not a reason to stop adding");
assert.equal(AutonomousOrchestrator.inheritedBlocker("Build Pgame: a fresh one."), undefined);

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

// A name used several times without an import is imported once, not once per use.
const many = fs.mkdtempSync(path.join(os.tmpdir(), "ab-many-"));
fs.mkdirSync(path.join(many, "src"));
fs.writeFileSync(path.join(many, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, target: "ES2020", module: "ESNext", moduleResolution: "Bundler", noEmit: true, lib: ["ES2020"] }, include: ["src"] }));
fs.writeFileSync(path.join(many, "src/settings.ts"), "export const DEFAULT_SETTINGS = { lives: 3, width: 320 };\nexport const handleEvent = (n: number): number => n;\n");
fs.writeFileSync(
  path.join(many, "src/use.ts"),
  "export const a = DEFAULT_SETTINGS.lives;\nexport const b = DEFAULT_SETTINGS.width;\nexport const c = DEFAULT_SETTINGS.lives + handleEvent(1) + handleEvent(2) + handleEvent(3);\n"
);
TypeFixer.run(many);
const used = fs.readFileSync(path.join(many, "src/use.ts"), "utf8");
const importLines = used.split("\n").filter((line) => line.startsWith("import"));
assert.equal(importLines.filter((line) => /\bDEFAULT_SETTINGS\b/.test(line)).length, 1, `DEFAULT_SETTINGS imported once: ${used}`);
assert.equal(importLines.filter((line) => /\bhandleEvent\b/.test(line)).length, 1, `handleEvent imported once: ${used}`);
assert.ok(importLines.every((line) => (line.match(/\b(DEFAULT_SETTINGS|handleEvent)\b/g) ?? []).length === 1), `no name twice in one import: ${used}`);

// Names already imported twice (the live Pgame test file) are imported once.
const dup = fs.mkdtempSync(path.join(os.tmpdir(), "ab-dup-"));
fs.mkdirSync(path.join(dup, "src", "lib"), { recursive: true });
fs.writeFileSync(
  path.join(dup, "src/lib/gameLogic.test.ts"),
  [
    "// src/lib/gameLogic.test.ts",
    "",
    'import { DEFAULT_SETTINGS } from "../engine/game";',
    'import { DEFAULT_SETTINGS } from "../engine/game";',
    'import { DEFAULT_SETTINGS } from "../engine/game";',
    "import { GameState, initializeGame, handleEvent, handleEvent, handleEvent } from '../lib/gameLogic';",
    'import Home, { type Props as HomeProps } from "../Home";',
    'import Home from "../Home";',
    "",
    "describe('x', () => {});",
    ""
  ].join("\n")
);
assert.deepEqual(await AutoFix.dedupeImports(dup), ["src/lib/gameLogic.test.ts: removed 5 name(s) imported a second time"]);

// Screens nothing opens get buttons on the first screen and a Back; a Back to itself goes home.
const nav = fs.mkdtempSync(path.join(os.tmpdir(), "ab-nav-"));
fs.mkdirSync(path.join(nav, "src"));
fs.writeFileSync(
  path.join(nav, "src/App.tsx"),
  [
    "const App = () => {",
    "  const [appState, setAppState] = useState<AppState>({ screen: 'title' });",
    "  const handlePlay = () => {",
    "    setAppState({ screen: 'game' });",
    "  };",
    "  const handleBack = () => {",
    "    setAppState({ screen: 'title' });",
    "  };",
    "  const handleBackToGame = () => {",
    "    setAppState({ screen: 'game' });",
    "  };",
    "  const handleCharacterSheet = () => {",
    "    setAppState({ screen: 'character' });",
    "  };",
    "  switch (appState.screen) {",
    "    case 'title':",
    "      return <TitleScreen onPlay={handlePlay} />;",
    "    case 'game':",
    "      return <GameScreen onScore={(s) => s} onBack={handleBackToGame} />;",
    "    case 'character':",
    "      return <CharacterSheet hero={hero} />;",
    "    case 'hall':",
    "      return <HallOfHeroes onBack={handleBack} />;",
    "  }",
    "};",
    ""
  ].join("\n")
);
assert.deepEqual(await AutoFix.wireUnreachableScreens(nav), ["src/App.tsx: added a way into character, hall from the title screen, and a Back button"]);
const wired = fs.readFileSync(path.join(nav, "src/App.tsx"), "utf8");
assert.match(wired, /<TitleScreen onPlay=\{handlePlay\} \/>[\s\S]*<button type="button" className="btn" onClick=\{handleCharacterSheet\}>Character sheet<\/button>[\s\S]*onClick=\{\(\) => setAppState\(\{ screen: 'hall' \}\)\}>Hall<\/button>/, wired);
assert.match(wired, /onClick=\{handleBack\}>← Back<\/button>\s*<CharacterSheet hero=\{hero\} \/>/, "the sheet had no way back");
assert.ok(!/← Back<\/button>\s*<HallOfHeroes/.test(wired), "the hall has its own Back");
assert.deepEqual(unreachableScreens({ "src/App.tsx": wired }), [], "every screen reachable now");
assert.deepEqual(await AutoFix.wireUnreachableScreens(nav), [], "nothing left to wire");
assert.deepEqual(await AutoFix.fixBackToSelf(nav), ["src/App.tsx: the game screen's Back went back to itself; it goes to the title screen now"]);
assert.match(fs.readFileSync(path.join(nav, "src/App.tsx"), "utf8"), /<GameScreen onScore=\{\(s\) => s\} onBack=\{handleBack\} \/>/);

// A build config written inside src/ goes when the project's own is at its root; one with no root twin stays.
const misplaced = fs.mkdtempSync(path.join(os.tmpdir(), "ab-misplaced-"));
fs.mkdirSync(path.join(misplaced, "src"));
fs.writeFileSync(path.join(misplaced, "vite.config.ts"), "export default {};\n");
fs.writeFileSync(path.join(misplaced, "src/vite.config.ts"), "export default defineConfig({ plugins: [react(`\n");
fs.writeFileSync(path.join(misplaced, "src/tsconfig.json"), "{}\n");
assert.deepEqual(await AutoFix.removeMisplacedConfig(misplaced), ["removed src/vite.config.ts: the project's build config is the one at its root"]);
assert.equal(fs.existsSync(path.join(misplaced, "src/vite.config.ts")), false);
assert.equal(fs.existsSync(path.join(misplaced, "src/tsconfig.json")), true, "no tsconfig at the root: left alone");
assert.equal(
  fs.readFileSync(path.join(dup, "src/lib/gameLogic.test.ts"), "utf8"),
  [
    "// src/lib/gameLogic.test.ts",
    "",
    'import { DEFAULT_SETTINGS } from "../engine/game";',
    "import { GameState, initializeGame, handleEvent } from '../lib/gameLogic';",
    'import Home, { type Props as HomeProps } from "../Home";',
    "",
    "describe('x', () => {});",
    ""
  ].join("\n")
);
assert.deepEqual(await AutoFix.dedupeImports(dup), [], "nothing left to remove");

// The same for an action that changes the state and returns what happened (events), as the RPG engine's do.
const eventsDir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-events-"));
fs.mkdirSync(path.join(eventsDir, "src", "engine"), { recursive: true });
fs.mkdirSync(path.join(eventsDir, "node_modules"));
fs.writeFileSync(path.join(eventsDir, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, target: "ES2020", module: "ESNext", moduleResolution: "Bundler", noEmit: true, lib: ["ES2020"] }, include: ["src"] }));
fs.writeFileSync(path.join(eventsDir, "src/engine/game.ts"), 'export type GameEvent = "moved" | "healed";\nexport interface GameState { hp: number; potions: number }\nexport function usePotion(state: GameState): GameEvent[] { state.hp += 5; return ["healed"]; }\n');
fs.writeFileSync(path.join(eventsDir, "src/logic.ts"), "import { usePotion, type GameState } from './engine/game';\nexport function heal(state: GameState): GameState {\n  let next = state;\n  next = usePotion(next);\n  return usePotion(next);\n}\n");
TypeFixer.run(eventsDir);
const healed = fs.readFileSync(path.join(eventsDir, "src/logic.ts"), "utf8");
assert.match(healed, /\n  usePotion\(next\);\n  usePotion\(next\);\n  return next;\n/, healed);
assert.equal(TypeFixer.errorCount(eventsDir), 0);

// A spelling fix never swaps in a browser global: an undefined TOP is not `top` (window.top).
const globalsDir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-globals-"));
fs.mkdirSync(path.join(globalsDir, "src"));
fs.writeFileSync(path.join(globalsDir, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, target: "ES2020", module: "ESNext", moduleResolution: "Bundler", noEmit: true, lib: ["ES2020", "DOM"] }, include: ["src"] }));
fs.writeFileSync(path.join(globalsDir, "src/a.ts"), "const score = 1;\nexport const y = TOP + 10;\nexport const z = scroe + 1;\n");
TypeFixer.run(globalsDir);
const globalsText = fs.readFileSync(path.join(globalsDir, "src/a.ts"), "utf8");
assert.match(globalsText, /TOP \+ 10/,`not changed to a browser global: ${globalsText}`);
assert.match(globalsText, /score \+ 1/, "a typo of the project's own name is still fixed");

// Files an older builder let prose overwrite come back from their own history.
const proseRepo = fs.mkdtempSync(path.join(os.tmpdir(), "ab-prose-"));
fs.mkdirSync(path.join(proseRepo, "src"), { recursive: true });
const gitProse = (...args: string[]) => execFileSync("git", args, { cwd: proseRepo, stdio: "ignore" });
gitProse("init", "-q");
gitProse("config", "user.email", "t@t");
gitProse("config", "user.name", "t");
const reservation = "import { useState } from 'react';\nexport const Reservation = () => {\n  const [date, setDate] = useState('');\n  return <input value={date} onChange={(e) => setDate(e.target.value)} />;\n};\n";
fs.writeFileSync(path.join(proseRepo, "src/Reservation.tsx"), reservation);
fs.writeFileSync(path.join(proseRepo, "src/ok.ts"), "export const ok = 1;\n");
gitProse("add", "-A");
gitProse("commit", "-q", "-m", "Iteration 1: generate");
fs.writeFileSync(path.join(proseRepo, "src/Reservation.tsx"), "To optimize the code for performance, we can make several improvements, including caching.\n\n1. **Caching**: use it.\n");
gitProse("commit", "-qam", "Iteration 9: apply 8 improvement(s)");
const restoredFiles = CodeGuard.restoreUnparseable(proseRepo);
assert.deepEqual(restoredFiles.map((item) => item.file), ["src/Reservation.tsx"], "only the file that does not parse");
assert.equal(restoredFiles[0].text, reservation, "back to the latest version that was code");

// A continued build gets back what a pass took out of the engine it started from.
const engineRepo = fs.mkdtempSync(path.join(os.tmpdir(), "ab-engine-"));
fs.mkdirSync(path.join(engineRepo, "src", "engine"), { recursive: true });
const gitIn = (...args: string[]) => execFileSync("git", args, { cwd: engineRepo, stdio: "ignore" });
gitIn("init", "-q");
gitIn("config", "user.email", "t@t");
gitIn("config", "user.name", "t");
const engineFile = path.join(engineRepo, "src/engine/game.ts");
fs.writeFileSync(engineFile, 'export type GameEvent = "brick" | "wall";\nexport interface GameState { score: number }\nexport function step(state: GameState): GameEvent[] { return []; }\n');
gitIn("add", "-A");
gitIn("commit", "-q", "-m", "Head start: the engine from Arcade Promo Game");
assert.equal(CodeGuard.restoreEngine(engineRepo, "src/engine/game.ts"), null, "an intact engine is left alone");
fs.writeFileSync(engineFile, "export interface GameState { score: number }\nexport function step(state: GameState): any[] { return []; }\nexport function saveGame(state: GameState): void { state.score = 0; }\n");
const restoredEngine = CodeGuard.restoreEngine(engineRepo, "src/engine/game.ts");
assert.equal(restoredEngine?.problem, "had lost GameEvent");
assert.match(restoredEngine!.text, /export type GameEvent/, "the lost export is back");
assert.match(restoredEngine!.text, /export function saveGame/, "what it added is kept");
assert.equal(CodeGuard.headStart(engineRepo, "src/engine/other.ts"), null, "a file that was not a head start is not ours to restore");

// A repair that answers with a fragment does not replace a working file.
const frag = fs.mkdtempSync(path.join(os.tmpdir(), "ab-frag-"));
fs.mkdirSync(path.join(frag, "src", "components"), { recursive: true });
const saveScreen = [
  "import React, { useState } from 'react';",
  "import { saveGame } from '../lib/gameLogic';",
  "",
  "const Save: React.FC = () => {",
  "  const [name, setName] = useState('');",
  "  const [saved, setSaved] = useState(false);",
  "  const onSave = () => { saveGame(name); setSaved(true); };",
  "  return (",
  "    <section>",
  "      <input value={name} onChange={(e) => setName(e.target.value)} />",
  "      <button onClick={onSave}>Save</button>",
  "      {saved ? <p>Saved</p> : null}",
  "    </section>",
  "  );",
  "};",
  "",
  "export default Save;",
  ""
].join("\n");
fs.writeFileSync(path.join(frag, "src/components/Save.tsx"), saveScreen);
fs.writeFileSync(path.join(frag, "src/App.tsx"), "import Save from './components/Save';\nexport const App = () => <Save />;\n");
assert.match(String(CodeGuard.fragmentProblem(frag, "src/components/Save.tsx", saveScreen, "import { saveGame } from '../lib/gameLogic';\n")), /keeps only 1 of its 15 lines/, "a one-line answer is not the file");
assert.equal(
  CodeGuard.fragmentProblem(frag, "src/components/Save.tsx", saveScreen, "import React from 'react';\nconst Save = () => <section><button>Save</button></section>;\nexport const helper = 1;\nconst a = 1;\n"),
  "drops its default export, which src/App.tsx imports",
  "a rewrite that loses what App imports is refused"
);
assert.equal(CodeGuard.fragmentProblem(frag, "src/components/Save.tsx", saveScreen, saveScreen.replace("Saved", "Saved!")), null, "a real edit is fine");

// Emotion's css prop needs its one line at the top of the file.
const emotion = fs.mkdtempSync(path.join(os.tmpdir(), "ab-emotion-"));
fs.mkdirSync(path.join(emotion, "src", "components"), { recursive: true });
fs.writeFileSync(path.join(emotion, "src/components/Home.tsx"), "import { css } from '@emotion/react';\nconst box = css`padding: 1rem;`;\nexport default () => <div css={box}>Hi</div>;\n");
fs.writeFileSync(path.join(emotion, "src/components/Plain.tsx"), "import { css } from '@emotion/react';\nexport const s = css`color: red;`;\n");
assert.equal((await AutoFix.addEmotionPragma(emotion)).length, 1, "only the file that uses the css prop");
assert.match(fs.readFileSync(path.join(emotion, "src/components/Home.tsx"), "utf8"), /^\/\*\* @jsxImportSource @emotion\/react \*\/\n/);
assert.deepEqual(await AutoFix.addEmotionPragma(emotion), [], "added once");

// `box-shadow:` in a style object is CSS where React wants boxShadow.
const kebab = fs.mkdtempSync(path.join(os.tmpdir(), "ab-kebab-"));
fs.mkdirSync(path.join(kebab, "src", "lib"), { recursive: true });
fs.writeFileSync(path.join(kebab, "src/lib/styles.ts"), "export const appStyles = {\n  screen: {\n    padding: '2rem',\n    box-shadow: '0 0 10px rgba(0,0,0,0.1)',\n    z-index: 2,\n  },\n};\n");
fs.writeFileSync(path.join(kebab, "src/lib/page.ts"), "export const css = `\n  box-shadow: 0 0 10px black;\n`;\n");
assert.equal((await AutoFix.fixKebabCaseKeys(kebab)).length, 1);
const kebabFixed = fs.readFileSync(path.join(kebab, "src/lib/styles.ts"), "utf8");
assert.match(kebabFixed, /\n    boxShadow: '0 0 10px/, `camel-cased: ${kebabFixed}`);
assert.match(kebabFixed, /\n    zIndex: 2,/);
assert.deepEqual(CodeGuard.syntaxErrors("src/lib/styles.ts", kebabFixed), [], "it parses");
assert.match(fs.readFileSync(path.join(kebab, "src/lib/page.ts"), "utf8"), /box-shadow: 0 0 10px/, "CSS inside a string in a file that parses is left alone");

// The live Pgame build's last three: a number used as its list, a name imported
// from the wrong file, and an empty stub shadowing the real function.
const levels = fs.mkdtempSync(path.join(os.tmpdir(), "ab-levels-"));
fs.mkdirSync(path.join(levels, "src", "engine"), { recursive: true });
fs.mkdirSync(path.join(levels, "src", "lib"), { recursive: true });
fs.writeFileSync(path.join(levels, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, target: "ES2020", module: "ESNext", moduleResolution: "Bundler", noEmit: true, lib: ["ES2020"] }, include: ["src"] }));
fs.writeFileSync(
  path.join(levels, "src/engine/game.ts"),
  [
    "export interface LevelSpec { rows: string[] }",
    "export interface GameSettings { width: number; levels: LevelSpec[] }",
    "export interface GameState { level: number; settings: GameSettings }",
    "export function bricksFor(level: LevelSpec, width: number): number { return level.rows.length * width; }",
    "export function newGame(settings: GameSettings): GameState { return { level: 0, settings }; }",
    "export function updateGameState(state: GameState): GameState {",
    "  // Implementation of updateGameState",
    "}",
    ""
  ].join("\n")
);
fs.writeFileSync(path.join(levels, "src/lib/gameLogic.ts"), "import { GameState } from '../engine/game';\nexport function updateGameState(state: GameState): GameState { return { ...state, level: state.level + 1 }; }\n");
fs.writeFileSync(
  path.join(levels, "src/lib/play.ts"),
  [
    "import { GameState, bricksFor, updateGameState } from '../engine/game';",
    "import { newGame } from './gameLogic';",
    "export const current = (state: GameState) => state.level[state.level];",
    "export const more = (state: GameState) => state.level + 1 < state.level.length;",
    "export const bricks = (state: GameState) => bricksFor(state.level, state.settings.width);",
    "export const next = (state: GameState) => updateGameState(state);",
    "export const fresh = newGame;",
    ""
  ].join("\n")
);
const levelNotes = TypeFixer.run(levels);
const play = fs.readFileSync(path.join(levels, "src/lib/play.ts"), "utf8");
assert.match(play, /state\.settings\.levels\[state\.level\];/, `indexing the number becomes the list: ${levelNotes.join(" | ")}`);
assert.match(play, /state\.level \+ 1 < state\.settings\.levels\.length/, "its length is the list's");
assert.match(play, /bricksFor\(state\.settings\.levels\[state\.level\], state\.settings\.width\)/, "a call that wants a level gets the level");
assert.match(play, /import \{ newGame \} from "\.\.\/engine\/game"|import \{ newGame \} from '\.\.\/engine\/game'/, "newGame comes from the file that exports it");
assert.match(play, /import \{ updateGameState \} from ['"]\.\/gameLogic['"]/, "the real updateGameState is imported");
assert.ok(!/Implementation of updateGameState/.test(fs.readFileSync(path.join(levels, "src/engine/game.ts"), "utf8")), "the empty stub is gone");
assert.deepEqual(TypeFixer.run(levels), [], `nothing left: ${TypeFixer.run(levels).join(" | ")}`);
// "Did you mean 'startLevel'?" when another file of ours exports startNewLevel itself.
const didYouMean = fs.mkdtempSync(path.join(os.tmpdir(), "ab-dym-"));
fs.mkdirSync(path.join(didYouMean, "src", "engine"), { recursive: true });
fs.mkdirSync(path.join(didYouMean, "src", "lib"), { recursive: true });
fs.mkdirSync(path.join(didYouMean, "node_modules"));
fs.writeFileSync(path.join(didYouMean, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, target: "ES2020", module: "ESNext", moduleResolution: "Bundler", noEmit: true, lib: ["ES2020"] }, include: ["src"] }));
fs.writeFileSync(path.join(didYouMean, "src/engine/game.ts"), "export const startLevel = (n: number): number => n;\n");
fs.writeFileSync(path.join(didYouMean, "src/lib/gameLogic.ts"), "export const startNewLevel = (n: number): number => n + 1;\n");
fs.writeFileSync(path.join(didYouMean, "src/Game.ts"), "import { startLevel, startNewLevel } from './engine/game';\nexport const both = startLevel(1) + startNewLevel(1);\n");
TypeFixer.run(didYouMean);
assert.match(fs.readFileSync(path.join(didYouMean, "src/Game.ts"), "utf8"), /import \{ startNewLevel \} from ['"]\.\/lib\/gameLogic['"]/, "the real startNewLevel, not startLevel");
assert.equal(TypeFixer.errorCount(didYouMean), 0, "and it compiles");
const brokenCount = fs.mkdtempSync(path.join(os.tmpdir(), "ab-count-"));
fs.mkdirSync(path.join(brokenCount, "src"));
fs.mkdirSync(path.join(brokenCount, "node_modules"));
fs.writeFileSync(path.join(brokenCount, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, lib: ["ES2020"] }, include: ["src"] }));
fs.writeFileSync(path.join(brokenCount, "src/a.ts"), "export const a: number = 'x';\nexport const b: string = 1;\n");
assert.equal(TypeFixer.errorCount(brokenCount), 2, "errorCount counts what tsc would");
fs.rmSync(path.join(brokenCount, "node_modules"), { recursive: true });
assert.equal(TypeFixer.errorCount(brokenCount), null, "before install it cannot tell");

// The playable board the build started with has to be on a screen; four buttons that fire events are not a game.
const board = "export function GameBoard({ settings }: { settings: unknown }) { step(); return <canvas />; }\n";
assert.deepEqual(
  unshownComponents({ "src/engine/play.tsx": board, "src/components/Game.tsx": "export default () => <div><button>Hit Brick</button><button>Win Game</button></div>;\n" }, ["src/engine/game.ts", "src/engine/play.tsx"]),
  [{ file: "src/engine/play.tsx", components: ["GameBoard"] }]
);
assert.deepEqual(
  unshownComponents({ "src/engine/play.tsx": board, "src/components/Game.tsx": "export default () => <GameBoard settings={DEFAULT_SETTINGS} />;\n" }, ["src/engine/play.tsx"]),
  [],
  "rendered on the game screen"
);

// A component from the engine counts as used when a screen renders it.
assert.deepEqual(
  engineUse({ "src/engine/play.tsx": board, "src/components/Game.tsx": "export default () => <GameBoard settings={DEFAULT_SETTINGS} />;\n" }, ["src/engine/play.tsx"])[0].unused,
  [],
  "<GameBoard /> is using it"
);

// A dead button on a screen gets the exact wiring when App switches screens with state.
const deadPlay = stubs({
  "src/App.tsx": 'const App = () => {\n  const [screen, setScreen] = useState<"home" | "menu" | "game">("home");\n  return <div>{screen === "home" && <Home />}</div>;\n};\n',
  "src/components/Home.tsx": "const Home = () => <div><h1>Pgame</h1><button onClick={() => {}}>Play Game</button></div>;\nexport default Home;\n"
});
assert.match(deadPlay[0], /give Home a prop onGame: \(\) => void, call it from the "Play Game" button \(onClick=\{onGame\}\), and in src\/App\.tsx render <Home onGame=\{\(\) => setScreen\("game"\)\} \/>/, deadPlay[0]);
assert.match(stubs({ "src/a.tsx": "export const A = () => <button onClick={() => {}}>Go</button>;\n" })[0], /does nothing \(\{\(\) => \{\}\}\)$/, "without screen state, the plain message");

// A field read from the wrong type is pointed at the engine type that has it.
const homes = fs.mkdtempSync(path.join(os.tmpdir(), "ab-homes-"));
fs.mkdirSync(path.join(homes, "src", "engine"), { recursive: true });
fs.writeFileSync(path.join(homes, "src/engine/game.ts"), "export interface Hero {\n  name: string;\n  hp: number;\n}\n\nexport interface GameState {\n  hero: Hero;\n  score: number;\n}\n");
const homeHint = await AutoFix.fieldHomes(homes, "src/a.ts(1,1): error TS2339: Property 'score' does not exist on type 'Hero'.\n");
assert.match(homeHint, /score is a field of GameState \(src\/engine\/game\.ts\), not of Hero/, homeHint);
assert.equal(await AutoFix.fieldHomes(homes, "src/a.ts(1,1): error TS2339: Property 'mana' does not exist on type 'Hero'.\n"), "", "nothing to say when no engine type has it");

// What the engine already makes, named when a build makes its own badly.
const made = fs.mkdtempSync(path.join(os.tmpdir(), "ab-made-"));
fs.mkdirSync(path.join(made, "src", "engine"), { recursive: true });
fs.mkdirSync(path.join(made, "src", "lib"), { recursive: true });
fs.writeFileSync(path.join(made, "src/engine/game.ts"), "export interface Hero {\n  name: string;\n  x: number;\n}\n\nexport interface GameState {\n  hero: Hero;\n}\n\nexport const DEFAULT_SETTINGS = {};\nexport function newGame(settings: object): GameState { return { hero: { name: '', x: 0 } }; }\n");
fs.writeFileSync(path.join(made, "src/lib/logic.test.ts"), "import { loadScores } from '../engine/scores';\nvi.spyOn(loadScores, 'loadScores');\n");
const madeHint = await AutoFix.engineMadeValues(
  made,
  "src/lib/logic.test.ts(2,28): error TS2345: Argument of type '\"loadScores\"' is not assignable to parameter of type 'never'.\nsrc/App.tsx(12,42): error TS2345: Argument of type '{ name: string; }' is not assignable to parameter of type 'Hero | (() => Hero)'.\n  Type '{ name: string; }' is missing the following properties from type 'Hero': x\n"
);
assert.match(madeHint, /Do not spy on or mock the engine's functions/, madeHint);
assert.match(madeHint, /A whole Hero comes from the engine: newGame\(DEFAULT_SETTINGS\)\.hero/, madeHint);
assert.equal(await AutoFix.engineMadeValues(made, "src/a.ts(1,1): error TS2304: Cannot find name 'x'.\n"), "", "no hint without the pattern");

// Fields a type cannot hold are dropped; a test's object a field short is filled in.
const extra = fs.mkdtempSync(path.join(os.tmpdir(), "ab-extra-"));
fs.mkdirSync(path.join(extra, "src"));
fs.writeFileSync(path.join(extra, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, target: "ES2020", module: "ESNext", moduleResolution: "Bundler", noEmit: true, lib: ["ES2020"] }, include: ["src"] }));
fs.writeFileSync(
  path.join(extra, "src/game.ts"),
  [
    'export interface Battle { name: string; hp: number; xp: number; gold: number; boss: boolean; kind: "slime" | "orc"; log: string[] }',
    "export interface GameState { score: number; battle: Battle | null }",
    "export function addScore(entry: { name: string; score: number }): number { return entry.score; }",
    "export function lose(state: GameState, scores: number[]): GameState {",
    "  addScore({ name: 'Ana', score: 3, at: 'now' });",
    "  return { ...state, scores, place: 1 };",
    "}",
    ""
  ].join("\n")
);
fs.writeFileSync(path.join(extra, "src/game.test.ts"), "import type { GameState } from './game';\nexport const state: GameState = { score: 0, battle: { name: 'Slime', hp: 3, boss: false } };\n");
const extraNotes = TypeFixer.run(extra);
const extraGame = fs.readFileSync(path.join(extra, "src/game.ts"), "utf8");
assert.match(extraGame, /addScore\(\{ name: 'Ana', score: 3 \}\)/, extraGame);
assert.match(extraGame, /return \{ \.\.\.state \};/, extraGame);
assert.match(fs.readFileSync(path.join(extra, "src/game.test.ts"), "utf8"), /boss: false, xp: 0, gold: 0, kind: "slime", log: \[\] \}/);
assert.ok(extraNotes.some((note) => /dropped scores/.test(note)) && extraNotes.some((note) => /missing xp, gold, kind, log/.test(note)), extraNotes.join(" | "));
assert.deepEqual(TypeFixer.run(extra), [], "nothing left to fix");

// A test's settings missing a non-plain field start from the engine's defaults;
// a copy of a value that may be null keeps the null.
const nulls = fs.mkdtempSync(path.join(os.tmpdir(), "ab-nulls-"));
fs.mkdirSync(path.join(nulls, "src", "engine"), { recursive: true });
fs.writeFileSync(path.join(nulls, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, target: "ES2020", module: "ESNext", moduleResolution: "Bundler", noEmit: true, lib: ["ES2020"] }, include: ["src"] }));
fs.writeFileSync(
  path.join(nulls, "src/engine/game.ts"),
  [
    "export interface GameSettings { potionHeal: number; colors: { wall: string } }",
    "export const DEFAULT_SETTINGS: GameSettings = { potionHeal: 20, colors: { wall: '#000' } };",
    "export interface Battle { name: string; hp: number }",
    "export interface GameState { settings: GameSettings; battle: Battle | null }",
    ""
  ].join("\n")
);
fs.writeFileSync(path.join(nulls, "src/logic.ts"), "import type { GameState } from './engine/game';\nexport function hit(state: GameState): GameState {\n  let battle = { ...state.battle };\n  if (battle.hp! <= 0) battle = null;\n  return { ...state, battle: battle };\n}\n");
fs.writeFileSync(path.join(nulls, "src/logic.test.ts"), "import type { GameState } from './engine/game';\nexport const state: GameState = { settings: { potionHeal: 5 }, battle: null };\n");
const nullNotes = TypeFixer.run(nulls);
assert.match(fs.readFileSync(path.join(nulls, "src/logic.ts"), "utf8"), /let battle = state\.battle \? \{ \.\.\.state\.battle \} : null;/, nullNotes.join(" | "));
const nullTest = fs.readFileSync(path.join(nulls, "src/logic.test.ts"), "utf8");
assert.match(nullTest, /settings: \{ \.\.\.DEFAULT_SETTINGS, potionHeal: 5 \}/, nullTest);
assert.match(nullTest, /^import \{ DEFAULT_SETTINGS \} from "\.\/engine\/game";/, nullTest);
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-settings-"));
fs.cpSync(path.join(nulls, "src", "engine"), path.join(settingsDir, "src", "engine"), { recursive: true });
fs.copyFileSync(path.join(nulls, "tsconfig.json"), path.join(settingsDir, "tsconfig.json"));
fs.writeFileSync(path.join(settingsDir, "src/settings.test.ts"), "import type { GameSettings } from './engine/game';\nexport const settings: GameSettings = { potionHeal: 5 };\n");
TypeFixer.run(settingsDir);
assert.match(fs.readFileSync(path.join(settingsDir, "src/settings.test.ts"), "utf8"), /settings: GameSettings = \{ \.\.\.DEFAULT_SETTINGS, potionHeal: 5 \}/, "a test's settings variable starts from the defaults too");
assert.deepEqual(TypeFixer.run(nulls), [], "nothing left to fix");

// A test's hero copied from the settings inside the state being declared: it
// starts from newGame(DEFAULT_SETTINGS).hero and the self-reference goes.
const selfRef = fs.mkdtempSync(path.join(os.tmpdir(), "ab-self-"));
fs.mkdirSync(path.join(selfRef, "src", "engine"), { recursive: true });
fs.writeFileSync(path.join(selfRef, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, target: "ES2020", module: "ESNext", moduleResolution: "Bundler", noEmit: true, lib: ["ES2020"] }, include: ["src"] }));
fs.writeFileSync(
  path.join(selfRef, "src/engine/game.ts"),
  [
    "export interface HeroSettings { name: string; hp: number }",
    "export interface GameSettings { hero: HeroSettings }",
    "export const DEFAULT_SETTINGS: GameSettings = { hero: { name: 'Hero', hp: 30 } };",
    "export interface Hero { name: string; hp: number; x: number; y: number; level: number; xp: number; gold: number; maxHp: number }",
    "export interface GameState { settings: GameSettings; hero: Hero }",
    "export function newGame(settings: GameSettings): GameState {",
    "  return { settings, hero: { ...settings.hero, x: 1, y: 1, level: 1, xp: 0, gold: 0, maxHp: settings.hero.hp } };",
    "}",
    ""
  ].join("\n")
);
fs.writeFileSync(path.join(selfRef, "src/logic.test.ts"), "import { DEFAULT_SETTINGS, type GameState } from './engine/game';\nexport const state: GameState = { settings: DEFAULT_SETTINGS, hero: { ...state.settings.hero } };\n");
const selfNotes = TypeFixer.run(selfRef);
const selfTest = fs.readFileSync(path.join(selfRef, "src/logic.test.ts"), "utf8");
assert.match(selfTest, /hero: \{ \.\.\.newGame\(DEFAULT_SETTINGS\)\.hero \}/, `${selfTest}\n${selfNotes.join(" | ")}`);
assert.match(selfTest, /import \{ newGame \} from "\.\/engine\/game";/, selfTest);
assert.deepEqual(TypeFixer.run(selfRef), [], "nothing left to fix");

// A component named like the type it imports: the import becomes type-only.
const typeClash = fs.mkdtempSync(path.join(os.tmpdir(), "ab-typeClash-"));
fs.mkdirSync(path.join(typeClash, "src", "engine"), { recursive: true });
fs.writeFileSync(path.join(typeClash, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, target: "ES2020", module: "ESNext", moduleResolution: "Bundler", noEmit: true, isolatedModules: true, lib: ["ES2020"] }, include: ["src"] }));
fs.writeFileSync(path.join(typeClash, "src/engine/scores.ts"), "export interface ScoreEntry { name: string; score: number }\n");
fs.writeFileSync(path.join(typeClash, "src/ScoreEntry.ts"), "import { ScoreEntry } from './engine/scores';\nconst ScoreEntry = (entry: ScoreEntry): string => entry.name;\nexport default ScoreEntry;\n");
const typeClashNotes = TypeFixer.run(typeClash);
assert.match(fs.readFileSync(path.join(typeClash, "src/ScoreEntry.ts"), "utf8"), /^import \{ type ScoreEntry \} from '\.\/engine\/scores';/, typeClashNotes.join(" | "));
assert.deepEqual(TypeFixer.run(typeClash), [], "nothing left to fix");

// `Screen.Game` where our Screen is a list of words and the browser also has a Screen;
// a test's on-purpose wrong word is cast.
const domClash = fs.mkdtempSync(path.join(os.tmpdir(), "ab-domclash-"));
fs.mkdirSync(path.join(domClash, "src", "lib"), { recursive: true });
fs.writeFileSync(path.join(domClash, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, target: "ES2020", module: "ESNext", moduleResolution: "Bundler", noEmit: true, isolatedModules: true, lib: ["ES2020", "DOM"] }, include: ["src"] }));
fs.writeFileSync(path.join(domClash, "src/lib/navigation.ts"), 'export type Screen = "Title" | "Game" | "HallOfHeroes";\nexport function navigateTo(screen: Screen): Screen { return screen; }\n');
fs.writeFileSync(path.join(domClash, "src/App.ts"), "import { navigateTo, Screen } from './lib/navigation';\nexport const a = navigateTo(Screen.Game);\nexport const b: Screen = Screen.HallOfHeroes;\n");
fs.writeFileSync(path.join(domClash, "src/lib/navigation.test.ts"), "import { navigateTo } from './navigation';\nexport const c = navigateTo('Unknown');\n");
const domNotes = TypeFixer.run(domClash);
const domApp = fs.readFileSync(path.join(domClash, "src/App.ts"), "utf8");
assert.match(domApp, /import \{ navigateTo, type Screen \} from '\.\/lib\/navigation';/, domNotes.join(" | "));
assert.match(domApp, /navigateTo\("Game"\)/, domApp);
assert.match(domApp, /const b: Screen = "HallOfHeroes";/, domApp);
assert.match(fs.readFileSync(path.join(domClash, "src/lib/navigation.test.ts"), "utf8"), /navigateTo\(\('Unknown' as never\)\)/);
assert.deepEqual(TypeFixer.run(domClash), [], "nothing left to fix");

// Screens kept in a type that means something else get named, with the fix.
const screens = fs.mkdtempSync(path.join(os.tmpdir(), "ab-screens-"));
fs.mkdirSync(path.join(screens, "src", "engine"), { recursive: true });
fs.writeFileSync(path.join(screens, "src/engine/game.ts"), 'export type Status = "ready" | "playing" | "won" | "lost";\n');
const screenHint = await AutoFix.literalsOutsideUnion(
  screens,
  "src/App.tsx(23,8): error TS2367: This comparison appears to be unintentional because the types 'Status' and '\"home\"' have no overlap.\nsrc/Menu.tsx(9,26): error TS2322: Type '\"game\"' is not assignable to type 'Status'.\n"
);
assert.match(screenHint, /Status \(in src\/engine\/game\.ts\) can only be "ready" \| "playing" \| "won" \| "lost"/);
assert.match(screenHint, /useState<"home" \| "game">\("home"\)/, screenHint);
assert.equal(await AutoFix.literalsOutsideUnion(screens, "src/a.ts(1,1): error TS2304: Cannot find name 'x'."), "", "no hint without the pattern");

// Props a component from src/engine/ does not take are removed where it is rendered; the app's own components are left alone.
const boardProps = fs.mkdtempSync(path.join(os.tmpdir(), "ab-boardprops-"));
fs.mkdirSync(path.join(boardProps, "src", "engine"), { recursive: true });
fs.mkdirSync(path.join(boardProps, "node_modules"));
fs.writeFileSync(path.join(boardProps, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, target: "ES2020", module: "ESNext", moduleResolution: "Bundler", jsx: "preserve", noEmit: true, lib: ["ES2020"] }, include: ["src"] }));
fs.writeFileSync(path.join(boardProps, "src/jsx.d.ts"), "declare namespace JSX { interface Element {} interface IntrinsicElements { [name: string]: unknown } interface ElementAttributesProperty { props: {} } }\n");
fs.writeFileSync(path.join(boardProps, "src/engine/play.tsx"), "export interface GameBoardProps { settings: number; onScore?: (s: number) => void }\nexport function GameBoard(props: GameBoardProps): JSX.Element { return <canvas />; }\n");
fs.writeFileSync(path.join(boardProps, "src/Own.tsx"), "export function Own(props: { a: number }): JSX.Element { return <div />; }\n");
fs.writeFileSync(path.join(boardProps, "src/Game.tsx"), "import { GameBoard } from './engine/play';\nimport { Own } from './Own';\nexport const Game = () => <div><GameBoard settings={1} onScore={() => {}} onWon={() => {}} onLost={() => {}} /><Own a={1} b={2} /></div>;\n");
TypeFixer.run(boardProps);
const gameScreen = fs.readFileSync(path.join(boardProps, "src/Game.tsx"), "utf8");
assert.match(gameScreen, /<GameBoard settings=\{1\} onScore=\{\(\) => \{\}\} \/>/, gameScreen);
assert.match(gameScreen, /<Own a=\{1\} b=\{2\} \/>/, "the app's own component keeps its props for the model to sort out");

// { width: 70, radius: 6 } where the type says w and r.
const shortKeys = fs.mkdtempSync(path.join(os.tmpdir(), "ab-short-"));
fs.mkdirSync(path.join(shortKeys, "src"));
fs.mkdirSync(path.join(shortKeys, "node_modules"));
fs.writeFileSync(path.join(shortKeys, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, target: "ES2020", module: "ESNext", moduleResolution: "Bundler", noEmit: true, lib: ["ES2020"] }, include: ["src"] }));
fs.writeFileSync(path.join(shortKeys, "src/a.test.ts"), "type Paddle = { x: number; y: number; w: number; h: number };\nexport const p: Paddle = { x: 1, y: 2, width: 70, height: 10 };\nexport const q: { name: string } = { name: 'a', title: 'b' } as never;\n");
TypeFixer.run(shortKeys);
assert.match(fs.readFileSync(path.join(shortKeys, "src/a.test.ts"), "utf8"), /\{ x: 1, y: 2, w: 70, h: 10 \}/);
assert.equal(TypeFixer.errorCount(shortKeys), 0);

// Saved data is cleared between tests, in the starter and in builds made before it was.
const setupDir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-setup-"));
fs.mkdirSync(path.join(setupDir, "src", "lib"), { recursive: true });
fs.writeFileSync(path.join(setupDir, "src/lib/setup-tests.ts"), 'import { cleanup } from "@testing-library/react";\nimport { afterEach } from "vitest";\n\nafterEach(() => cleanup());\n');
assert.equal((await AutoFix.clearStorageBetweenTests(setupDir)).length, 1);
assert.match(fs.readFileSync(path.join(setupDir, "src/lib/setup-tests.ts"), "utf8"), /cleanup\(\);\n  globalThis\.localStorage\?\.clear\(\);/);
assert.deepEqual(await AutoFix.clearStorageBetweenTests(setupDir), [], "once");
assert.match(fs.readFileSync(path.resolve("templates/starters/web/src/lib/setup-tests.ts"), "utf8"), /localStorage\?\.clear\(\)/, "the starter does it from the start");

// An empty stand-in for something the engine exports goes, and the real one is imported.
const standIn = fs.mkdtempSync(path.join(os.tmpdir(), "ab-standin-"));
fs.mkdirSync(path.join(standIn, "src", "engine"), { recursive: true });
fs.mkdirSync(path.join(standIn, "node_modules"));
fs.writeFileSync(path.join(standIn, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, target: "ES2020", module: "ESNext", moduleResolution: "Bundler", jsx: "preserve", noEmit: true, lib: ["ES2020"] }, include: ["src"] }));
fs.writeFileSync(path.join(standIn, "src/jsx.d.ts"), "declare namespace JSX { interface Element {} interface IntrinsicElements { [name: string]: unknown } interface ElementAttributesProperty { props: {} } }\n");
fs.writeFileSync(path.join(standIn, "src/engine/game.ts"), "export interface GameSettings { width: number; lives: number }\nexport const DEFAULT_SETTINGS: GameSettings = { width: 320, lives: 3 };\n");
fs.writeFileSync(path.join(standIn, "src/engine/play.tsx"), "import type { GameSettings } from './game';\nexport function GameBoard(props: { settings: GameSettings }): JSX.Element { return <canvas />; }\n");
fs.writeFileSync(
  path.join(standIn, "src/GameScreen.tsx"),
  "import { GameBoard } from './engine/play';\nexport const GameScreen = () => {\n  const DEFAULT_SETTINGS = { /* default settings from src/engine/game */ };\n  return <GameBoard settings={DEFAULT_SETTINGS} />;\n};\n"
);
TypeFixer.run(standIn);
const screenText = fs.readFileSync(path.join(standIn, "src/GameScreen.tsx"), "utf8");
assert.ok(!/const DEFAULT_SETTINGS = \{/.test(screenText), `the stand-in is gone: ${screenText}`);
assert.match(screenText, /import \{ DEFAULT_SETTINGS \} from ['"]\.\/engine\/game['"]/, "the real one is imported");
assert.equal(TypeFixer.errorCount(standIn), 0);
// A filled-in copy with half the engine constant's fields goes the same way.
fs.writeFileSync(path.join(standIn, "src/Other.tsx"), "import { GameBoard } from './engine/play';\nexport const Other = () => {\n  const DEFAULT_SETTINGS = { width: 800 };\n  return <GameBoard settings={DEFAULT_SETTINGS} />;\n};\n");
TypeFixer.run(standIn);
assert.ok(!/const DEFAULT_SETTINGS = \{ width/.test(fs.readFileSync(path.join(standIn, "src/Other.tsx"), "utf8")), "a partial copy of the engine's constant is replaced by the real one");
assert.equal(TypeFixer.errorCount(standIn), 0);

// Three a live RPG build carried for a pass: a default import of a named export,
// a list of words used as an enum, and a setting read from the state itself.
const rpgSlips = fs.mkdtempSync(path.join(os.tmpdir(), "ab-rpgslips-"));
fs.mkdirSync(path.join(rpgSlips, "src", "engine"), { recursive: true });
fs.mkdirSync(path.join(rpgSlips, "node_modules"));
fs.writeFileSync(path.join(rpgSlips, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, target: "ES2020", module: "ESNext", moduleResolution: "Bundler", noEmit: true, lib: ["ES2020"] }, include: ["src"] }));
fs.writeFileSync(
  path.join(rpgSlips, "src/engine/game.ts"),
  'export type Status = "exploring" | "battle" | "won-game";\nexport interface GameSettings { chestGold: number; potionHeal: number }\nexport interface GameState { status: Status; settings: GameSettings; gold: number }\nexport function GameBoard(): number { return 1; }\n'
);
fs.writeFileSync(
  path.join(rpgSlips, "src/use.ts"),
  "import GameBoard from './engine/game';\nimport { Status, type GameState } from './engine/game';\nexport const board = GameBoard();\nexport const next = (s: GameState): GameState => ({ ...s, status: Status.exploring, gold: s.gold + s.chestGold });\nexport const won: Status = Status.WonGame;\n"
);
const slipNotes = TypeFixer.run(rpgSlips);
const slipped = fs.readFileSync(path.join(rpgSlips, "src/use.ts"), "utf8");
assert.match(slipped, /^import \{ GameBoard \} from '\.\/engine\/game';/, slipNotes.join(" | "));
assert.match(slipped, /status: "exploring"/);
assert.match(slipped, /won: Status = "won-game"/, "matched without case or dashes");
assert.match(slipped, /s\.settings\.chestGold/);
assert.equal(TypeFixer.errorCount(rpgSlips), 0, slipped);

// An empty function is never merged into the engine.
assert.equal(CodeGuard.mergeEngineAdditions("src/engine/game.ts", "export const a = 1;\n", "export function stub(): number {\n  // later\n}\n"), null);

// "..." for "the rest" in a test is a syntax error; it becomes a partial match.
const dots = fs.mkdtempSync(path.join(os.tmpdir(), "ab-dots-"));
fs.mkdirSync(path.join(dots, "src", "lib"), { recursive: true });
fs.writeFileSync(
  path.join(dots, "src/lib/game.test.ts"),
  "it('starts', () => {\n  expect(s.ball).toEqual({ x: 160, vy: 0, ... });\n  expect(s.paddle).toEqual({ ...base, w: 70 });\n});\n"
);
fs.writeFileSync(path.join(dots, "src/lib/game.ts"), "export const rest = { ...{} };\n");
assert.equal((await AutoFix.fixPlaceholderEllipsis(dots)).length, 1);
const dotted = fs.readFileSync(path.join(dots, "src/lib/game.test.ts"), "utf8");
assert.match(dotted, /expect\(s\.ball\)\.toMatchObject\(\{ x: 160, vy: 0 \}\);/, `placeholder removed: ${dotted}`);
assert.match(dotted, /expect\(s\.paddle\)\.toEqual\(\{ \.\.\.base, w: 70 \}\);/, "a real spread is left alone");
assert.deepEqual(await AutoFix.fixPlaceholderEllipsis(dots), [], "nothing left to fix");

// Research about something else stays out of the brief the model reads.
const noisy = [
  "Build Pgame: a website.",
  "",
  "What it is for:",
  "A fun phone game with a progression system, saved in the browser.",
  "",
  "What our research confirmed (use where it applies):",
  "- Quantum annealing solves the core TCM task 16 times faster than simulated annealing. (https://arxiv.org/html/2511.15665v1)",
  "- Self-consistency fails on long-context tasks due to positional bias. (https://example.com/a)",
  "- Phone game players return for a visible progression system with short levels. (https://example.com/b)",
  "",
  "This project was started by an earlier build."
].join("\n");
const focused = dropUnrelatedResearch(noisy);
assert.ok(!/Quantum|Self-consistency/.test(focused), "unrelated findings go");
assert.match(focused, /What our research confirmed.*\n- Phone game players/, "a related one stays");
assert.match(focused, /This project was started by an earlier build\.$/, "what follows the section is kept");
assert.ok(!/research confirmed/.test(dropUnrelatedResearch(noisy.replace(/- Phone game.*\n/, ""))), "an emptied section goes");
assert.equal(dropUnrelatedResearch("A plain brief."), "A plain brief.");
// The same test for findings the build looks up itself: one shared word ("system") is not enough.
const gameFocus = "Pgame. A nice fun phone game webapp with a progression system. Mobile first, fast to load, works offline in the browser.";
assert.equal(relatedTo(gameFocus, "The limbic system plays a crucial role in emotional processing and motivation."), false);
assert.equal(relatedTo(gameFocus, "XAI techniques marketed for non-technical users may not be understandable by cyber analysts."), false);
assert.equal(relatedTo(gameFocus, "Using Vite's build configuration to split vendor chunks and target modern browsers makes pages load fast."), true);

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

// A local model server that is down is waited for; a real error is not retried.
const down = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
assert.equal(modelServerDown(down), true);
assert.equal(modelServerDown(new Error("Ollama request failed: 400 Bad Request - model not found")), false);
let calls = 0;
assert.equal(await ModelRouter.waitingOut(async () => { if (++calls < 3) throw down; return "ok"; }, 5_000, [10]), "ok");
assert.equal(calls, 3, "retried until the server answered");
calls = 0;
await assert.rejects(ModelRouter.waitingOut(async () => { calls++; throw new Error("bad prompt"); }, 5_000, [10]), /bad prompt/);
assert.equal(calls, 1, "a real error is not retried");
await assert.rejects(ModelRouter.waitingOut(async () => { throw down; }, 50, [10]), /fetch failed/, "gives up after the limit");

console.log("builder guards: all checks passed");
