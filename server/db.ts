/**
 * Record layer over PostgreSQL — the interface the app used when its data lived
 * in a Google Sheet, so the rest of the server did not have to change.
 *
 * Every tab in `schema.ts` except Employees is a table named
 * `ta_da_<tab in snake_case>`. Columns are the tab's headers, all TEXT, because
 * the app already reads and writes everything as strings. `_row` is a serial
 * primary key standing in for the sheet's row number: it is stable, it orders
 * reads, and it is what `updateRow` / `clearRow` address.
 *
 * Tables are created, topped up with any new columns, and seeded on first use,
 * so a fresh database needs no manual setup. Nothing outside the `ta_da_`
 * tables is ever touched: this is a shared database.
 */

import pg from "pg";
import { TAB, TABS } from "./schema.js";

export type Row = Record<string, string>;

/** Tabs that live in the database. Employees stays in the sheet and is not one of them. */
export const DB_TABS = TABS.filter((t) => t.title !== "Employees");

const PREFIX = process.env.DB_TABLE_PREFIX || "ta_da_";

export function tableName(tab: string): string {
  return PREFIX + tab.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

/** Live count of queries, shown on /api/admin/stats. */
export const apiCalls = { reads: 0, writes: 0, retries: 0, queuedMs: 0, since: Date.now() };

export function resetApiCalls(): void {
  apiCalls.reads = 0;
  apiCalls.writes = 0;
  apiCalls.retries = 0;
  apiCalls.since = Date.now();
}

let pool: pg.Pool | null = null;

export function dbPool(): pg.Pool {
  if (pool) return pool;
  if (!process.env.DATABASE_URL && !process.env.PGHOST) {
    throw new Error("The database is not configured. Set DATABASE_URL.");
  }
  pool = new pg.Pool({
    ...(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {}),
    max: Number(process.env.PG_POOL_MAX) || 5,
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 15_000,
    // Azure Database for PostgreSQL requires TLS.
    ssl: String(process.env.PGSSLMODE || "").toLowerCase() === "disable" ? false : { rejectUnauthorized: false },
  });
  pool.on("error", (err) => console.warn("[db] idle client error:", err.message));
  return pool;
}

/** Lets tests hand in a pool-shaped object instead of a real connection. */
export function useDbPool(p: pg.Pool): void {
  pool = p;
  ready = null;
}

let ready: Promise<void> | null = null;

/** Creates missing tables and columns and seeds empty tables, once per process. */
function ensureSchema(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const db = dbPool();
      for (const spec of DB_TABS) {
        const t = q(tableName(spec.title));
        await db.query(`CREATE TABLE IF NOT EXISTS ${t} ("_row" BIGSERIAL PRIMARY KEY)`);
        for (const h of spec.headers) {
          await db.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS ${q(h)} TEXT NOT NULL DEFAULT ''`);
        }
        if (spec.seed?.length) {
          const { rows } = await db.query(`SELECT 1 FROM ${t} LIMIT 1`);
          if (!rows.length) {
            await insertMany(db, spec.title, spec.seed.map((r) => Object.fromEntries(spec.headers.map((h, i) => [h, String(r[i] ?? "")]))));
          }
        }
      }
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

/** Makes sure the schema exists; exposed for the setup script. */
export const initDatabase = ensureSchema;

function spec(tab: string) {
  const s = TAB[tab];
  if (!s || s.title === "Employees") throw new Error(`"${tab}" is not a database table.`);
  return s;
}

export async function getHeaders(tab: string): Promise<string[]> {
  return spec(tab).headers;
}

const out = (r: Record<string, unknown>, headers: string[]): Row & { _row: string } => {
  const rec: Row & { _row: string } = { _row: String(r._row) };
  for (const h of headers) rec[h] = r[h] === null || r[h] === undefined ? "" : String(r[h]);
  return rec;
};

type Queryable = Pick<pg.Pool, "query">;

async function insertMany(db: Queryable, tab: string, records: Row[]): Promise<number[]> {
  const { headers } = spec(tab);
  const ids: number[] = [];
  const cols = headers.map(q).join(", ");
  // Chunked so a large import stays under Postgres's 65,535-parameter limit.
  const perChunk = Math.max(1, Math.floor(60_000 / headers.length));
  for (let i = 0; i < records.length; i += perChunk) {
    const chunk = records.slice(i, i + perChunk);
    const params: string[] = [];
    const tuples = chunk.map((rec, ri) => {
      const ph = headers.map((h, ci) => {
        params.push(rec[h] === undefined || rec[h] === null ? "" : String(rec[h]));
        return `$${ri * headers.length + ci + 1}`;
      });
      return `(${ph.join(", ")})`;
    });
    const res = await db.query(
      `INSERT INTO ${q(tableName(tab))} (${cols}) VALUES ${tuples.join(", ")} RETURNING "_row"`,
      params,
    );
    ids.push(...res.rows.map((r) => Number(r._row)));
  }
  return ids;
}

/** Reads every row of a tab as objects, oldest first. `_row` is the row's id. */
export async function readTab(tab: string): Promise<(Row & { _row: string })[]> {
  await ensureSchema();
  const { headers } = spec(tab);
  apiCalls.reads += 1;
  const res = await dbPool().query(`SELECT * FROM ${q(tableName(tab))} ORDER BY "_row"`);
  return res.rows.map((r) => out(r, headers));
}

export async function readTabs(tabs: string[]): Promise<Record<string, (Row & { _row: string })[]>> {
  const entries = await Promise.all(tabs.map(async (t) => [t, await readTab(t)] as const));
  return Object.fromEntries(entries);
}

/** Appends a row and returns its id. */
export async function appendRow(tab: string, record: Row): Promise<number> {
  await ensureSchema();
  apiCalls.writes += 1;
  const [id] = await insertMany(dbPool(), tab, [record]);
  return id;
}

export async function appendRows(tab: string, records: Row[]): Promise<void> {
  if (!records.length) return;
  await ensureSchema();
  apiCalls.writes += 1;
  await insertMany(dbPool(), tab, records);
}

async function updateOne(db: Queryable, tab: string, id: number | string, record: Row): Promise<void> {
  const { headers } = spec(tab);
  const sets = headers.map((h, i) => `${q(h)} = $${i + 1}`).join(", ");
  const values = headers.map((h) => (record[h] === undefined || record[h] === null ? "" : String(record[h])));
  await db.query(`UPDATE ${q(tableName(tab))} SET ${sets} WHERE "_row" = $${headers.length + 1}`, [...values, id]);
}

/** Overwrites an entire row with `record`. */
export async function updateRow(tab: string, id: number | string, record: Row): Promise<void> {
  await ensureSchema();
  apiCalls.writes += 1;
  await updateOne(dbPool(), tab, id, record);
}

/** Removes a row. */
export async function clearRow(tab: string, id: number | string): Promise<void> {
  await ensureSchema();
  spec(tab);
  apiCalls.writes += 1;
  await dbPool().query(`DELETE FROM ${q(tableName(tab))} WHERE "_row" = $1`, [id]);
}

/** Updates many rows of one tab in a single transaction. */
export async function updateRows(tab: string, updates: { row: number | string; record: Row }[]): Promise<void> {
  if (!updates.length) return;
  await ensureSchema();
  apiCalls.writes += 1;
  await inTransaction(async (c) => {
    for (const u of updates) await updateOne(c, tab, u.row, u.record);
  });
}

/** Replaces all rows of a tab in one transaction (used by admin config saves). */
export async function replaceTabRows(tab: string, records: Row[]): Promise<void> {
  await ensureSchema();
  spec(tab);
  apiCalls.writes += 1;
  await inTransaction(async (c) => {
    await c.query(`DELETE FROM ${q(tableName(tab))}`);
    await insertMany(c, tab, records);
  });
}

async function inTransaction<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await dbPool().connect();
  try {
    await c.query("BEGIN");
    const result = await fn(c);
    await c.query("COMMIT");
    return result;
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

/**
 * Serialises a critical section that reads and then writes based on what it
 * read — request-number allocation, most importantly. A promise chain orders
 * callers within one process; a Postgres advisory lock, held on its own
 * connection, orders them across serverless instances.
 */
let lockChain: Promise<unknown> = Promise.resolve();
const ADVISORY_KEY = 7_201_0001;

export function withSheetLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = async () => {
    await ensureSchema();
    const c = await dbPool().connect();
    try {
      await c.query("SELECT pg_advisory_lock($1)", [ADVISORY_KEY]);
      try {
        return await fn();
      } finally {
        await c.query("SELECT pg_advisory_unlock($1)", [ADVISORY_KEY]).catch(() => {});
      }
    } finally {
      c.release();
    }
  };
  const next = lockChain.then(run, run);
  lockChain = next.catch(() => undefined);
  return next;
}
