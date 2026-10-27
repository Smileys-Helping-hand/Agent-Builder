import { afterEach, describe, expect, it, vi } from "vitest";

import { makeAdapter } from "./adapters";
import { complete, envLines } from "./config";
import { collection, dbInfo } from "./index";
import { PLATFORMS } from "./platforms";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("the app's database (no setup: this browser)", () => {
  it("adds, lists newest first, updates and removes records", async () => {
    const tasks = collection<{ title: string; done: boolean }>("tasks");
    const first = await tasks.add({ title: "one", done: false });
    await new Promise((r) => setTimeout(r, 2));
    const second = await tasks.add({ title: "two", done: false });
    expect(first.id).toBeTruthy();
    expect((await tasks.list()).map((t) => t.title)).toEqual(["two", "one"]);
    const updated = await tasks.update(first.id, { done: true });
    expect(updated.done).toBe(true);
    expect(updated.title).toBe("one");
    await tasks.remove(second.id);
    expect((await tasks.list()).map((t) => t.title)).toEqual(["one"]);
    expect(await tasks.get(second.id)).toBeNull();
    expect(dbInfo().browserOnly).toBe(true);
  });

  it("refuses names that are not collection names", () => {
    expect(() => collection("../etc")).toThrow();
  });

  it("signs up, refuses a wrong password, signs in and out on this device", async () => {
    const local = makeAdapter("local", {});
    await local.auth!.signUp("A@b.co", "pass1234");
    expect(local.auth!.user()?.email).toBe("a@b.co");
    await local.auth!.signOut();
    await expect(local.auth!.signIn("a@b.co", "nope")).rejects.toThrow(/wrong/i);
    await local.auth!.signIn("a@b.co", "pass1234");
    expect(local.auth!.user()?.email).toBe("a@b.co");
  });
});

describe("keys and settings", () => {
  it("knows when a platform's keys are all there", () => {
    expect(complete("supabase", { url: "https://x.supabase.co" })).toBe(false);
    expect(complete("supabase", { url: "https://x.supabase.co", anonKey: "k" })).toBe(true);
    expect(complete("rest", { baseUrl: "https://api.x" })).toBe(true);
  });

  it("writes the .env.local lines for a choice", () => {
    expect(envLines("supabase", { url: "U", anonKey: "K" })).toBe("VITE_DB_PROVIDER=supabase\nVITE_SUPABASE_URL=U\nVITE_SUPABASE_ANON_KEY=K");
  });

  it("gives every platform its steps and an env name per key", () => {
    for (const p of PLATFORMS) {
      expect(p.steps.length).toBeGreaterThan(0);
      for (const f of p.fields) expect(f.env).toMatch(/^VITE_[A-Z_]+$/);
    }
  });
});

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("cloud platforms send the right requests", () => {
  it("Supabase: lists one collection from ab_records with the anon key", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(reply([{ id: "1", collection: "tasks", data: { title: "a" }, created_at: "t", updated_at: "t" }]));
    const rows = await makeAdapter("supabase", { url: "https://x.supabase.co/", anonKey: "anon" }).list("tasks");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://x.supabase.co/rest/v1/ab_records?collection=eq.tasks&select=*&order=created_at.desc&limit=1000");
    expect((init?.headers as Record<string, string>).apikey).toBe("anon");
    expect(rows).toEqual([{ title: "a", id: "1", createdAt: "t", updatedAt: "t" }]);
  });

  it("Supabase: a refused key becomes a sentence about the rules", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(reply({ message: "permission denied" }, 401));
    await expect(makeAdapter("supabase", { url: "https://x.supabase.co", anonKey: "a" }).list("tasks")).rejects.toThrow(/refused|rules/);
  });

  it("Firebase: stores the record as JSON in a document of the collection", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      reply({ name: "projects/p/databases/(default)/documents/tasks/abc", fields: { json: { stringValue: '{"title":"a"}' } }, createTime: "c", updateTime: "u" })
    );
    const row = await makeAdapter("firebase", { apiKey: "KEY", projectId: "p" }).add("tasks", { title: "a" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://firestore.googleapis.com/v1/projects/p/databases/(default)/documents/tasks?key=KEY");
    expect(JSON.parse(String(init?.body)).fields.json.stringValue).toBe('{"title":"a"}');
    expect(row).toEqual({ title: "a", id: "abc", createdAt: "c", updatedAt: "u" });
  });

  it("PocketBase: filters ab_records by collection", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(reply({ items: [] }));
    await makeAdapter("pocketbase", { url: "http://127.0.0.1:8090" }).list("tasks");
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://127.0.0.1:8090/api/collections/ab_records/records?filter=collection%3D'tasks'&sort=-created&perPage=500");
  });

  it("Your own API: plain REST on the collection", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(reply({ data: [{ _id: "9", title: "a" }] }));
    const rows = await makeAdapter("rest", { baseUrl: "https://api.x/v1/", publicKey: "pk" }).list("tasks");
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.x/v1/tasks");
    expect((fetchMock.mock.calls[0][1]?.headers as Record<string, string>)["x-api-key"]).toBe("pk");
    expect(rows[0].id).toBe("9");
  });
});
