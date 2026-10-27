/**
 * GameEvolutionStudio — the games Agent Builder has made, their live and staged
 * versions, and Game Checkups.
 *
 *   - The game list is what is really on disk: the web games in games/, the
 *     Unity levels UnityLevelStudio built, and any game registered with
 *     registerGame (a finished game build). Nothing is invented.
 *   - Safe version branching: a staged version is kept beside the live one
 *     until it is promoted ("Promote to Live") or dropped.
 *   - Game Checkup: the code model grades story, mechanics and audio/visual
 *     polish from the game's source. When the model does not answer in time
 *     the scorecard comes from what the source measurably contains, and says so.
 *   - Reports whether KingdomForge (GAMEMAKER_PATH) and a Unity editor are here.
 */
import fs from "fs";
import path from "path";

import { ModelRouter, getProviderForRole } from "../tools/ModelRouter.js";
import { detectUnity, levelProjectPath } from "../media/UnityLevelStudio.js";
import { Logger } from "../utils/Logger.js";

export interface GameCheckupScorecard {
  gameName: string;
  overallScore: number;
  /** "model": graded by the code model. "heuristic": measured from the source because the model did not answer. */
  assessedBy: "model" | "heuristic";
  note?: string;
  storyAndPlot: {
    score: number;
    loreFound: boolean;
    suggestions: string[];
  };
  gameplayAndMechanics: {
    score: number;
    varietyRating: string;
    powerupCount: number;
    bossVariety: string;
    suggestions: string[];
  };
  visualAndAudio: {
    score: number;
    has3D: boolean;
    hasVFX: boolean;
    hasProceduralAudio: boolean;
    suggestions: string[];
  };
  nextEvolutionPlan: {
    title: string;
    description: string;
    keyUpgrades: string[];
  };
}

export interface GameVersionBranch {
  gameId: string;
  name: string;
  engine: "web" | "unity";
  liveVersion: string;
  stagedVersion: string | null;
  /** Last checkup's overall score / 10; null until a checkup has run. */
  funRating: number | null;
  liveOutputDir: string;
  stagedOutputDir: string | null;
  previewImage?: string;
  history: Array<{
    version: string;
    date: string;
    summary: string;
    score: number | null;
  }>;
}

const GAMEMAKER_PATH = () => process.env.GAMEMAKER_PATH?.trim() || "E:\\Projects\\Gamemaker";
const GAMES_DB_PATH = () => path.resolve("data", "game-studio", "games.json");
/** Entries an earlier version seeded with invented names, versions and ratings. */
const INVENTED_SEEDS = new Set(["block-blaster-1980", "block-blaster-laser-grid", "block-blaster-boss-rush"]);
const SOURCE_EXT = /\.(html?|js|mjs|ts|tsx|jsx|cs|lua)$/i;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "Library", "Temp", "Logs", "obj", "Builds", "build", ".next"]);

const readDb = (): Record<string, GameVersionBranch> => {
  try {
    const data = JSON.parse(fs.readFileSync(GAMES_DB_PATH(), "utf8")) as Record<string, GameVersionBranch>;
    for (const id of INVENTED_SEEDS) delete data[id];
    return data;
  } catch {
    return {};
  }
};

const writeDb = (data: Record<string, GameVersionBranch>) => {
  fs.mkdirSync(path.dirname(GAMES_DB_PATH()), { recursive: true });
  fs.writeFileSync(GAMES_DB_PATH(), JSON.stringify(data, null, 2), "utf8");
};

const title = (id: string) => id.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** Source files of a game, largest-first within a character budget. */
const readSources = (root: string, budget = 24_000): { text: string; files: string[] } => {
  const found: Array<{ file: string; size: number }> = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 6 || found.length > 400) return;
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(full, depth + 1); }
      else if (SOURCE_EXT.test(entry.name) && !/\.(test|spec|d)\.[jt]sx?$/.test(entry.name)) {
        try { found.push({ file: full, size: fs.statSync(full).size }); } catch {}
      }
    }
  };
  if (fs.existsSync(root)) {
    if (fs.statSync(root).isFile()) found.push({ file: root, size: fs.statSync(root).size });
    else walk(root, 0);
  }
  found.sort((a, b) => b.size - a.size);
  let text = "";
  const files: string[] = [];
  for (const { file } of found) {
    if (text.length >= budget) break;
    try {
      const body = fs.readFileSync(file, "utf8");
      text += `\n// ==== ${path.relative(root, file) || path.basename(file)}\n${body.slice(0, Math.max(2000, budget - text.length))}`;
      files.push(file);
    } catch {}
  }
  return { text: text.slice(0, budget), files };
};

const count = (text: string, re: RegExp) => (text.match(re) ?? []).length;

export class GameEvolutionStudio {
  /** KingdomForge (the external game maker) and the Unity editor, as they are on this PC. */
  static checkGamemakerStatus() {
    const root = GAMEMAKER_PATH();
    const installed = fs.existsSync(path.join(root, "package.json"));
    const unity = detectUnity();
    return {
      installed,
      path: root,
      // KingdomForge's Unity bridge is its src/server/unityEngine.ts.
      hasUnityBridge: installed && fs.existsSync(path.join(root, "src", "server", "unityEngine.ts")),
      unityEditor: unity.installed ? { version: unity.version, exe: unity.exe, webgl: unity.webgl } : null,
      levelProject: levelProjectPath()
    };
  }

  /** Grades a game from its source. Waits up to CHECKUP_TIMEOUT_MS (55 s) for the model, so the request returns. */
  static async runGameCheckup(gameDir: string, gameNameHint?: string): Promise<GameCheckupScorecard> {
    const absPath = path.resolve(gameDir);
    const gameName = gameNameHint || title(path.basename(absPath));
    const { text: source, files } = readSources(absPath);
    if (!files.length) throw new Error(`No game source found in ${absPath}.`);
    const lower = source.toLowerCase();

    const signals = {
      threeD: /three|webgl|gltf|\bmesh\b|unityengine|terrain|camera\.main/.test(lower),
      particles: /particle|explosion|emitter|spark|trail/.test(lower),
      audio: /audiocontext|oscillator|new audio\(|audiosource|\.play\(\)/.test(lower),
      lore: /story|lore|dialog|narrat|cutscene|chapter|quest/.test(lower),
      boss: count(lower, /\bboss/g),
      levels: count(lower, /\blevel\b|\bwave\b|\bstage\b/g),
      powerups: count(lower, /power-?up|upgrade|pickup|bonus/g),
      enemies: count(lower, /enemy|enemies|hazard|monster/g),
      saves: /localstorage|playerprefs|highscore|high score|save/.test(lower),
      input: /keydown|keyup|touchstart|getaxis|keyboard\.current|gamepad/.test(lower)
    };

    const prompt = `You are a lead game director reviewing a game's source code.
Game: ${gameName}
Files: ${files.map((f) => path.relative(absPath, f) || path.basename(f)).join(", ")}

Source (truncated):
${source.slice(0, 14_000)}

Grade what is actually in this code — not what a game like it usually has. Scores are 0-100.
Answer with JSON only, in exactly this shape (the angle-bracket values are placeholders):
{
  "overallScore": <0-100>,
  "storyAndPlot": {"score": <0-100>, "loreFound": <bool>, "suggestions": ["<specific to this code>", "..."]},
  "gameplayAndMechanics": {"score": <0-100>, "varietyRating": "<few words>", "powerupCount": <number found in code>, "bossVariety": "<what the code has>", "suggestions": ["...", "..."]},
  "visualAndAudio": {"score": <0-100>, "has3D": <bool>, "hasVFX": <bool>, "hasProceduralAudio": <bool>, "suggestions": ["...", "..."]},
  "nextEvolutionPlan": {"title": "<name>", "description": "<one paragraph>", "keyUpgrades": ["<concrete change>", "<concrete change>", "<concrete change>"]}
}
JSON only:`;

    const limit = Number(process.env.CHECKUP_TIMEOUT_MS ?? 55_000);
    let note = "";
    try {
      const response = await Promise.race([
        ModelRouter.generateForRole("code", prompt),
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error(`no answer within ${Math.round(limit / 1000)} s`)), limit))
      ]);
      const json = /\{[\s\S]*\}/.exec(response)?.[0];
      if (json) {
        const parsed = JSON.parse(json) as Partial<GameCheckupScorecard>;
        if (parsed.storyAndPlot && parsed.gameplayAndMechanics && parsed.visualAndAudio && parsed.nextEvolutionPlan) {
          return { ...(parsed as GameCheckupScorecard), gameName, assessedBy: "model" };
        }
      }
      note = "The model's answer was not a usable scorecard.";
    } catch (error) {
      const { provider } = getProviderForRole("code");
      note = `The code model (${provider}) gave ${(error as Error)?.message ?? "no answer"}.`;
      Logger.warn("Game checkup fell back to the source heuristic", { error: (error as Error)?.message });
    }

    // Measured from the source: every number below comes from a count or a check above.
    const story = Math.min(100, 20 + (signals.lore ? 40 : 0) + Math.min(signals.levels, 10) * 2);
    const mechanics = Math.min(100, 25 + Math.min(signals.enemies, 15) * 2 + Math.min(signals.powerups, 10) * 3 + (signals.boss ? 10 : 0) + (signals.saves ? 5 : 0) + (signals.input ? 5 : 0));
    const polish = Math.min(100, 25 + (signals.threeD ? 25 : 0) + (signals.particles ? 20 : 0) + (signals.audio ? 20 : 0));
    const suggestions = {
      story: [!signals.lore && "There is no story text: add an intro and a reason to play", signals.levels < 3 && "Add level or wave progression with a visible goal"].filter(Boolean) as string[],
      mechanics: [signals.powerups === 0 && "No power-ups or pickups found", !signals.boss && "No boss encounter found", !signals.saves && "Nothing is saved: add a high score or progress save"].filter(Boolean) as string[],
      polish: [!signals.particles && "No particle effects found", !signals.audio && "No sound found", !signals.threeD && "Rendering is 2D; a Unity level (Game Maker → Unity Level Studio) can give it a 3D world"].filter(Boolean) as string[]
    };
    return {
      gameName,
      overallScore: Math.round((story + mechanics + polish) / 3),
      assessedBy: "heuristic",
      note: `${note} These scores are counted from the source (${files.length} file(s)), not judged.`,
      storyAndPlot: { score: story, loreFound: signals.lore, suggestions: suggestions.story },
      gameplayAndMechanics: {
        score: mechanics,
        varietyRating: `${signals.enemies} enemy references, ${signals.powerups} pickup/upgrade references`,
        powerupCount: signals.powerups,
        bossVariety: signals.boss ? `${signals.boss} boss references` : "none found",
        suggestions: suggestions.mechanics
      },
      visualAndAudio: { score: polish, has3D: signals.threeD, hasVFX: signals.particles, hasProceduralAudio: signals.audio, suggestions: suggestions.polish },
      nextEvolutionPlan: {
        title: "Fill the gaps the checkup found",
        description: "Run this checkup again with the model available for a judged plan; meanwhile these are the missing pieces the source shows.",
        keyUpgrades: [...suggestions.story, ...suggestions.mechanics, ...suggestions.polish].slice(0, 3)
      }
    };
  }

  /** Records a checkup's score on the game's live version. */
  static recordCheckup(gameId: string, scorecard: GameCheckupScorecard) {
    const data = readDb();
    const branch = data[gameId] ?? GameEvolutionStudio.listAllGames().find((g) => g.gameId === gameId);
    if (!branch) return;
    branch.funRating = Math.round(scorecard.overallScore) / 10;
    data[gameId] = branch;
    writeDb(data);
  }

  /** Adds or updates a game (a finished game build, a Unity level). */
  static registerGame(game: Omit<GameVersionBranch, "history" | "stagedVersion" | "stagedOutputDir" | "funRating"> & Partial<GameVersionBranch>) {
    const data = readDb();
    const fresh: Pick<GameVersionBranch, "stagedVersion" | "stagedOutputDir" | "funRating" | "history"> = {
      stagedVersion: null,
      stagedOutputDir: null,
      funRating: null,
      history: []
    };
    data[game.gameId] = { ...fresh, ...data[game.gameId], ...game };
    writeDb(data);
    return data[game.gameId];
  }

  /** Stages a new version beside the live one, to be promoted or dropped later. */
  static stageVersion(gameId: string, version: string, outputDir: string) {
    const data = readDb();
    const branch = data[gameId];
    if (!branch) throw new Error(`Unknown game ${gameId}.`);
    branch.stagedVersion = version;
    branch.stagedOutputDir = outputDir;
    writeDb(data);
    return branch;
  }

  /** Promotes the staged version to live; the old live version goes into history. */
  static promoteStagedToLive(gameId: string): { success: boolean; liveVersion: string; message: string } {
    const data = readDb();
    const branch = data[gameId] ?? GameEvolutionStudio.listAllGames().find((g) => g.gameId === gameId);
    if (!branch || !branch.stagedVersion || !branch.stagedOutputDir) {
      return { success: false, liveVersion: branch?.liveVersion || "1.0.0", message: "No staged version to promote." };
    }
    branch.history.push({
      version: branch.liveVersion,
      date: new Date().toISOString(),
      summary: `Replaced by ${branch.stagedVersion}`,
      score: branch.funRating === null ? null : Math.round(branch.funRating * 10)
    });
    branch.liveVersion = branch.stagedVersion;
    branch.liveOutputDir = branch.stagedOutputDir;
    branch.stagedVersion = null;
    branch.stagedOutputDir = null;
    branch.funRating = null; // the new live version has not been checked yet
    data[gameId] = branch;
    writeDb(data);
    Logger.log(`Promoted game '${branch.name}' to live version ${branch.liveVersion}`);
    return { success: true, liveVersion: branch.liveVersion, message: `Version ${branch.liveVersion} is now live.` };
  }

  static getGameBranch(gameId: string): GameVersionBranch | null {
    return GameEvolutionStudio.listAllGames().find((g) => g.gameId === gameId) ?? null;
  }

  /** Registered games plus the web games found in games/ (not yet registered). */
  static listAllGames(): GameVersionBranch[] {
    const data = readDb();
    const gamesDir = path.resolve("games");
    try {
      for (const entry of fs.readdirSync(gamesDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || !fs.existsSync(path.join(gamesDir, entry.name, "index.html"))) continue;
        const gameId = `web-${entry.name}`;
        if (data[gameId]) continue;
        data[gameId] = {
          gameId,
          name: title(entry.name),
          engine: "web",
          liveVersion: "1.0.0",
          stagedVersion: null,
          funRating: null,
          liveOutputDir: path.join("games", entry.name),
          stagedOutputDir: null,
          history: []
        };
      }
    } catch {}
    return Object.values(data).sort((a, b) => a.name.localeCompare(b.name));
  }
}
