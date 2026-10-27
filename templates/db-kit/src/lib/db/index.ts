/**
 * The app's data, on whichever database it is connected to.
 *
 *   import { collection, useCollection, auth } from "./lib/db";
 *
 *   const tasks = collection<{ title: string; done: boolean }>("tasks");
 *   await tasks.add({ title: "Buy milk", done: false });
 *   const all = await tasks.list();             // newest first, each with id, createdAt, updatedAt
 *   await tasks.update(all[0].id, { done: true });
 *   await tasks.remove(all[0].id);
 *
 *   // In a component: the list, kept up to date, with loading and error.
 *   const { items, add, update, remove, loading, error } = useCollection<Task>("tasks");
 *
 * With nothing set up it saves in this browser, so the app works at once;
 * <DbStatusBar /> (in ./DbSetup) shows where data goes and opens the
 * "Connect a database" panel. Which database and its keys: see ./config.
 */
import { useCallback, useEffect, useState } from "react";

import { makeAdapter, DbError, type Adapter, type Stored, type User } from "./adapters";
import { loadConfig, type DbConfig } from "./config";
import { platform } from "./platforms";

export { DbError };
export type { Stored, User };

let config: DbConfig = loadConfig();
let adapter: Adapter = makeAdapter(config.provider, config.values);
const listeners = new Set<() => void>();

/** Re-reads the settings (after the setup panel saved new keys) and tells every useCollection to reload. */
export const reconnect = () => {
  config = loadConfig();
  adapter = makeAdapter(config.provider, config.values);
  listeners.forEach((listener) => listener());
};

/** Where data is going right now. */
export const dbInfo = () => ({
  provider: config.provider,
  name: platform(config.provider).name,
  source: config.source,
  /** True when nothing is set up and data stays in this browser. */
  browserOnly: config.provider === "local",
  canSignIn: Boolean(adapter.auth)
});

export interface Collection<T extends Record<string, unknown>> {
  list(): Promise<Array<Stored<T>>>;
  get(id: string): Promise<Stored<T> | null>;
  add(data: T): Promise<Stored<T>>;
  update(id: string, patch: Partial<T>): Promise<Stored<T>>;
  remove(id: string): Promise<void>;
}

const NAME = /^[a-z][a-z0-9_-]{0,62}$/i;

export const collection = <T extends Record<string, unknown>>(name: string): Collection<T> => {
  if (!NAME.test(name)) throw new DbError(`"${name}" is not a usable collection name: letters, digits, - and _, starting with a letter.`);
  return {
    list: () => adapter.list(name) as Promise<Array<Stored<T>>>,
    get: (id) => adapter.get(name, id) as Promise<Stored<T> | null>,
    add: (data) => adapter.add(name, data) as Promise<Stored<T>>,
    update: (id, patch) => adapter.update(name, id, patch) as Promise<Stored<T>>,
    remove: (id) => adapter.remove(name, id)
  };
};

/** Checks the current connection; resolves with what it found, rejects with what to fix. */
export const ping = () => adapter.ping();

const authChanged = new Set<(user: User | null) => void>();
const noAuth = () => new DbError(`${platform(config.provider).name} sign-in is not wired into this app; choose Supabase, Firebase or PocketBase for accounts.`);

/** Sign-in, on platforms that have it (local, Supabase, Firebase, PocketBase). */
export const auth = {
  available: () => Boolean(adapter.auth),
  user: (): User | null => adapter.auth?.user() ?? null,
  async signUp(email: string, password: string): Promise<User> {
    if (!adapter.auth) throw noAuth();
    const user = await adapter.auth.signUp(email.trim(), password);
    authChanged.forEach((cb) => cb(user));
    return user;
  },
  async signIn(email: string, password: string): Promise<User> {
    if (!adapter.auth) throw noAuth();
    const user = await adapter.auth.signIn(email.trim(), password);
    authChanged.forEach((cb) => cb(user));
    return user;
  },
  async signOut(): Promise<void> {
    await adapter.auth?.signOut();
    authChanged.forEach((cb) => cb(null));
  },
  onChange(cb: (user: User | null) => void): () => void {
    authChanged.add(cb);
    return () => authChanged.delete(cb);
  }
};

/** The signed-in person (null when signed out), kept up to date. */
export const useUser = (): User | null => {
  const [user, setUser] = useState<User | null>(() => auth.user());
  useEffect(() => auth.onChange(setUser), []);
  return user;
};

/** A collection as React state: loaded on mount, updated after each change, reloaded when the database changes. */
export const useCollection = <T extends Record<string, unknown>>(name: string) => {
  const [items, setItems] = useState<Array<Stored<T>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await collection<T>(name).list());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [name]);

  useEffect(() => {
    void reload();
    listeners.add(reload);
    return () => {
      listeners.delete(reload);
    };
  }, [reload]);

  const guard = async <R,>(run: () => Promise<R>): Promise<R | undefined> => {
    try {
      const result = await run();
      setError(null);
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return undefined;
    }
  };

  return {
    items,
    loading,
    error,
    reload,
    add: (data: T) =>
      guard(async () => {
        const row = await collection<T>(name).add(data);
        setItems((current) => [row, ...current]);
        return row;
      }),
    update: (id: string, patch: Partial<T>) =>
      guard(async () => {
        const row = await collection<T>(name).update(id, patch);
        setItems((current) => current.map((item) => (item.id === id ? row : item)));
        return row;
      }),
    remove: (id: string) =>
      guard(async () => {
        await collection<T>(name).remove(id);
        setItems((current) => current.filter((item) => item.id !== id));
      })
  };
};
