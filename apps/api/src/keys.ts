import { randomBytes } from "node:crypto";
import { ensureApiKey, type Db } from "@answerable/db";
import { hashKey } from "./auth";

/**
 * Makes a new random API key and stores only its hash. The key itself is returned once, for
 * whoever ran this to copy; it can't be read back from the database later.
 */
export async function createApiKey(db: Db, name: string, rateLimit?: number): Promise<string> {
  const key = `ans_${randomBytes(24).toString("base64url")}`;
  await ensureApiKey(db, { name, hash: hashKey(key), ...(rateLimit !== undefined && { rateLimit }) });
  return key;
}
