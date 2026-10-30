#!/usr/bin/env bun
/**
 * bun run key:add <name> [requests-per-minute]: adds an API key to the database in DATABASE_URL
 * and prints it once. This is how a production deploy gets a key, since API_KEY_DEV is never
 * seeded when NODE_ENV=production.
 */
import { connect, DEFAULT_DATABASE_URL } from "@aloud/db";
import { createApiKey } from "./keys";

const [name, perMinute] = process.argv.slice(2);
if (!name) {
  console.error("usage: bun run key:add <name> [requests-per-minute]");
  process.exit(1);
}
const rateLimit = perMinute === undefined ? undefined : Number(perMinute);
if (rateLimit !== undefined && !(Number.isInteger(rateLimit) && rateLimit > 0)) {
  console.error(`requests-per-minute must be a positive whole number, got "${perMinute}"`);
  process.exit(1);
}

const { db, close } = connect(process.env.DATABASE_URL || DEFAULT_DATABASE_URL);
try {
  const key = await createApiKey(db, name, rateLimit);
  console.error(`added API key "${name}". It is shown only this once:`);
  console.log(key);
} finally {
  await close();
}
