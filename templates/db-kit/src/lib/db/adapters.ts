/**
 * One adapter per platform, all speaking the same small language: list, get,
 * add, update and remove records in a named collection, plus sign-in where the
 * platform has it. Plain fetch against each platform's public REST API — no
 * SDKs to install, nothing that breaks the build.
 *
 * Every platform stores a record the same way: { id, collection, data,
 * createdAt, updatedAt }, so any app's collections ("tasks", "orders",
 * "bookings"…) work without making a table for each.
 */
import type { PlatformId } from "./platforms";

export interface Meta {
  id: string;
  createdAt: string;
  updatedAt: string;
}
export type Stored<T> = T & Meta;

export interface User {
  id: string;
  email: string;
}

export interface Adapter {
  list(collection: string): Promise<Array<Stored<Record<string, unknown>>>>;
  get(collection: string, id: string): Promise<Stored<Record<string, unknown>> | null>;
  add(collection: string, data: Record<string, unknown>): Promise<Stored<Record<string, unknown>>>;
  update(collection: string, id: string, patch: Record<string, unknown>): Promise<Stored<Record<string, unknown>>>;
  remove(collection: string, id: string): Promise<void>;
  /** Checks the keys and the setup; resolves with what it found, rejects with what to fix. */
  ping(): Promise<string>;
  auth?: {
    signUp(email: string, password: string): Promise<User>;
    signIn(email: string, password: string): Promise<User>;
    signOut(): Promise<void>;
    user(): User | null;
  };
}

export class DbError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "DbError";
  }
}

const now = () => new Date().toISOString();
const strip = (data: Record<string, unknown>) => {
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = data;
  return rest;
};

/** fetch that turns a refusal into a sentence someone can act on. */
const call = async <T>(url: string, init: RequestInit, platform: string): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new DbError(`Could not reach ${platform}. Check the address, your connection, and that the platform allows this site (CORS).`);
  }
  const text = await response.text();
  if (!response.ok) {
    let detail = text.slice(0, 300);
    try {
      const body = JSON.parse(text);
      detail = body.message ?? body.error_description ?? body.msg ?? body.error?.message ?? body.error ?? detail;
    } catch {
      // not JSON
    }
    const hint =
      response.status === 401 || response.status === 403
        ? " — the key was refused or the rules do not allow this (see the setup steps)."
        : response.status === 404
          ? " — the table or collection is not there yet (see the setup steps)."
          : "";
    throw new DbError(`${platform}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}${hint}`, response.status);
  }
  return (text ? JSON.parse(text) : null) as T;
};

const sessionKey = (platform: string) => `ab-db-session-${platform}`;
const loadSession = <T>(platform: string): T | null => {
  try {
    return JSON.parse(localStorage.getItem(sessionKey(platform)) ?? "null") as T | null;
  } catch {
    return null;
  }
};
const saveSession = (platform: string, session: unknown) =>
  session ? localStorage.setItem(sessionKey(platform), JSON.stringify(session)) : localStorage.removeItem(sessionKey(platform));

// ---------------------------------------------------------------- local

const localAdapter = (): Adapter => {
  const key = (collection: string) => `ab-db:${collection}`;
  const read = (collection: string): Array<Stored<Record<string, unknown>>> => {
    try {
      return JSON.parse(localStorage.getItem(key(collection)) ?? "[]");
    } catch {
      return [];
    }
  };
  const write = (collection: string, rows: unknown[]) => localStorage.setItem(key(collection), JSON.stringify(rows));
  // randomUUID only exists on secure pages (https or localhost); a file:// or plain-http page gets the fallback.
  const id = () => (typeof globalThis.crypto?.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);
  const hash = async (text: string) => {
    if (!globalThis.crypto?.subtle) return text;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  };
  return {
    async list(collection) {
      return read(collection).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async get(collection, recordId) {
      return read(collection).find((row) => row.id === recordId) ?? null;
    },
    async add(collection, data) {
      const row = { ...strip(data), id: id(), createdAt: now(), updatedAt: now() };
      write(collection, [...read(collection), row]);
      return row;
    },
    async update(collection, recordId, patch) {
      const rows = read(collection);
      const index = rows.findIndex((row) => row.id === recordId);
      if (index < 0) throw new DbError("That record is not there any more.", 404);
      rows[index] = { ...rows[index], ...strip(patch), updatedAt: now() };
      write(collection, rows);
      return rows[index];
    },
    async remove(collection, recordId) {
      write(collection, read(collection).filter((row) => row.id !== recordId));
    },
    async ping() {
      localStorage.setItem("ab-db-ping", "1");
      localStorage.removeItem("ab-db-ping");
      return "Saving in this browser works.";
    },
    // Accounts on this device only: for trying sign-in out, not for real security.
    auth: {
      async signUp(email, password) {
        const users = read("_users") as Array<Stored<Record<string, unknown>>>;
        if (users.some((u) => u.email === email.toLowerCase())) throw new DbError("There is already an account with that email.");
        const row = { id: id(), email: email.toLowerCase(), password: await hash(password), createdAt: now(), updatedAt: now() };
        write("_users", [...users, row]);
        saveSession("local", { id: row.id, email: row.email });
        return { id: row.id, email: row.email };
      },
      async signIn(email, password) {
        const user = (read("_users") as Array<Record<string, unknown>>).find((u) => u.email === email.toLowerCase());
        if (!user || user.password !== (await hash(password))) throw new DbError("Wrong email or password.", 401);
        const session = { id: String(user.id), email: String(user.email) };
        saveSession("local", session);
        return session;
      },
      async signOut() {
        saveSession("local", null);
      },
      user: () => loadSession<User>("local")
    }
  };
};

// ---------------------------------------------------------------- Supabase (PostgREST + GoTrue)

type SupabaseRow = { id: string; collection: string; data: Record<string, unknown>; created_at: string; updated_at: string };
type SupabaseSession = { access_token: string; user: User };

const supabaseAdapter = (values: Record<string, string>): Adapter => {
  const base = values.url.replace(/\/+$/, "");
  const headers = (extra: Record<string, string> = {}) => {
    const session = loadSession<SupabaseSession>("supabase");
    return { apikey: values.anonKey, Authorization: `Bearer ${session?.access_token ?? values.anonKey}`, "Content-Type": "application/json", ...extra };
  };
  const toRecord = (row: SupabaseRow): Stored<Record<string, unknown>> => ({ ...row.data, id: row.id, createdAt: row.created_at, updatedAt: row.updated_at });
  const rest = `${base}/rest/v1/ab_records`;
  const enc = encodeURIComponent;
  const signedIn = (body: { access_token?: string; user?: { id: string; email?: string } }): User => {
    if (!body.access_token || !body.user) throw new DbError("Check your email to confirm the account, then sign in.");
    const user = { id: body.user.id, email: body.user.email ?? "" };
    saveSession("supabase", { access_token: body.access_token, user });
    return user;
  };
  return {
    async list(collection) {
      const rows = await call<SupabaseRow[]>(`${rest}?collection=eq.${enc(collection)}&select=*&order=created_at.desc&limit=1000`, { headers: headers() }, "Supabase");
      return rows.map(toRecord);
    },
    async get(collection, id) {
      const rows = await call<SupabaseRow[]>(`${rest}?collection=eq.${enc(collection)}&id=eq.${enc(id)}&select=*`, { headers: headers() }, "Supabase");
      return rows[0] ? toRecord(rows[0]) : null;
    },
    async add(collection, data) {
      const rows = await call<SupabaseRow[]>(rest, { method: "POST", headers: headers({ Prefer: "return=representation" }), body: JSON.stringify({ collection, data: strip(data) }) }, "Supabase");
      return toRecord(rows[0]);
    },
    async update(collection, id, patch) {
      const current = await this.get(collection, id);
      if (!current) throw new DbError("That record is not there any more.", 404);
      const rows = await call<SupabaseRow[]>(
        `${rest}?id=eq.${enc(id)}`,
        { method: "PATCH", headers: headers({ Prefer: "return=representation" }), body: JSON.stringify({ data: { ...strip(current), ...strip(patch) }, updated_at: now() }) },
        "Supabase"
      );
      return toRecord(rows[0]);
    },
    async remove(_collection, id) {
      await call(`${rest}?id=eq.${enc(id)}`, { method: "DELETE", headers: headers() }, "Supabase");
    },
    async ping() {
      await call(`${rest}?select=id&limit=1`, { headers: headers() }, "Supabase");
      return "Connected to Supabase and the ab_records table is there.";
    },
    auth: {
      async signUp(email, password) {
        return signedIn(await call(`${base}/auth/v1/signup`, { method: "POST", headers: headers(), body: JSON.stringify({ email, password }) }, "Supabase"));
      },
      async signIn(email, password) {
        return signedIn(await call(`${base}/auth/v1/token?grant_type=password`, { method: "POST", headers: headers(), body: JSON.stringify({ email, password }) }, "Supabase"));
      },
      async signOut() {
        await call(`${base}/auth/v1/logout`, { method: "POST", headers: headers() }, "Supabase").catch(() => undefined);
        saveSession("supabase", null);
      },
      user: () => loadSession<SupabaseSession>("supabase")?.user ?? null
    }
  };
};

// ---------------------------------------------------------------- Firebase (Firestore REST + Identity Toolkit)

type FirestoreDoc = { name: string; fields?: Record<string, { stringValue?: string; timestampValue?: string }>; createTime: string; updateTime: string };
type FirebaseSession = { idToken: string; user: User };

const firebaseAdapter = (values: Record<string, string>): Adapter => {
  const root = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(values.projectId)}/databases/(default)/documents`;
  const key = `key=${encodeURIComponent(values.apiKey)}`;
  const headers = () => {
    const session = loadSession<FirebaseSession>("firebase");
    return { "Content-Type": "application/json", ...(session ? { Authorization: `Bearer ${session.idToken}` } : {}) };
  };
  const toRecord = (doc: FirestoreDoc): Stored<Record<string, unknown>> => {
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(doc.fields?.json?.stringValue ?? "{}");
    } catch {
      // a document not written by this app
    }
    return { ...data, id: doc.name.split("/").pop() ?? "", createdAt: doc.createTime, updatedAt: doc.updateTime };
  };
  const owner = () => loadSession<FirebaseSession>("firebase")?.user.id ?? "";
  const body = (data: Record<string, unknown>) => JSON.stringify({ fields: { json: { stringValue: JSON.stringify(strip(data)) }, owner: { stringValue: owner() } } });
  const identity = async (path: string, email: string, password: string): Promise<User> => {
    const result = await call<{ idToken: string; localId: string; email: string }>(
      `https://identitytoolkit.googleapis.com/v1/accounts:${path}?${key}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) },
      "Firebase"
    );
    const user = { id: result.localId, email: result.email };
    saveSession("firebase", { idToken: result.idToken, user });
    return user;
  };
  return {
    async list(collection) {
      const result = await call<{ documents?: FirestoreDoc[] }>(`${root}/${encodeURIComponent(collection)}?pageSize=300&${key}`, { headers: headers() }, "Firebase");
      return (result?.documents ?? []).map(toRecord).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async get(collection, id) {
      try {
        return toRecord(await call<FirestoreDoc>(`${root}/${encodeURIComponent(collection)}/${encodeURIComponent(id)}?${key}`, { headers: headers() }, "Firebase"));
      } catch (error) {
        if (error instanceof DbError && error.status === 404) return null;
        throw error;
      }
    },
    async add(collection, data) {
      return toRecord(await call<FirestoreDoc>(`${root}/${encodeURIComponent(collection)}?${key}`, { method: "POST", headers: headers(), body: body(data) }, "Firebase"));
    },
    async update(collection, id, patch) {
      const current = await this.get(collection, id);
      if (!current) throw new DbError("That record is not there any more.", 404);
      return toRecord(
        await call<FirestoreDoc>(
          `${root}/${encodeURIComponent(collection)}/${encodeURIComponent(id)}?updateMask.fieldPaths=json&updateMask.fieldPaths=owner&${key}`,
          { method: "PATCH", headers: headers(), body: body({ ...current, ...patch }) },
          "Firebase"
        )
      );
    },
    async remove(collection, id) {
      await call(`${root}/${encodeURIComponent(collection)}/${encodeURIComponent(id)}?${key}`, { method: "DELETE", headers: headers() }, "Firebase");
    },
    async ping() {
      await call(`${root}/ab_ping?pageSize=1&${key}`, { headers: headers() }, "Firebase");
      return "Connected to Firestore.";
    },
    auth: {
      signUp: (email, password) => identity("signUp", email, password),
      signIn: (email, password) => identity("signInWithPassword", email, password),
      async signOut() {
        saveSession("firebase", null);
      },
      user: () => loadSession<FirebaseSession>("firebase")?.user ?? null
    }
  };
};

// ---------------------------------------------------------------- PocketBase

type PbRecord = { id: string; collection: string; data: Record<string, unknown> | null; created: string; updated: string };
type PbSession = { token: string; user: User };

const pocketbaseAdapter = (values: Record<string, string>): Adapter => {
  const base = values.url.replace(/\/+$/, "");
  const records = `${base}/api/collections/ab_records/records`;
  const headers = () => {
    const session = loadSession<PbSession>("pocketbase");
    return { "Content-Type": "application/json", ...(session ? { Authorization: session.token } : {}) };
  };
  const toRecord = (row: PbRecord): Stored<Record<string, unknown>> => ({ ...(row.data ?? {}), id: row.id, createdAt: row.created, updatedAt: row.updated });
  const owner = () => loadSession<PbSession>("pocketbase")?.user.id ?? "";
  const auth = async (email: string, password: string): Promise<User> => {
    const result = await call<{ token: string; record: { id: string; email: string } }>(
      `${base}/api/collections/users/auth-with-password`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identity: email, password }) },
      "PocketBase"
    );
    const user = { id: result.record.id, email: result.record.email };
    saveSession("pocketbase", { token: result.token, user });
    return user;
  };
  return {
    async list(collection) {
      const filter = encodeURIComponent(`collection='${collection.replace(/'/g, "")}'`);
      const result = await call<{ items: PbRecord[] }>(`${records}?filter=${filter}&sort=-created&perPage=500`, { headers: headers() }, "PocketBase");
      return result.items.map(toRecord);
    },
    async get(_collection, id) {
      try {
        return toRecord(await call<PbRecord>(`${records}/${encodeURIComponent(id)}`, { headers: headers() }, "PocketBase"));
      } catch (error) {
        if (error instanceof DbError && error.status === 404) return null;
        throw error;
      }
    },
    async add(collection, data) {
      return toRecord(await call<PbRecord>(records, { method: "POST", headers: headers(), body: JSON.stringify({ collection, data: strip(data), owner: owner() }) }, "PocketBase"));
    },
    async update(collection, id, patch) {
      const current = await this.get(collection, id);
      if (!current) throw new DbError("That record is not there any more.", 404);
      return toRecord(
        await call<PbRecord>(`${records}/${encodeURIComponent(id)}`, { method: "PATCH", headers: headers(), body: JSON.stringify({ data: { ...strip(current), ...strip(patch) } }) }, "PocketBase")
      );
    },
    async remove(_collection, id) {
      await call(`${records}/${encodeURIComponent(id)}`, { method: "DELETE", headers: headers() }, "PocketBase");
    },
    async ping() {
      await call(`${records}?perPage=1`, { headers: headers() }, "PocketBase");
      return "Connected to PocketBase and the ab_records collection is there.";
    },
    auth: {
      async signUp(email, password) {
        await call(`${base}/api/collections/users/records`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, passwordConfirm: password }) }, "PocketBase");
        return auth(email, password);
      },
      signIn: auth,
      async signOut() {
        saveSession("pocketbase", null);
      },
      user: () => loadSession<PbSession>("pocketbase")?.user ?? null
    }
  };
};

// ---------------------------------------------------------------- Appwrite

type AwDoc = { $id: string; collection: string; data: string; $createdAt: string; $updatedAt: string };

const appwriteAdapter = (values: Record<string, string>): Adapter => {
  const base = `${values.endpoint.replace(/\/+$/, "")}/databases/${encodeURIComponent(values.databaseId)}/collections/${encodeURIComponent(values.collectionId)}/documents`;
  const headers = { "Content-Type": "application/json", "X-Appwrite-Project": values.projectId };
  const toRecord = (doc: AwDoc): Stored<Record<string, unknown>> => {
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(doc.data ?? "{}");
    } catch {
      // not written by this app
    }
    return { ...data, id: doc.$id, createdAt: doc.$createdAt, updatedAt: doc.$updatedAt };
  };
  const query = (q: object) => `queries[]=${encodeURIComponent(JSON.stringify(q))}`;
  return {
    async list(collection) {
      const result = await call<{ documents: AwDoc[] }>(
        `${base}?${query({ method: "equal", attribute: "collection", values: [collection] })}&${query({ method: "orderDesc", attribute: "$createdAt" })}&${query({ method: "limit", values: [500] })}`,
        { headers },
        "Appwrite"
      );
      return result.documents.map(toRecord);
    },
    async get(_collection, id) {
      try {
        return toRecord(await call<AwDoc>(`${base}/${encodeURIComponent(id)}`, { headers }, "Appwrite"));
      } catch (error) {
        if (error instanceof DbError && error.status === 404) return null;
        throw error;
      }
    },
    async add(collection, data) {
      return toRecord(await call<AwDoc>(base, { method: "POST", headers, body: JSON.stringify({ documentId: "unique()", data: { collection, data: JSON.stringify(strip(data)) } }) }, "Appwrite"));
    },
    async update(collection, id, patch) {
      const current = await this.get(collection, id);
      if (!current) throw new DbError("That record is not there any more.", 404);
      return toRecord(
        await call<AwDoc>(`${base}/${encodeURIComponent(id)}`, { method: "PATCH", headers, body: JSON.stringify({ data: { data: JSON.stringify({ ...strip(current), ...strip(patch) }) } }) }, "Appwrite")
      );
    },
    async remove(_collection, id) {
      await call(`${base}/${encodeURIComponent(id)}`, { method: "DELETE", headers }, "Appwrite");
    },
    async ping() {
      await call(`${base}?${query({ method: "limit", values: [1] })}`, { headers }, "Appwrite");
      return "Connected to Appwrite and the collection is there.";
    }
  };
};

// ---------------------------------------------------------------- your own REST API

const restAdapter = (values: Record<string, string>): Adapter => {
  const base = values.baseUrl.replace(/\/+$/, "");
  const headers = { "Content-Type": "application/json", ...(values.publicKey ? { "x-api-key": values.publicKey } : {}) };
  const toRecord = (row: Record<string, unknown>): Stored<Record<string, unknown>> => ({
    ...row,
    id: String(row.id ?? row._id ?? ""),
    createdAt: String(row.createdAt ?? row.created_at ?? ""),
    updatedAt: String(row.updatedAt ?? row.updated_at ?? "")
  });
  const unwrap = (body: unknown): Array<Record<string, unknown>> =>
    Array.isArray(body) ? body : Array.isArray((body as { data?: unknown })?.data) ? (body as { data: Array<Record<string, unknown>> }).data : [];
  return {
    async list(collection) {
      return unwrap(await call(`${base}/${encodeURIComponent(collection)}`, { headers }, "Your API")).map(toRecord);
    },
    async get(collection, id) {
      try {
        return toRecord(await call(`${base}/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`, { headers }, "Your API"));
      } catch (error) {
        if (error instanceof DbError && error.status === 404) return null;
        throw error;
      }
    },
    async add(collection, data) {
      return toRecord(await call(`${base}/${encodeURIComponent(collection)}`, { method: "POST", headers, body: JSON.stringify(strip(data)) }, "Your API"));
    },
    async update(collection, id, patch) {
      return toRecord(await call(`${base}/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`, { method: "PATCH", headers, body: JSON.stringify(strip(patch)) }, "Your API"));
    },
    async remove(collection, id) {
      await call(`${base}/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`, { method: "DELETE", headers }, "Your API");
    },
    async ping() {
      await call(`${base}/ab_ping`, { headers }, "Your API").catch((error) => {
        // Any answer from the server (even "no such collection") means it is reachable.
        if (error instanceof DbError && error.status) return null;
        throw error;
      });
      return "Your API answered.";
    }
  };
};

export const makeAdapter = (provider: PlatformId, values: Record<string, string>): Adapter => {
  switch (provider) {
    case "supabase":
      return supabaseAdapter(values);
    case "firebase":
      return firebaseAdapter(values);
    case "pocketbase":
      return pocketbaseAdapter(values);
    case "appwrite":
      return appwriteAdapter(values);
    case "rest":
      return restAdapter(values);
    default:
      return localAdapter();
  }
};
