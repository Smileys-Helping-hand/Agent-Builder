/**
 * Smoketest: plug-and-play databases for built apps (DbKit + templates/db-kit).
 * Run with: npx tsx scripts/db-kit-smoketest.ts
 */
import fs from "fs";
import os from "os";
import path from "path";

import { DB_PLATFORMS, DbKit, dangerousKey } from "../src/database/DbKit.js";

const fail = (message: string): never => {
  throw new Error(message);
};

const main = () => {
  // 1. The builder's platform list and the kit's agree, key for key.
  const kit = fs.readFileSync(path.resolve("templates/db-kit/src/lib/db/platforms.ts"), "utf8");
  for (const platform of DB_PLATFORMS) {
    if (!kit.includes(`id: "${platform.id}"`)) fail(`kit has no platform ${platform.id}`);
    for (const field of platform.fields) {
      if (!new RegExp(`key: "${field.key}", env: "${field.env}"`).test(kit)) fail(`kit and builder disagree on ${platform.id}.${field.key} (${field.env})`);
    }
  }
  const kitEnvs = [...kit.matchAll(/env: "(VITE_[A-Z_]+)"/g)].map((m) => m[1]).sort();
  const ourEnvs = DB_PLATFORMS.flatMap((p) => p.fields.map((f) => f.env)).sort();
  if (JSON.stringify(kitEnvs) !== JSON.stringify(ourEnvs)) fail(`env names differ:\n kit ${kitEnvs}\n ours ${ourEnvs}`);
  console.log(`[PASS] ${DB_PLATFORMS.length} platforms agree with the kit`);

  // 2. Install into a copy of the web starter.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbkit-"));
  try {
    fs.cpSync(path.resolve("templates/starters/web"), dir, { recursive: true, filter: (s) => !/node_modules|dist/.test(s) });
    DbKit.install(dir, "supabase");
    for (const file of ["src/lib/db/index.ts", "src/lib/db/adapters.ts", "src/lib/db/DbSetup.tsx", "src/lib/db/db.test.ts", "DATABASE.md", ".env.example", ".env.local", ".gitignore"]) {
      if (!fs.existsSync(path.join(dir, file))) fail(`install did not write ${file}`);
    }
    if (!/VITE_SUPABASE_ANON_KEY=/.test(fs.readFileSync(path.join(dir, ".env.example"), "utf8"))) fail(".env.example lacks the Supabase keys");
    if (!/^\.env\.local$/m.test(fs.readFileSync(path.join(dir, ".gitignore"), "utf8"))) fail(".env.local is not git-ignored");
    let state = DbKit.state(dir);
    if (state.platform !== "supabase" || state.missing.length !== 2) fail(`fresh state wrong: ${JSON.stringify(state)}`);
    console.log("[PASS] installs the data layer, setup guide and env template");

    // 3. Keys: secret keys refused, values never come back, switching platform drops the old keys.
    const serviceRole = `x.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.y`;
    if (!dangerousKey("supabase", "anonKey", serviceRole)) fail("service_role key not caught");
    let refused = false;
    try {
      DbKit.writeKeys(dir, "supabase", { url: "https://x.supabase.co", anonKey: serviceRole });
    } catch {
      refused = true;
    }
    if (!refused) fail("writeKeys accepted a service_role key");
    const anon = `x.${Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url")}.y`;
    state = DbKit.writeKeys(dir, "supabase", { url: "https://x.supabase.co", anonKey: anon });
    if (state.missing.length || JSON.stringify(state).includes(anon)) fail(`state wrong or leaks a key: ${JSON.stringify(state)}`);
    state = DbKit.writeKeys(dir, "supabase", { url: "", anonKey: "" }, { keepExisting: true });
    if (state.set.length !== 2) fail("keepExisting dropped saved keys");
    DbKit.install(dir, "pocketbase");
    state = DbKit.writeKeys(dir, "pocketbase", { url: "http://127.0.0.1:8090" }, { keepExisting: true });
    const env = fs.readFileSync(path.join(dir, ".env.local"), "utf8");
    if (/SUPABASE/.test(env) || !/VITE_DB_PROVIDER=pocketbase/.test(env)) fail(`switching platform left: ${env}`);
    console.log("[PASS] keys: secrets refused, values never returned, old platform's keys dropped");

    // 4. The model is told to use it.
    const preamble = DbKit.preamble(dir);
    if (!/useCollection/.test(preamble) || !/DbStatusBar/.test(preamble) || !/PocketBase/.test(preamble)) fail("preamble is missing the data-layer instructions");
    console.log("[PASS] the build's model is told to keep its data in src/lib/db");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log("All DbKit checks passed.");
};

try {
  main();
} catch (error) {
  console.error("DbKit smoketest failed:", (error as Error).message);
  process.exit(1);
}
