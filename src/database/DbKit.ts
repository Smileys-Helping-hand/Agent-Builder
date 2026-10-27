/**
 * DbKit — databases for the apps Agent Builder makes, without Agent Builder
 * running anyone's database.
 *
 * The person picks the platform they plan to use (Supabase, Firebase,
 * PocketBase, Appwrite, their own API — or none yet). The build gets a ready
 * data layer for it (templates/db-kit → src/lib/db: collection(), useCollection(),
 * auth, and a "Connect a database" panel), the model is told to keep all data
 * there, and the keys are simple boxes: in the Agent Builder app (written to the
 * build's .env.local on this PC, never shown back) or in the finished app itself.
 * With no keys the app saves in the browser, so it works from the first preview.
 *
 * Only platforms whose keys are safe in a web page are offered; databases that
 * need a secret (MySQL, SQL Server, MongoDB) go through "My own API".
 *
 * The platform list mirrors templates/db-kit/src/lib/db/platforms.ts; the db-kit
 * smoketest checks the two agree.
 */
import { execFile } from "child_process";
import fs from "fs";
import path from "path";

import { Logger } from "../utils/Logger.js";

export type DbPlatformId = "local" | "supabase" | "firebase" | "pocketbase" | "appwrite" | "rest";

export interface DbField {
  key: string;
  env: string;
  label: string;
  optional?: boolean;
}

export interface DbPlatform {
  id: DbPlatformId;
  name: string;
  pitch: string;
  auth: boolean;
  fields: DbField[];
}

export const DB_PLATFORMS: DbPlatform[] = [
  { id: "local", name: "This browser only (decide later)", pitch: "No setup; data stays in the visitor's browser until a database is connected.", auth: true, fields: [] },
  {
    id: "supabase",
    name: "Supabase",
    pitch: "Postgres with sign-in, free to start. The best all-round choice.",
    auth: true,
    fields: [
      { key: "url", env: "VITE_SUPABASE_URL", label: "Project URL" },
      { key: "anonKey", env: "VITE_SUPABASE_ANON_KEY", label: "anon public key" }
    ]
  },
  {
    id: "firebase",
    name: "Firebase (Firestore)",
    pitch: "Google's document database with sign-in.",
    auth: true,
    fields: [
      { key: "apiKey", env: "VITE_FIREBASE_API_KEY", label: "Web API key" },
      { key: "projectId", env: "VITE_FIREBASE_PROJECT_ID", label: "Project ID" }
    ]
  },
  { id: "pocketbase", name: "PocketBase", pitch: "One small file you run yourself. Free forever.", auth: true, fields: [{ key: "url", env: "VITE_POCKETBASE_URL", label: "PocketBase URL" }] },
  {
    id: "appwrite",
    name: "Appwrite",
    pitch: "Open-source backend, cloud or self-hosted (data only).",
    auth: false,
    fields: [
      { key: "endpoint", env: "VITE_APPWRITE_ENDPOINT", label: "API endpoint" },
      { key: "projectId", env: "VITE_APPWRITE_PROJECT_ID", label: "Project ID" },
      { key: "databaseId", env: "VITE_APPWRITE_DATABASE_ID", label: "Database ID" },
      { key: "collectionId", env: "VITE_APPWRITE_COLLECTION_ID", label: "Collection ID" }
    ]
  },
  {
    id: "rest",
    name: "My own API",
    pitch: "Your own server — the way to use MySQL, SQL Server or MongoDB safely.",
    auth: false,
    fields: [
      { key: "baseUrl", env: "VITE_API_URL", label: "API base URL" },
      { key: "publicKey", env: "VITE_API_PUBLIC_KEY", label: "Public API key", optional: true }
    ]
  }
];

const KIT_DIR = () => path.resolve(process.env.DB_KIT_DIR ?? "templates/db-kit");
export const isPlatform = (value: unknown): value is DbPlatformId => typeof value === "string" && DB_PLATFORMS.some((p) => p.id === value);
export const dbPlatform = (id: DbPlatformId): DbPlatform => DB_PLATFORMS.find((p) => p.id === id) ?? DB_PLATFORMS[0];

const copyDir = (from: string, to: string) => {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
};

const readEnvFile = (file: string): Record<string, string> => {
  if (!fs.existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match) out[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return out;
};

/** A key that must never be in a web page: Supabase's service_role, or one that says it is secret. */
export const dangerousKey = (platform: DbPlatformId, field: string, value: string): string | null => {
  if (platform === "supabase" && field === "anonKey") {
    if (/^sb_secret_/.test(value)) return "That is a Supabase secret key. Use the publishable (anon) key.";
    try {
      const payload = JSON.parse(Buffer.from(value.split(".")[1] ?? "", "base64url").toString("utf8")) as { role?: string };
      if (payload.role === "service_role") return "That is Supabase's service_role key: it bypasses every rule and anyone could read it from the page. Use the anon public key.";
    } catch {
      // not a JWT: fine
    }
  }
  if (/sk_live_|-----BEGIN [A-Z ]*PRIVATE KEY/.test(value)) return "That is a secret key; only public keys belong in a web app.";
  return null;
};

const ENV_EXAMPLE_START = "# --- database (Agent Builder) ---";
const ENV_EXAMPLE_END = "# --- end database ---";

export interface DbState {
  installed: boolean;
  platform: DbPlatformId | null;
  /** Which of the platform's keys are set (never their values). */
  set: string[];
  missing: string[];
}

export const DbKit = {
  platforms: () => DB_PLATFORMS,

  /** Puts the data layer in a build: src/lib/db, .env.example, DATABASE.md, .gitignore for .env.local. */
  install(workspace: string, platform: DbPlatformId): void {
    const kit = KIT_DIR();
    if (!fs.existsSync(path.join(kit, "src", "lib", "db", "index.ts"))) throw new Error(`The database kit is missing (${kit}).`);
    copyDir(path.join(kit, "src"), path.join(workspace, "src"));

    const chosen = dbPlatform(platform);
    const block = [
      ENV_EXAMPLE_START,
      `# The database this app uses: local (this browser), supabase, firebase, pocketbase, appwrite or rest.`,
      `# Put real values in .env.local (never committed) or use the app's "Connect a database" panel.`,
      `VITE_DB_PROVIDER=${platform}`,
      ...chosen.fields.map((field) => `${field.env}=`),
      ENV_EXAMPLE_END
    ].join("\n");
    const examplePath = path.join(workspace, ".env.example");
    const existing = fs.existsSync(examplePath) ? fs.readFileSync(examplePath, "utf8") : "";
    const without = existing.replace(new RegExp(`${ENV_EXAMPLE_START}[\\s\\S]*?${ENV_EXAMPLE_END}\\n?`), "").trimEnd();
    fs.writeFileSync(examplePath, `${without ? `${without}\n\n` : ""}${block}\n`, "utf8");

    const gitignore = path.join(workspace, ".gitignore");
    const ignored = fs.existsSync(gitignore) ? fs.readFileSync(gitignore, "utf8") : "node_modules\ndist\n";
    if (!/^\.env\.local$/m.test(ignored)) fs.writeFileSync(gitignore, `${ignored.trimEnd()}\n.env.local\n.env*.local\n`, "utf8");

    fs.writeFileSync(path.join(workspace, "DATABASE.md"), DbKit.guide(platform), "utf8");
    // The platform chosen goes in .env.local too, so the app uses it as soon as its keys are in.
    if (platform !== "local") DbKit.writeKeys(workspace, platform, {}, { keepExisting: true });
  },

  guide(platform: DbPlatformId): string {
    const chosen = dbPlatform(platform);
    return `# Database

This app keeps its data through \`src/lib/db\` and is set up for **${chosen.name}**.

${platform === "local" ? "No database is connected yet: data is saved in each visitor's browser. Open the app and tap the pill in the bottom-left corner (\"Connect a database\") to pick one and paste its keys — no code changes." : `## Connect it

1. Open the app and tap the pill in the bottom-left corner → **Connect a database** → **${chosen.name}**.
2. Follow the steps shown there (they include the SQL or rules to paste on ${chosen.name}).
3. Paste the keys into the boxes, press **Test connection**, then **Save & use it**.

That connects this browser. To connect it for every visitor, put the keys in \`.env.local\` and rebuild:

\`\`\`
VITE_DB_PROVIDER=${platform}
${chosen.fields.map((field) => `${field.env}=…   # ${field.label}${field.optional ? " (optional)" : ""}`).join("\n")}
\`\`\`

Agent Builder can write these for you: open the build in the app → **Database**.`}

## Safety

Only **public** keys belong here — ${chosen.name === "Supabase" ? "the anon key, never service_role" : "the ones the platform gives web apps"}. Who can read and write what is set by the rules on the platform (the setup steps), not by hiding keys: anything in a web page can be read by anyone.

## In code

\`\`\`ts
import { collection, useCollection, auth } from "./lib/db";
const { items, add, update, remove } = useCollection<{ title: string }>("tasks");
\`\`\`
`;
  },

  /** Writes the keys to the build's .env.local (VITE_DB_PROVIDER plus the platform's fields). Values are never returned. */
  writeKeys(workspace: string, platform: DbPlatformId, values: Record<string, string>, options: { keepExisting?: boolean } = {}): DbState {
    const chosen = dbPlatform(platform);
    for (const field of chosen.fields) {
      const value = values[field.key]?.trim();
      if (!value) continue;
      if (value.length > 4000 || /[\r\n]/.test(value)) throw new Error(`${field.label} does not look like a key.`);
      const danger = dangerousKey(platform, field.key, value);
      if (danger) throw new Error(danger);
    }
    const file = path.join(workspace, ".env.local");
    const env = readEnvFile(file);
    // Another platform's keys are dropped when the platform changes.
    for (const other of DB_PLATFORMS) if (other.id !== platform) for (const field of other.fields) delete env[field.env];
    env.VITE_DB_PROVIDER = platform;
    for (const field of chosen.fields) {
      const value = values[field.key]?.trim();
      if (value) env[field.env] = value;
      else if (!options.keepExisting && values[field.key] !== undefined) delete env[field.env];
    }
    fs.writeFileSync(file, `${Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n")}\n`, "utf8");
    return DbKit.state(workspace);
  },

  state(workspace: string): DbState {
    const installed = fs.existsSync(path.join(workspace, "src", "lib", "db", "index.ts"));
    const env = readEnvFile(path.join(workspace, ".env.local"));
    const platform = isPlatform(env.VITE_DB_PROVIDER) ? env.VITE_DB_PROVIDER : installed ? "local" : null;
    const fields = platform ? dbPlatform(platform).fields : [];
    return {
      installed,
      platform,
      set: fields.filter((field) => Boolean(env[field.env])).map((field) => field.key),
      missing: fields.filter((field) => !field.optional && !env[field.env]).map((field) => field.key)
    };
  },

  /** Asks the platform whether these keys work, from this PC. Values come from the request or the build's .env.local. */
  async test(platform: DbPlatformId, values: Record<string, string>): Promise<{ ok: boolean; detail: string }> {
    const v = (key: string) => (values[key] ?? "").trim();
    const attempt = async (url: string, headers: Record<string, string>, what: string): Promise<{ ok: boolean; detail: string }> => {
      try {
        const response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
        const text = (await response.text()).slice(0, 300);
        if (response.ok) return { ok: true, detail: `${what} answered: the keys work and the table is there.` };
        if (response.status === 401 || response.status === 403) return { ok: false, detail: `${what} refused the key (${response.status}). Check it is the public key and the rules from the setup steps are in.` };
        if (response.status === 404) return { ok: false, detail: `${what} is reachable, but the table/collection is not there yet — run the setup steps (${text}).` };
        return { ok: false, detail: `${what} answered ${response.status}: ${text}` };
      } catch (error) {
        return { ok: false, detail: `Could not reach ${what}: ${(error as Error)?.message ?? error}` };
      }
    };
    switch (platform) {
      case "supabase":
        return attempt(`${v("url").replace(/\/+$/, "")}/rest/v1/ab_records?select=id&limit=1`, { apikey: v("anonKey"), Authorization: `Bearer ${v("anonKey")}` }, "Supabase");
      case "firebase":
        return attempt(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(v("projectId"))}/databases/(default)/documents/ab_ping?pageSize=1&key=${encodeURIComponent(v("apiKey"))}`, {}, "Firestore");
      case "pocketbase":
        return attempt(`${v("url").replace(/\/+$/, "")}/api/collections/ab_records/records?perPage=1`, {}, "PocketBase");
      case "appwrite":
        return attempt(
          `${v("endpoint").replace(/\/+$/, "")}/databases/${encodeURIComponent(v("databaseId"))}/collections/${encodeURIComponent(v("collectionId"))}/documents?queries[]=${encodeURIComponent(JSON.stringify({ method: "limit", values: [1] }))}`,
          { "X-Appwrite-Project": v("projectId") },
          "Appwrite"
        );
      case "rest":
        return attempt(`${v("baseUrl").replace(/\/+$/, "")}/ab_ping`, v("publicKey") ? { "x-api-key": v("publicKey") } : {}, "Your API").then((r) =>
          !r.ok && /answered 4\d\d|table\/collection/.test(r.detail) ? { ok: true, detail: "Your API is reachable." } : r
        );
      default:
        return { ok: true, detail: "No database to test: the app saves in the browser." };
    }
  },

  /** The keys saved in the build's .env.local, for testing from the PC (never sent to the app). */
  savedValues(workspace: string, platform: DbPlatformId): Record<string, string> {
    const env = readEnvFile(path.join(workspace, ".env.local"));
    return Object.fromEntries(dbPlatform(platform).fields.map((field) => [field.key, env[field.env] ?? ""]));
  },

  /** What the model is told when a build has the data layer. */
  preamble(workspace: string): string {
    const state = DbKit.state(workspace);
    if (!state.installed) return "";
    const chosen = dbPlatform(state.platform ?? "local");
    return `Data: this app keeps ALL saved data (records, lists, users' content, settings) through src/lib/db — already written; import it, never rewrite it.
  import { collection, useCollection, auth, useUser } from "./lib/db";
  import { DbStatusBar } from "./lib/db/DbSetup";
useCollection<T>("name") returns { items, add, update, remove, loading, error } (items newest first, each with id, createdAt, updatedAt);
collection<T>("name") has list(), get(id), add(data), update(id, patch), remove(id), all async. Collection names: letters, digits, - and _.
${chosen.auth ? "Accounts, if the app needs them: auth.signUp(email, password), auth.signIn(…), auth.signOut(), and useUser() for the signed-in person (null when signed out).\n" : ""}Do not use localStorage, IndexedDB or a hard-coded array for saved data, and do not add a database package or a server: the person connects ${chosen.name}${state.platform === "local" ? " (or another platform)" : ""} with their own keys.
Render <DbStatusBar /> once in App (it shows where data is saved and opens the "Connect a database" panel). Show loading and error states from useCollection.

`;
  },

  /** Rebuilds the build's site so a preview picks up new keys. */
  rebuild(workspace: string): Promise<{ ok: boolean; detail: string }> {
    return new Promise((resolve) => {
      if (!fs.existsSync(path.join(workspace, "node_modules"))) return resolve({ ok: false, detail: "The build has not been installed yet; the next pass picks the keys up." });
      execFile("npm", ["run", "build"], { cwd: workspace, timeout: 10 * 60_000, windowsHide: true, shell: process.platform === "win32" }, (error, _stdout, stderr) => {
        if (error) {
          Logger.warn("Rebuild after database keys failed", { workspace, error: String(stderr || error.message).slice(-400) });
          resolve({ ok: false, detail: String(stderr || error.message).slice(-400) });
        } else resolve({ ok: true, detail: "Rebuilt: the preview now uses these keys." });
      });
    });
  }
};
