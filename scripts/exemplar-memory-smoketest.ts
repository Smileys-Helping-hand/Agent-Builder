/**
 * Smoke test for ExemplarMemory: seeding from the catalogue's engines, finding
 * the closest worked example for a brief, remembering a successful build, and
 * retiring an example that keeps not helping. Uses a throwaway database.
 *
 *   npm run test:exemplars
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ab-exemplars-"));
process.env.KNOWLEDGE_DB_PATH = path.join(tmp, "knowledge.db");

const { ExemplarMemory } = await import("../src/learning/ExemplarMemory.js");

// The catalogue's self-contained engines become the first examples; kit-bound code does not.
const seeded = ExemplarMemory.seedFromTemplates(path.resolve("templates/sites"));
assert.ok(seeded >= 5, `seeded ${seeded} catalogue engines`);
const titles = ExemplarMemory.list().map((e) => e.title);
assert.ok(titles.includes("Arcade Promo Game"), "the game engine is an example");
assert.ok(ExemplarMemory.list().every((e) => !/from\s+["']\.\/lib/.test(e.sample)), "no example teaches the template kit's imports");
assert.equal(ExemplarMemory.seedFromTemplates(path.resolve("templates/sites")), seeded, "seeding again updates, never duplicates");
assert.equal(ExemplarMemory.list().length, titles.length);

// A game brief finds the game engine; a booking brief finds the slots engine.
const game = ExemplarMemory.relevant("Build Pgame: a website.\nA nice fun phone game with levels, score and a progression system.");
assert.equal(game?.title, "Arcade Promo Game");
assert.match(game!.sample, /FILE: src\/game\.ts/);
assert.ok(game!.sample.length <= 7_000, "the example fits a prompt");
const booking = ExemplarMemory.relevant("Barbershop bookings: customers pick a service and its price, a barber, a date and an available slot, then get a booking confirmation.");
assert.ok(booking && /book/i.test(`${booking.title} ${booking.brief}`), `booking brief found ${booking?.title}`);
assert.equal(ExemplarMemory.relevant("Quarterly tax filing for a shipping fleet with customs declarations"), null, "nothing close: no example");

// Real briefs from the prompt builder: fifty words of look, feel and quality bar must not drown the one that matters.
const pgameBrief = `Build Pgame: a website.

What it is for:
A nice fun phone game webapp to easily play anywhere anytime. Nice easy brain dead fun to keep me entertained with progression system

Who uses it:
Mobile users

Pages / screens:
- Home,Menu, save, load, game

It must have:
- Progression

Look and feel:
- Bold and colourful, Playful, Earthy and warm

Data and integrations:
- No accounts needed
- Save in the browser (localStorage)

Quality bar:
- Mobile first
- Fast to load
- Clear empty and error states
- Works offline`;
assert.equal(ExemplarMemory.relevant(pgameBrief)?.title, "Arcade Promo Game", "the real Pgame brief finds the game engine, not the restaurant's Menu");

// Each kind of game goes to the engine (and playable board) built for it.
for (const [brief, title] of [
  ["Build Star Raid: a space shooter where you blast waves of alien invaders", "Space Shooter Game"],
  ["Build Zombie Siege: an action game where you shoot zombies", "Space Shooter Game"],
  ["Build Blaster: a fun arcade shooting game for my shop", "Space Shooter Game"],
  ["Build Keep Guard: a tower defense game", "Tower Defense Strategy Game"],
  ["Build Kingdoms: a strategy game where you defend your castle", "Tower Defense Strategy Game"],
  ["Build Dungeon Quest: an RPG with a hero and monsters", "Fantasy RPG Adventure"],
  ["Build Hero's Journey: an adventure game with battles and levelling up", "Fantasy RPG Adventure"],
  ["Build Brick Bash: a brick breaker game", "Arcade Promo Game"]
] as const) {
  assert.equal(ExemplarMemory.relevant(brief)?.title, title, brief);
}
for (const genre of ["Space Shooter Game", "Tower Defense Strategy Game", "Fantasy RPG Adventure"]) {
  const seed = ExemplarMemory.list().find((e) => e.title === genre)!;
  assert.deepEqual(Object.keys(ExemplarMemory.engineFiles(seed, path.resolve("templates/sites"))).sort(), ["src/game.ts", "src/play.tsx", "src/scores.ts"], `${genre} brings its engine, its board and its score table`);
  const note = ExemplarMemory.formatForPrompt(seed, ["src/engine/game.ts", "src/engine/play.tsx", "src/engine/scores.ts"]);
  assert.match(note, /The game screen MUST render it, e\.g\. <GameBoard settings=\{DEFAULT_SETTINGS\}/);
  assert.match(note, /use addScore\(\{ name, score, detail \}\) and loadScores\(\) from "\.\/engine\/scores"/, note);
  assert.match(note, /Never store the player, hero or game state as a score entry/);
  assert.match(note, /getByRole\("region", \{ name: "Game Board" \}\)/);
}

// Our own catalogue engine is never retired: runs cut short are not its failures.
const arcade = ExemplarMemory.relevant(pgameBrief)!;
assert.equal(arcade.title, "Arcade Promo Game");
for (let i = 0; i < 6; i += 1) ExemplarMemory.markUsed(arcade.id);
assert.equal(ExemplarMemory.relevant(pgameBrief)?.title, "Arcade Promo Game", "the game engine is still offered after runs that never passed");
const salonBrief = `Build Fade & Co bookings: a web app.

What it is for:
Let customers of the Fade & Co barbershop book a cut online in under a minute, and let the owner see and cancel today's bookings.

Pages / screens:
- Book
- Today's bookings (admin)

It must have:
- Pick a service: cut R150, cut and beard R220, colour R450
- Confirmation with a booking reference`;
assert.equal(ExemplarMemory.relevant(salonBrief)?.title, "Booking & Scheduling");
assert.equal(ExemplarMemory.relevant("Build Notes: a web app.\n\nPages / screens:\n- Home\n- Menu\n"), null, "a screen called Menu is not a restaurant");

// A build that passed is remembered and preferred for the next similar brief.
const app = path.join(tmp, "app");
fs.mkdirSync(path.join(app, "src", "lib"), { recursive: true });
fs.writeFileSync(path.join(app, "src", "levels.ts"), "export interface Level { n: number }\nexport const nextLevel = (l: Level): Level => ({ n: l.n + 1 });\n");
fs.writeFileSync(path.join(app, "src", "App.tsx"), "import { nextLevel } from './levels';\nexport default function App() { return <main>Phone game</main>; }\n");
fs.writeFileSync(path.join(app, "src", "App.test.tsx"), "it('x', () => {});\n");
fs.writeFileSync(path.join(app, "src", "lib", "testing.tsx"), "export const kit = 1;\n");
const id = ExemplarMemory.recordSuccess(app, "Pocket Levels", "A fun phone game with levels, score and progression, saved in the browser.", 100);
assert.ok(id);
const remembered = ExemplarMemory.list().find((e) => e.id === id)!;
assert.match(remembered.outline, /src\/levels\.ts .*exports nextLevel, Level/, "values and functions first, then types");
assert.ok(!/App\.test|lib\/testing/.test(remembered.sample), "tests and kit are not part of the example");
assert.ok(remembered.sample.indexOf("levels.ts") < remembered.sample.indexOf("App.tsx"), "logic first: it is what small models leave out");
// Where the catalogue has tested code for this kind of app, that wins: it goes into the project whole.
assert.equal(ExemplarMemory.relevant("A fun phone game with levels and progression")?.title, "Arcade Promo Game", "the catalogue engine beats a remembered game");

// A remembered build teaches the kinds of app the catalogue does not have.
const planner = path.join(tmp, "planner");
fs.mkdirSync(path.join(planner, "src"), { recursive: true });
fs.writeFileSync(path.join(planner, "src", "pantry.ts"), "export interface Item { name: string; qty: number }\nexport const lowStock = (items: Item[]): Item[] => items.filter((i) => i.qty < 2);\n");
fs.writeFileSync(path.join(planner, "src", "App.tsx"), "import { lowStock } from './pantry';\nexport default function App() { return <main>Pantry</main>; }\n");
const plannerId = ExemplarMemory.recordSuccess(planner, "Pantry Planner", "A weekly meal planner with pantry stock tracking and shopping lists, saved in the browser.", 100);
const plannerBrief = "A meal planner that tracks pantry stock and builds a shopping list";
assert.equal(ExemplarMemory.relevant(plannerBrief)?.id, plannerId, "nothing in the catalogue fits, so the remembered build is followed");

// An example that keeps not helping stops being shown.
for (let i = 0; i < 5; i += 1) ExemplarMemory.markUsed(plannerId!);
assert.notEqual(ExemplarMemory.relevant(plannerBrief)?.id, plannerId, "retired after repeated failures");
ExemplarMemory.recordOutcome(plannerId!, true);
ExemplarMemory.recordOutcome(plannerId!, true);
assert.equal(ExemplarMemory.relevant(plannerBrief)?.id, plannerId, "back once builds that follow it pass");

assert.match(ExemplarMemory.formatForPrompt(game!), /Do NOT copy its names, content or theme/);

// A catalogue engine can go into the new app whole; an app this builder made cannot.
const engine = ExemplarMemory.engineFiles(game!, path.resolve("templates/sites"));
// The rules and the screen that plays them: a game, not just its engine.
assert.deepEqual(Object.keys(engine).sort(), ["src/game.ts", "src/play.tsx", "src/scores.ts"]);
assert.equal(engine["src/game.ts"], fs.readFileSync(path.resolve("templates/sites/game/src/game.ts"), "utf8"), "the whole file, not the cut sample");
assert.match(engine["src/play.tsx"], /export function GameBoard/);
assert.deepEqual(ExemplarMemory.engineFiles(remembered, path.resolve("templates/sites")), {});
const adoptedNote = ExemplarMemory.formatForPrompt(game!, ["src/engine/game.ts", "src/engine/play.tsx"]);
assert.match(adoptedNote, /Already in your project.*src\/engine\/game\.ts/s);
assert.match(adoptedNote, /import from \.\/engine\/game, \.\/engine\/play/);
assert.match(adoptedNote, /The game screen MUST render it, e\.g\. <GameBoard settings=\{DEFAULT_SETTINGS\}/, adoptedNote);
assert.ok(!/GameBoardProps from/.test(adoptedNote), "a props type is not a component");
assert.ok(!/High scores, leaderboards/.test(adoptedNote), "no score note when the score table was not adopted");
assert.ok(!adoptedNote.includes("FILE: src/game.ts"), "the engine is in the project: no need to repeat it in the prompt");

console.log("exemplar memory: all checks passed");
