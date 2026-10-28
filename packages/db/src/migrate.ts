#!/usr/bin/env bun
/** bun run db:migrate: creates the database if needed and applies every migration in drizzle/. */
import { connect, DEFAULT_DATABASE_URL, ensureDatabase, runMigrations } from "./client";

const url = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
await ensureDatabase(url);
const { db, close } = connect(url);
await runMigrations(db);
await close();
console.log("migrations applied");
