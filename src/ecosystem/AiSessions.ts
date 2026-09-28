/**
 * AiSessions — what Claude and Gemini have been doing on this machine.
 *
 * Both assistants leave a trail on disk, and reading it is what lets the app
 * (or a fresh agent) carry on rather than start cold:
 *
 *   - Claude Code writes a JSONL transcript per session under
 *     ~/.claude/projects/<encoded path>/<session>.jsonl, including the working
 *     directory, a title, and the prompt that started it.
 *   - Gemini's Antigravity keeps a config per project (name, folder, when it was
 *     last touched, the commands you approved) plus a "brain" directory per
 *     session holding an implementation plan and a walkthrough, each with a
 *     written summary.
 *
 * Read-only, and deliberately cheap: transcripts run to hundreds of megabytes,
 * so only the head and tail of each file are parsed, and results are cached
 * until the file changes.
 */
import fs from "fs";
import os from "os";
import path from "path";

import { EcosystemStore } from "./EcosystemStore.js";

export type AiSource = "claude" | "gemini";

export interface AiSession {
  source: AiSource;
  id: string;
  title: string;
  summary: string | null;
  projectPath: string | null;
  projectId: string | null;
  updatedAt: string;
  messages?: number;
  artifacts?: string[];
}

const CLAUDE_ROOT = path.join(os.homedir(), ".claude", "projects");
const GEMINI_ROOT = path.join(os.homedir(), ".gemini");
const HEAD_BYTES = 256 * 1024;
const TAIL_BYTES = 128 * 1024;

const cache = new Map<string, { mtimeMs: number; session: AiSession }>();

/** Cleared when the project registry changes, since matching depends on it. */
export const clearSessionCache = (): void => cache.clear();

/** Read a slice of a file without pulling a 300 MB transcript into memory. */
const readSlice = (file: string, bytes: number, fromEnd = false): string => {
  try {
    const { size } = fs.statSync(file);
    const length = Math.min(bytes, size);
    const position = fromEnd ? Math.max(0, size - length) : 0;
    const handle = fs.openSync(file, "r");
    try {
      const buffer = Buffer.alloc(length);
      fs.readSync(handle, buffer, 0, length, position);
      return buffer.toString("utf8");
    } finally {
      fs.closeSync(handle);
    }
  } catch {
    return "";
  }
};

const textOf = (content: unknown): string | null => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const block = content.find((item) => item && typeof item === "object" && (item as { type?: string }).type === "text");
    const text = (block as { text?: string } | undefined)?.text;
    return typeof text === "string" ? text : null;
  }
  return null;
};

const tidy = (text: string | null | undefined, limit = 220): string | null => {
  if (!text) return null;
  const clean = text.replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, limit) : null;
};

const isWordCharacter = (character: string | undefined): boolean =>
  character !== undefined && /[a-z0-9]/i.test(character);

/**
 * Whole-word substring search that never builds a pattern out of a project
 * name. Names carry dots and dashes ("next.js", "side-hustle"), and escaping
 * those into a regular expression is a step worth avoiding entirely.
 */
const containsWord = (haystack: string, needle: string): boolean => {
  if (!needle) return false;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    const before = index > 0 ? haystack[index - 1] : undefined;
    const after = haystack[index + needle.length];
    if (!isWordCharacter(before) && !isWordCharacter(after)) return true;
    index = haystack.indexOf(needle, index + 1);
  }
  return false;
};

const projectIdForPath = (target: string | null): string | null => {
  if (!target) return null;
  const normalised = target.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  for (const project of EcosystemStore.listProjects()) {
    const projectPath = project.path.replace(/\\/g, "/").toLowerCase();
    if (normalised === projectPath || normalised.startsWith(`${projectPath}/`)) return project.id;
  }
  return null;
};

/**
 * Which project a session belongs to, judged from its text.
 *
 * The working directory alone is not enough: sessions are usually started from
 * a parent folder (H:/ts) while the actual project is named in the opening
 * prompt — as a path, a GitHub URL, or simply by name.
 */
const projectIdFromText = (text: string | null): string | null => {
  if (!text) return null;
  const projects = EcosystemStore.listProjects();

  // A drive-letter path mentioned in the prompt. Prompts are typed in a hurry,
  // so the path often runs straight into the next word
  // ("E:\Projects\Agent-Builderpleas run..."); take the longest registered
  // project path that prefixes it, longest first so "financeplay-1" is never
  // mistaken for "financeplay".
  for (const match of text.match(/[A-Za-z]:[\\/][^\s"'`,;)]+/g) ?? []) {
    const byPath = projectIdForPath(match);
    if (byPath) return byPath;
    const normalised = match.replace(/\\/g, "/").toLowerCase();
    const prefixed = EcosystemStore.listProjects()
      .map((project) => ({ id: project.id, path: project.path.replace(/\\/g, "/").toLowerCase() }))
      .sort((a, b) => b.path.length - a.path.length)
      .find((candidate) => normalised.startsWith(candidate.path));
    if (prefixed) return prefixed.id;
  }

  // A GitHub URL: match the repository name against a project name or remote.
  for (const match of text.match(/github\.com[:/][\w.-]+\/[\w.-]+/gi) ?? []) {
    const repo = match.split(/[:/]/).pop()?.replace(/\.git$/, "").toLowerCase();
    if (!repo) continue;
    const hit = projects.find(
      (project) => project.name.toLowerCase() === repo || (project.gitRemote ?? "").toLowerCase().includes(`/${repo}`)
    );
    if (hit) return hit.id;
  }

  // Finally the project's own name, only when it is distinctive enough not to
  // collide with ordinary words.
  const haystack = text.toLowerCase();
  const named = projects
    .filter((project) => project.name.length >= 5)
    .find((project) => containsWord(haystack, project.name.toLowerCase()));
  return named?.id ?? null;
};

/** One Claude transcript, summarised from its head and tail only. */
const readClaudeSession = (file: string): AiSession | null => {
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }

  const cached = cache.get(file);
  if (cached && cached.mtimeMs === mtimeMs) return cached.session;

  const lines = [...readSlice(file, HEAD_BYTES).split("\n"), ...readSlice(file, TAIL_BYTES, true).split("\n")];
  let cwd: string | null = null;
  let title: string | null = null;
  let firstPrompt: string | null = null;
  let messages = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue; // A slice boundary cuts a line in half; skip it.
    }
    const type = record.type as string | undefined;
    if (!cwd && typeof record.cwd === "string") cwd = record.cwd;
    if ((type === "custom-title" || type === "ai-title") && typeof record.content === "string") title = record.content;
    if (type === "user" || type === "assistant") messages += 1;
    if (type === "user" && !firstPrompt) {
      firstPrompt = textOf((record.message as { content?: unknown } | undefined)?.content ?? record.content);
    }
  }

  const session: AiSession = {
    source: "claude",
    id: path.basename(file, ".jsonl"),
    title: tidy(title, 90) ?? tidy(firstPrompt, 70) ?? "Claude session",
    summary: tidy(firstPrompt),
    projectPath: cwd,
    // The working directory is often a parent folder, so fall back to whatever
    // the opening prompt names.
    projectId: projectIdForPath(cwd) ?? projectIdFromText(`${title ?? ""} ${firstPrompt ?? ""}`),
    updatedAt: new Date(mtimeMs).toISOString(),
    messages
  };

  cache.set(file, { mtimeMs, session });
  return session;
};

const claudeSessions = (limit: number): AiSession[] => {
  if (!fs.existsSync(CLAUDE_ROOT)) return [];
  const files: Array<{ file: string; mtimeMs: number }> = [];
  for (const directory of fs.readdirSync(CLAUDE_ROOT)) {
    const full = path.join(CLAUDE_ROOT, directory);
    try {
      if (!fs.statSync(full).isDirectory()) continue;
      for (const entry of fs.readdirSync(full)) {
        if (!entry.endsWith(".jsonl")) continue;
        const file = path.join(full, entry);
        files.push({ file, mtimeMs: fs.statSync(file).mtimeMs });
      }
    } catch {
      // A directory that vanished mid-scan is not worth failing over.
    }
  }
  return files
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit)
    .map((entry) => readClaudeSession(entry.file))
    .filter((session): session is AiSession => session !== null);
};

/** file:///e%3A/Projects/Plazr -> E:/Projects/Plazr */
const pathFromFileUri = (uri: string): string | null => {
  try {
    const decoded = decodeURIComponent(uri.replace(/^file:\/\/\//, ""));
    return decoded.replace(/^([a-zA-Z]):?/, (_match, drive: string) => `${drive.toUpperCase()}:`);
  } catch {
    return null;
  }
};

const geminiSessions = (limit: number): AiSession[] => {
  const sessions: AiSession[] = [];

  // Projects Antigravity knows about: name, folder, and when it was last used.
  const projectsDir = path.join(GEMINI_ROOT, "config", "projects");
  if (fs.existsSync(projectsDir)) {
    for (const entry of fs.readdirSync(projectsDir)) {
      if (!entry.endsWith(".json")) continue;
      const file = path.join(projectsDir, entry);
      try {
        const config = JSON.parse(fs.readFileSync(file, "utf8")) as {
          id?: string;
          name?: string;
          updatedAt?: string;
          projectResources?: { resources?: Array<{ folderUri?: string }> };
          permissionGrants?: { permissionGrants?: { allow?: string[] } };
        };
        const folderUri = config.projectResources?.resources?.[0]?.folderUri;
        const projectPath = folderUri ? pathFromFileUri(folderUri) : null;
        const allowed = config.permissionGrants?.permissionGrants?.allow ?? [];
        const commands = allowed
          .filter((grant) => grant.startsWith("command("))
          .map((grant) => grant.slice("command(".length, -1))
          .slice(-4);

        sessions.push({
          source: "gemini",
          id: config.id ?? path.basename(entry, ".json"),
          title: config.name ?? "Gemini project",
          summary: commands.length > 0 ? `Recent approved commands: ${commands.join("; ")}` : null,
          projectPath,
          projectId: projectIdForPath(projectPath) ?? projectIdFromText(config.name ?? null),
          updatedAt: config.updatedAt ?? new Date(fs.statSync(file).mtimeMs).toISOString(),
          artifacts: []
        });
      } catch {
        // Skip a config we cannot read rather than failing the whole list.
      }
    }
  }

  // Each "brain" directory is one piece of work, with a plan and a walkthrough
  // that carry their own written summaries — the most useful thing Gemini
  // leaves behind for picking work back up.
  const brainDir = path.join(GEMINI_ROOT, "antigravity", "brain");
  if (fs.existsSync(brainDir)) {
    for (const entry of fs.readdirSync(brainDir)) {
      const directory = path.join(brainDir, entry);
      try {
        if (!fs.statSync(directory).isDirectory()) continue;
        const files = fs.readdirSync(directory);
        const summaries: string[] = [];
        const artifacts: string[] = [];
        let heading: string | null = null;
        let updatedAt = new Date(fs.statSync(directory).mtimeMs).toISOString();

        for (const name of files) {
          if (name.endsWith(".metadata.json")) {
            try {
              const meta = JSON.parse(fs.readFileSync(path.join(directory, name), "utf8")) as {
                summary?: string;
                updatedAt?: string;
              };
              if (meta.summary) summaries.push(meta.summary);
              if (meta.updatedAt) updatedAt = meta.updatedAt;
            } catch {
              // ignore an unreadable metadata file
            }
          } else if (name.endsWith(".md")) {
            artifacts.push(name);
            if (!heading) {
              const firstLine = readSlice(path.join(directory, name), 400).split("\n")[0] ?? "";
              heading = firstLine.replace(/^#+\s*/, "").trim() || null;
            }
          }
        }

        if (summaries.length === 0 && !heading) continue;

        const matchedId = projectIdFromText(`${heading ?? ""} ${summaries.join(" ")}`);
        const matched = matchedId ? EcosystemStore.getProject(matchedId) : null;

        sessions.push({
          source: "gemini",
          id: entry,
          title: heading ?? "Gemini work",
          summary: tidy(summaries.join(" "), 320),
          projectPath: matched?.path ?? null,
          projectId: matched?.id ?? null,
          updatedAt,
          artifacts
        });
      } catch {
        // ignore a directory that cannot be read
      }
    }
  }

  return sessions.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, limit);
};

export const AiSessions = {
  /** Most recent work from both assistants, newest first. */
  recent(limit = 30): AiSession[] {
    const all = [...claudeSessions(limit), ...geminiSessions(limit)];
    return all.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, limit);
  },

  /** What either assistant was doing in one project. */
  forProject(projectId: string, limit = 8): AiSession[] {
    return this.recent(150)
      .filter((session) => session.projectId === projectId)
      .slice(0, limit);
  },

  available(): { claude: boolean; gemini: boolean } {
    return {
      claude: fs.existsSync(CLAUDE_ROOT),
      gemini: fs.existsSync(GEMINI_ROOT)
    };
  }
};
