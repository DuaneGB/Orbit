import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { HttpError } from "./http.js";
import { SCHEMA_STATEMENTS, SCHEMA_VERSION } from "./schema.js";

type Sql = NeonQueryFunction<false, false>;
export type Row = Record<string, unknown>;

let client: Sql | null = null;
let schemaReady: Promise<void> | null = null;

/** Neon over HTTP. DATABASE_URL is set by Vercel's Neon integration. */
function connection(): Sql {
  if (client) return client;
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!url) throw new HttpError(503, "Orbit's database is not configured on the server.");
  client = neon(url);
  return client;
}

async function applySchema(sql: Sql): Promise<void> {
  const [table] = await sql.query("select to_regclass('orbit_schema') is not null as present");
  if (table?.present) {
    const [current] = await sql.query("select coalesce(max(version), 0) as version from orbit_schema");
    if (Number(current?.version) >= SCHEMA_VERSION) return;
  }
  // One transaction with an advisory lock, so two cold starts can't race.
  await sql.transaction([
    sql.query("select pg_advisory_xact_lock(7294117)"),
    ...SCHEMA_STATEMENTS.map((statement) => sql.query(statement)),
  ]);
  console.info(`Orbit database schema is at version ${SCHEMA_VERSION}.`);
}

async function ready(): Promise<Sql> {
  const sql = connection();
  if (!schemaReady) {
    schemaReady = applySchema(sql).catch((error) => {
      schemaReady = null; // retry on the next request
      throw error;
    });
  }
  await schemaReady;
  return sql;
}

/** Dates become ISO strings and bigints stay strings, so rows serialize predictably. */
function normalize(row: Row): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) out[key] = value instanceof Date ? value.toISOString() : value;
  return out;
}

/** Postgres error code (for example P0001 from `raise exception`), if any. */
export function pgCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

/** Runs one parameterised statement and returns its rows. Throws the raw database error. */
export async function rawQuery<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  const sql = await ready();
  const rows = await sql.query(text, params) as Row[];
  return rows.map(normalize) as T[];
}

/**
 * Runs one statement; on failure logs the detail server-side and throws a 500
 * that says what couldn't be done.
 */
export async function query<T = Row>(what: string, text: string, params: unknown[] = []): Promise<T[]> {
  try {
    return await rawQuery<T>(text, params);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error(`Database error: ${what}.`, error);
    throw new HttpError(500, `Could not ${what}.`);
  }
}

/** Like query(), but returns the first row or null. */
export async function queryOne<T = Row>(what: string, text: string, params: unknown[] = []): Promise<T | null> {
  return (await query<T>(what, text, params))[0] ?? null;
}

/** Serialises a value for a `$n::jsonb` parameter. */
export function jsonb(value: unknown): string {
  return JSON.stringify(value);
}
