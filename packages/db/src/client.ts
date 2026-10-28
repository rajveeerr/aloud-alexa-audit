import { join } from "node:path";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";
import * as schema from "./schema";

export const DEFAULT_DATABASE_URL = "mysql://root:answerable@127.0.0.1:3317/answerable";

export type Db = MySql2Database<typeof schema>;

export type DbHandle = { db: Db; pool: mysql.Pool; close: () => Promise<void> };

/** Times are stored and read as UTC so the server's own timezone never shifts them. */
export function connect(url = process.env.DATABASE_URL || DEFAULT_DATABASE_URL): DbHandle {
  const pool = mysql.createPool({ uri: url, timezone: "Z", connectionLimit: 10 });
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
  const conn = await mysql.createConnection({ uri: u.toString() });
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
