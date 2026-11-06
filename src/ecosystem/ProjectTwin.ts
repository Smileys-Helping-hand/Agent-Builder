/**
 * ProjectTwin — what the builder knows about a project right now, in one record:
 * its parts and dependencies, what it can do (finished milestones), its known
 * defects (failing checks, VM test failures, parked milestones, your open feedback),
 * and what changes most. Made from the workspace and the records each time it is
 * asked for, so it cannot go stale. Every step of a continuous build is given the
 * defects and parts, so it understands the project before changing it.
 */
import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";

import { ContinuousImprover, type ImproveSession } from "../agent/ContinuousImprover.js";
import { Evidence } from "../knowledge/Evidence.js";
import { VmTests } from "../lab/VmTests.js";

const run = promisify(execFile);

export interface ProjectTwinRecord {
  project: string;
  at: string;
  parts: Array<{ folder: string; files: number }>;
  stack: string[];
  dependencies: string[];
  scripts: string[];
  capabilities: string[];
  defects: Array<{ kind: "check" | "vm-test" | "parked" | "feedback"; text: string }>;
  mostChanged: Array<{ file: string; changes: number }>;
}

const git = async (dir: string, args: string[]) => (await run("git", args, { cwd: dir, windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: 60_000 })).stdout;

const manifestOf = (dir: string): { stack: string[]; dependencies: string[]; scripts: string[] } => {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string> };
    const dependencies = Object.keys(manifest.dependencies ?? {});
    const all = [...dependencies, ...Object.keys(manifest.devDependencies ?? {})];
    const stack = ["next", "react", "vue", "svelte", "express", "phaser", "three", "typescript", "vite", "prisma", "electron"].filter((name) => all.includes(name));
    return { stack, dependencies: dependencies.slice(0, 60), scripts: Object.keys(manifest.scripts ?? {}).slice(0, 30) };
  } catch {
    return { stack: [], dependencies: [], scripts: [] };
  }
};

export const ProjectTwin = {
  async of(session: ImproveSession): Promise<ProjectTwinRecord> {
    const dir = session.workspace?.dir ?? session.projectPath;
    const files = (await git(dir, ["ls-files"]).catch(() => "")).split("\n").filter(Boolean);
    const folders = new Map<string, number>();
    for (const file of files) {
      const folder = file.includes("/") ? file.split("/").slice(0, -1).slice(0, 2).join("/") : "(top level)";
      folders.set(folder, (folders.get(folder) ?? 0) + 1);
    }
    const changed = new Map<string, number>();
    for (const file of (await git(dir, ["log", "--format=", "--name-only", "-200"]).catch(() => "")).split("\n").filter(Boolean)) changed.set(file, (changed.get(file) ?? 0) + 1);

    const defects: ProjectTwinRecord["defects"] = [];
    if (session.lastCheck && !session.lastCheck.passed) defects.push({ kind: "check", text: `Failing: ${session.lastCheck.failing.join(", ")}` });
    const latestVm = VmTests.list(100).find((r) => r.task === `session:${session.id}` && r.state !== "running");
    for (const step of latestVm?.steps.filter((s) => s.result === "failed") ?? []) defects.push({ kind: "vm-test", text: `${step.what}: expected ${step.expected}; got ${step.actual}`.slice(0, 300) });
    for (const milestone of session.plan.filter((m) => m.status === "parked")) defects.push({ kind: "parked", text: `${milestone.title}${milestone.diagnosis ? `: ${milestone.diagnosis}` : milestone.note ? `: ${milestone.note}` : ""}`.slice(0, 300) });
    for (const record of Evidence.forTask(`session:${session.id}`, 200).filter((r) => r.kind === "feedback").slice(0, 8)) defects.push({ kind: "feedback", text: record.title.slice(0, 300) });

    return {
      project: session.projectName,
      at: new Date().toISOString(),
      parts: [...folders].map(([folder, count]) => ({ folder, files: count })).sort((a, b) => b.files - a.files).slice(0, 30),
      ...manifestOf(dir),
      capabilities: session.plan.filter((m) => m.status === "done").map((m) => m.title).slice(-40),
      defects: defects.slice(0, 40),
      mostChanged: [...changed].map(([file, changes]) => ({ file, changes })).sort((a, b) => b.changes - a.changes).slice(0, 12)
    };
  },

  async forProject(projectId: string): Promise<ProjectTwinRecord | null> {
    const sessions = ContinuousImprover.list().sessions.filter((s) => s.projectId === projectId);
    const session = sessions.find((s) => s.state !== "stopped") ?? sessions[0];
    return session ? ProjectTwin.of(session) : null;
  },

  /** The short form every step is given. */
  brief(twin: ProjectTwinRecord): string {
    return `What is known about this project:
Parts: ${twin.parts.slice(0, 12).map((p) => `${p.folder} (${p.files})`).join(", ")}
${twin.stack.length ? `Built with: ${twin.stack.join(", ")}\n` : ""}${twin.defects.length ? `Known defects:\n${twin.defects.slice(0, 10).map((d) => `- [${d.kind}] ${d.text}`).join("\n")}\n` : "Known defects: none recorded\n"}`;
  }
};
