import type { ServerConfig } from './config';

export type SqlParam = string | number | boolean | null | readonly unknown[] | Readonly<Record<string, unknown>>;

/**
 * The only database surface the API uses: parameterised SQL ($1, $2 …) and transactions.
 * Two drivers implement it with the same SQL: postgres.js against Supabase, PGlite for local runs.
 */
export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: readonly SqlParam[]): Promise<T[]>;
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

function toDriverParams(params: readonly SqlParam[]): unknown[] {
  // Arrays go through as Postgres arrays (`$1::text[]`). Plain objects become JSON text; jsonb arrays
  // are stringified by the caller and cast in SQL (`$3::text::jsonb`). The `::text` matters: postgres.js would
  // otherwise see a jsonb parameter and JSON-encode the string again, storing a JSON string instead of an array.
  return params.map((p) => (p !== null && typeof p === 'object' && !Array.isArray(p) ? JSON.stringify(p) : p));
}

let shared: Promise<Db> | null = null;

/** One pool per process (per warm serverless instance on Vercel). */
export function getDb(config: ServerConfig): Promise<Db> {
  shared ??= config.databaseUrl ? postgresDb(config.databaseUrl) : pgliteDb(config.pgliteDir);
  shared.catch(() => {
    shared = null;
  });
  return shared;
}

/**
 * Drops the shared pool and closes it in the background. Serverless hosts freeze the process between
 * requests, which silently kills idle sockets; the next query on such a socket would hang until the
 * function times out. Releasing the pool when no request is running means every burst starts fresh.
 */
export function releaseDb(): void {
  const current = shared;
  shared = null;
  void current?.then((db) => db.close()).catch(() => undefined);
}

async function postgresDb(url: string): Promise<Db> {
  const { default: postgres } = await import('postgres');
  const sql = postgres(url, {
    // No prepared statements, so the pooler never has to track them. Use the session pooler (5432): on the
    // transaction pooler (6543) queries queued behind each other on one connection can hang.
    prepare: false,
    max: Number(process.env['DB_POOL_MAX'] ?? 5),
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: url.includes('localhost') || url.includes('127.0.0.1') ? false : 'require',
    onnotice: () => undefined,
  });
  type Runner = { unsafe: (q: string, p: unknown[]) => Promise<unknown> };
  const wrap = (runner: Runner): Db => ({
    query: async <T>(text: string, params: readonly SqlParam[] = []) =>
      (await runner.unsafe(text, toDriverParams(params))) as T[],
    tx: <T>(fn: (db: Db) => Promise<T>) =>
      sql.begin((tx) => fn(wrap(tx as unknown as Runner))) as Promise<T>,
    close: () => sql.end({ timeout: 5 }),
  });
  return wrap(sql as unknown as Runner);
}

async function pgliteDb(dir: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { mkdirSync } = await import('node:fs');
  if (dir !== 'memory://') mkdirSync(dir, { recursive: true });
  const pg = await PGlite.create(dir);
  type Runner = { query: (q: string, p: unknown[]) => Promise<{ rows: unknown[] }> };
  const wrap = (runner: Runner, root: boolean): Db => ({
    query: async <T>(text: string, params: readonly SqlParam[] = []) =>
      (await runner.query(text, toDriverParams(params))).rows as T[],
    tx: <T>(fn: (db: Db) => Promise<T>) =>
      root ? pg.transaction((tx) => fn(wrap(tx as unknown as Runner, false))) : fn(wrap(runner, false)),
    close: () => (root ? pg.close() : Promise.resolve()),
  });
  return wrap(pg as unknown as Runner, true);
}
