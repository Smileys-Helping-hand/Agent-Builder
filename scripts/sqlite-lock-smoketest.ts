/**
 * Another process holding the database must make the builder wait, not crash.
 *
 *   npm run test:sqlite-lock
 *
 * A child process takes the write lock on a scratch database for two seconds;
 * meanwhile this process writes to it through openSqlite, plainly and in a
 * transaction. Both must wait for the lock and succeed. Then CrashGuard must
 * keep a process alive through a stray rejection and a stray exception.
 */
import { spawn, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

import { openSqlite } from "../src/utils/Sqlite.js";

const fail = (message: string): never => {
  console.error(`sqlite lock: FAILED: ${message}`);
  process.exit(1);
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sqlite-lock-"));
const file = path.join(dir, "test.db");
const setup = openSqlite(file);
setup.pragma("journal_mode = WAL");
setup.exec("CREATE TABLE notes (text TEXT)");
setup.close();

// The other process: take the write lock, say so, hold it two seconds, let go.
const holder = spawn(
  process.execPath,
  [
    "-e",
    `const { DatabaseSync } = require("node:sqlite");
     const db = new DatabaseSync(${JSON.stringify(file)});
     db.exec("BEGIN IMMEDIATE");
     db.exec("INSERT INTO notes VALUES ('held')");
     console.log("locked");
     setTimeout(() => { db.exec("COMMIT"); db.close(); }, 2000);`
  ],
  { stdio: ["ignore", "pipe", "inherit"] }
);

await new Promise<void>((resolve) => holder.stdout.on("data", (chunk: Buffer) => chunk.toString().includes("locked") && resolve()));

const db = openSqlite(file);
const started = Date.now();
try {
  db.prepare("INSERT INTO notes VALUES (?)").run("waited");
  db.transaction(() => db.prepare("INSERT INTO notes VALUES (?)").run("in a transaction"))();
} catch (error) {
  fail(`a write while another process held the lock threw: ${error instanceof Error ? error.message : String(error)}`);
}
const waited = Date.now() - started;
if (waited < 1000) fail(`expected to wait for the lock (~2 s), waited ${waited} ms`);
const rows = db.prepare("SELECT COUNT(*) AS n FROM notes").get() as { n: number };
if (rows.n !== 3) fail(`expected 3 rows, found ${rows.n}`);
db.close();
await new Promise((resolve) => holder.on("exit", resolve));
fs.rmSync(dir, { recursive: true, force: true });
console.log(`sqlite lock: a write waited ${waited} ms for another process's lock, then succeeded`);

// CrashGuard: a stray rejection and a stray exception are logged, the process lives.
const guarded = spawnSync(
  process.execPath,
  [
    "--import",
    "tsx",
    "-e",
    `await import(${JSON.stringify(path.resolve("src/utils/CrashGuard.ts").replace(/\\/g, "/").replace(/^([A-Za-z]):/, "file:///$1:"))});
     Promise.reject(new Error("database is locked"));
     setTimeout(() => { throw new Error("a timer went wrong"); }, 10);
     setTimeout(() => { console.log("still running"); process.exit(0); }, 300);`
  ],
  { encoding: "utf8", timeout: 60_000 }
);
if (!guarded.stdout.includes("still running")) fail(`CrashGuard did not keep the process alive (exit ${guarded.status}): ${guarded.stderr.slice(-600)}`);
if (!/Survived an unhandledRejection/.test(guarded.stdout + guarded.stderr)) fail("CrashGuard did not log the rejection");
if (!/Survived an uncaughtException/.test(guarded.stdout + guarded.stderr)) fail("CrashGuard did not log the exception");
console.log("sqlite lock: CrashGuard kept a process alive through a stray rejection and exception");
console.log("sqlite lock: all checks passed");
