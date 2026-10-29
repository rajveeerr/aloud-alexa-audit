import { join } from "node:path";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";
import * as schema from "./schema";

export const DEFAULT_DATABASE_URL = "mysql://root:answerable@127.0.0.1:3317/answerable";

export type Db = MySql2Database<typeof schema>;

export type DbHandle = { db: Db; pool: mysql.Pool; close: () => Promise<void> };

/** Verified TLS, as hosted MySQL such as TiDB Cloud Serverless requires. */
export const TLS = { rejectUnauthorized: true, minVersion: "TLSv1.2" } as const;

const ON = new Set(["1", "true"]);

/**
 * Connection options for a DATABASE_URL. TLS is on when DATABASE_SSL=1 or the URL has ?ssl=true
 * (or ssl=1). That flag is taken out of the URL, since mysql2 only accepts an ssl object or a
 * profile name there. mysql2's own form, ?ssl={"rejectUnauthorized":true}, still passes through.
 * With neither, nothing changes, so the local compose MySQL keeps working over plain TCP.
 */
export function connectionOptions(
  url: string,
  env: Record<string, string | undefined> = process.env,
): { uri: string; ssl?: typeof TLS } {
  const u = new URL(url);
  const flag = u.searchParams.get("ssl");
  const inUrl = flag !== null && ON.has(flag.toLowerCase());
  if (inUrl) u.searchParams.delete("ssl");
  const tls = inUrl || ON.has((env.DATABASE_SSL ?? "").toLowerCase());
  return { uri: inUrl ? u.toString() : url, ...(tls && { ssl: TLS }) };
}

/** Times are stored and read as UTC so the server's own timezone never shifts them. */
export function connect(url = process.env.DATABASE_URL || DEFAULT_DATABASE_URL): DbHandle {
  const pool = mysql.createPool({ ...connectionOptions(url), timezone: "Z", connectionLimit: 10 });
  const db = drizzle(pool, { schema, mode: "default" });
  return { db, pool, close: () => pool.end() };
}

/** Creates the database named in the URL if it's missing. A fresh MySQL only has the default one. */
export function ensureDatabase(url: string): Promise<void> {
  return onServer(url, (name) => `CREATE DATABASE IF NOT EXISTS \`${name}\``);
}

/** For tests, which each get a throwaway database. */
export function dropDatabase(url: string): Promise<void> {
  return onServer(url, (name) => `DROP DATABASE IF EXISTS \`${name}\``);
}

/** Runs one statement about the URL's database on a connection that isn't inside it. */
async function onServer(url: string, sql: (name: string) => string): Promise<void> {
  const u = new URL(url);
  const name = decodeURIComponent(u.pathname.slice(1));
  // The name goes into SQL as is, so only plain identifiers are allowed.
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`Unexpected database name "${name}"`);
  u.pathname = "/";
  const conn = await mysql.createConnection(connectionOptions(u.toString()));
  try {
    await conn.query(sql(name));
  } finally {
    await conn.end();
  }
}

export const MIGRATIONS_DIR = join(import.meta.dir, "../drizzle");

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}
