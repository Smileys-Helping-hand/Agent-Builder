/**
 * ProjectSnapshot — what the model is shown of an existing project so it can
 * change it rather than start again: the file tree, then the files most likely
 * to matter, within a budget a local model can take.
 *
 * Secrets never go in: .env files, keys and certificates are listed in the
 * tree (so the model knows they exist) but their contents are not.
 */
import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";

const run = promisify(execFile);

const TREE_LIMIT = 400;
const DEFAULT_BUDGET = 24_000;
const MAX_FILE_CHARS = 12_000;

const SECRET = /(^|\/)(\.env(\..*)?|.*\.(pem|key|p12|pfx|keystore|jks)|id_rsa.*|credentials.*|secrets?\..*|service-account.*\.json)$/i;
const SKIP_CONTENT = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|.*\.min\.(js|css)|.*\.map)$/i;
const BINARY = /\.(png|jpe?g|gif|webp|ico|bmp|svg|mp3|mp4|wav|ogg|webm|pdf|zip|gz|tar|7z|exe|dll|so|dylib|woff2?|ttf|otf|eot|db|sqlite|bin|apk|aab|jar|class)$/i;

/** Files read first, because they say what the project is and how it runs. */
const FIRST = [/^readme(\.md)?$/i, /^claude\.md$/i, /^package\.json$/, /^tsconfig\.json$/, /^(next|vite|astro|nuxt)\.config\.\w+$/, /^requirements\.txt$/, /^pyproject\.toml$/];

const listFiles = async (root: string): Promise<string[]> => {
  try {
    const { stdout } = await run("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
      cwd: root,
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024
    });
    return stdout.split("\0").filter(Boolean);
  } catch {
    return [];
  }
};

export const ProjectSnapshot = {
  /**
   * @param focus the instruction, so files whose names it mentions are shown first
   */
  async describe(root: string, focus: string, budget = DEFAULT_BUDGET): Promise<string> {
    const files = (await listFiles(root)).sort();
    const tree =
      files.slice(0, TREE_LIMIT).join("\n") + (files.length > TREE_LIMIT ? `\n… and ${files.length - TREE_LIMIT} more files` : "");

    const words = new Set(
      focus
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length > 3)
    );
    const score = (file: string): number => {
      const base = path.basename(file);
      if (FIRST.some((pattern) => pattern.test(base)) && !file.includes("/")) return 1000;
      const name = file.toLowerCase();
      let hits = 0;
      for (const word of words) if (name.includes(word)) hits += 1;
      // Source over everything else; shallow over deep.
      const source = /\.(tsx?|jsx?|mjs|cjs|py|vue|svelte|astro|css|scss|html|json|md)$/i.test(file) ? 5 : 0;
      return hits * 50 + source - file.split("/").length;
    };

    const readable = files.filter((file) => !SECRET.test(file) && !SKIP_CONTENT.test(file) && !BINARY.test(file));
    const ranked = readable.sort((a, b) => score(b) - score(a));

    let used = 0;
    const shown: string[] = [];
    for (const file of ranked) {
      if (used >= budget) break;
      let content: string;
      try {
        const stat = fs.statSync(path.join(root, file));
        if (stat.size > MAX_FILE_CHARS * 2) continue;
        content = fs.readFileSync(path.join(root, file), "utf8");
      } catch {
        continue;
      }
      if (content.includes("\u0000")) continue;
      const body = content.length > MAX_FILE_CHARS ? `${content.slice(0, MAX_FILE_CHARS)}\n…(truncated)` : content;
      if (used + body.length > budget && shown.length > 0) continue;
      shown.push(`FILE: ${file}\n\`\`\`\n${body}\n\`\`\``);
      used += body.length;
    }

    return `All files in the project:\n${tree}\n\nThe contents of the ones most likely to matter:\n\n${shown.join("\n\n")}`;
  },

  /** Paths from an error message that exist in the project, for a repair to look at. */
  mentionedFiles(root: string, text: string, limit = 3): Record<string, string> {
    const found: Record<string, string> = {};
    const candidates = text.match(/[\w@./-]+\.(tsx?|jsx?|mjs|cjs|py|vue|svelte|json|css)/g) ?? [];
    for (const candidate of candidates) {
      if (Object.keys(found).length >= limit) break;
      const rel = candidate.replace(/^\.?\/+/, "").replace(/\\/g, "/");
      const full = path.resolve(root, rel);
      if (!full.startsWith(path.resolve(root) + path.sep) || SECRET.test(rel) || found[rel]) continue;
      try {
        if (fs.statSync(full).size <= MAX_FILE_CHARS) found[rel] = fs.readFileSync(full, "utf8");
      } catch {
        // Not a file in this project.
      }
    }
    return found;
  }
};
