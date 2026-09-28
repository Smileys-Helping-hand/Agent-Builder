/**
 * Sqlite - a thin adapter over Node's built-in `node:sqlite`, shaped like the
 * subset of the better-sqlite3 API this codebase used: exec, prepare (run /
 * get / all), pragma, and transaction.
 *
 * Built-in on purpose. better-sqlite3 is a native .node addon, and a native
 * addon cannot be embedded into the single-file executable the desktop app
 * ships its API as — verified the hard way: the packaged binary started and
 * died looking for a .node file inside its own snapshot. `node:sqlite` is part
 * of the runtime itself (Node 22.13+), so there is nothing to embed.
 */

type SqlValue = null | number | bigint | string | Uint8Array;

interface NodeStatementSync {
  run(...params: SqlValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: SqlValue[]): unknown;
  all(...params: SqlValue[]): unknown[];
}

interface NodeDatabaseSync {
  exec(sql: string): void;
  prepare(sql: string): NodeStatementSync;
  close(): void;
}

type NodeSqliteModule = { DatabaseSync: new (path: string) => NodeDatabaseSync };

export interface SqliteRunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface SqliteStatement {
  run(...params: unknown[]): SqliteRunResult;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  /** `pragma("journal_mode = WAL")` — the statement after the PRAGMA keyword. */
  pragma(statement: string): void;
  /** Wraps `fn` so each call runs in a transaction; nested calls use savepoints. */
  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R;
  close(): void;
}

let sqliteModule: NodeSqliteModule | null = null;

const loadSqlite = (): NodeSqliteModule => {
  if (sqliteModule) return sqliteModule;

  const getBuiltinModule = (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
  if (typeof getBuiltinModule !== "function") {
    throw new Error(`node:sqlite requires Node.js 22.13 or newer (running ${process.version}).`);
  }

  // node:sqlite announces itself with a one-time ExperimentalWarning on load.
  // Silence exactly that warning; anything else passes through untouched.
  const originalEmitWarning = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    const message = typeof warning === "string" ? warning : warning?.message;
    if (typeof message === "string" && message.includes("SQLite is an experimental feature")) return;
    return (originalEmitWarning as (...args: unknown[]) => void).call(process, warning, ...rest);
  }) as typeof process.emitWarning;

  try {
    const loaded = getBuiltinModule.call(process, "node:sqlite") as NodeSqliteModule | undefined;
    if (!loaded?.DatabaseSync) {
      throw new Error(`node:sqlite is unavailable in Node.js ${process.version}; Node 22.13 or newer is required.`);
    }
    sqliteModule = loaded;
    return loaded;
  } finally {
    process.emitWarning = originalEmitWarning;
  }
};

/**
 * node:sqlite binds only null, numbers, bigints, strings and byte arrays. The
 * legacy `sqlite3` driver (used by WorldMemory) silently coerced undefined and
 * booleans, so coerce them the same way here instead of failing at runtime.
 */
const toSqlValue = (value: unknown): SqlValue => {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "string" || value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  throw new TypeError(`Cannot bind a value of type ${typeof value} to an SQLite parameter.`);
};

const wrapStatement = (statement: NodeStatementSync): SqliteStatement => ({
  run: (...params) => {
    const result = statement.run(...params.map(toSqlValue));
    return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid };
  },
  get: (...params) => statement.get(...params.map(toSqlValue)),
  all: (...params) => statement.all(...params.map(toSqlValue))
});

export const openSqlite = (filePath: string): SqliteDatabase => {
  const { DatabaseSync } = loadSqlite();
  const db = new DatabaseSync(filePath);
  let depth = 0;

  return {
    exec: (sql) => db.exec(sql),
    prepare: (sql) => wrapStatement(db.prepare(sql)),
    pragma: (statement) => db.exec(`PRAGMA ${statement}`),
    close: () => db.close(),
    transaction:
      <A extends unknown[], R>(fn: (...args: A) => R) =>
      (...args: A): R => {
        const savepoint = `sp_${depth}`;
        db.exec(depth === 0 ? "BEGIN" : `SAVEPOINT ${savepoint}`);
        depth += 1;
        try {
          const result = fn(...args);
          depth -= 1;
          db.exec(depth === 0 ? "COMMIT" : `RELEASE ${savepoint}`);
          return result;
        } catch (error) {
          depth -= 1;
          db.exec(depth === 0 ? "ROLLBACK" : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
          throw error;
        }
      }
  };
};
