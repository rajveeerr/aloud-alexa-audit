import { describe, expect, test } from "bun:test";
import mysql from "mysql2/promise";
import { connectionOptions, TLS } from "./client";

const LOCAL = "mysql://root:aloud@127.0.0.1:3317/aloud";
// The live TLS checks follow TEST_DATABASE_URL's host and port, like the other database tests, so
// they work wherever the test MySQL runs (CI services, a container, compose on this machine).
const LIVE = (() => {
  const u = new URL(process.env.TEST_DATABASE_URL || LOCAL);
  u.pathname = "/aloud";
  return u.toString();
})();

describe("connectionOptions", () => {
  test("a plain URL is left alone, with no TLS", () => {
    expect(connectionOptions(LOCAL, {})).toEqual({ uri: LOCAL });
    expect(connectionOptions(LOCAL, { DATABASE_SSL: "0" })).toEqual({ uri: LOCAL });
  });

  test("DATABASE_SSL=1 turns on verified TLS", () => {
    expect(connectionOptions(LOCAL, { DATABASE_SSL: "1" })).toEqual({ uri: LOCAL, ssl: TLS });
    expect(connectionOptions(LOCAL, { DATABASE_SSL: "true" }).ssl).toEqual(TLS);
    expect(TLS.rejectUnauthorized).toBe(true);
  });

  test("?ssl=true in the URL turns on TLS and is removed, keeping other parameters", () => {
    const url = "mysql://u.root:p%40ss@gateway01.eu-central-1.prod.aws.tidbcloud.com:4000/aloud?ssl=true&charset=utf8mb4";
    const o = connectionOptions(url, {});
    expect(o.ssl).toEqual(TLS);
    const u = new URL(o.uri);
    expect(u.searchParams.has("ssl")).toBe(false);
    expect(u.searchParams.get("charset")).toBe("utf8mb4");
    expect(u.hostname).toBe("gateway01.eu-central-1.prod.aws.tidbcloud.com");
    expect(decodeURIComponent(u.password)).toBe("p@ss");
    expect(connectionOptions(`${LOCAL}?ssl=1`, {})).toEqual({ uri: `${LOCAL}`, ssl: TLS });
  });

  test("mysql2's own ssl JSON in the URL passes through untouched", () => {
    const url = `${LOCAL}?ssl={"rejectUnauthorized":true}`;
    expect(connectionOptions(url, {})).toEqual({ uri: url });
  });
});

/** Against the compose MySQL, whose certificate is self-signed: proves TLS is really negotiated and verified. */
describe.skipIf(process.env.SKIP_INTEGRATION === "1")("TLS against the compose MySQL", () => {
  test("ssl=true verifies the certificate, so a self-signed one is refused", async () => {
    const err = await mysql.createConnection(connectionOptions(`${LIVE}?ssl=true`, {})).then(
      async (c) => {
        await c.end();
        return null;
      },
      (e: Error) => e,
    );
    expect(err).not.toBeNull();
    expect(String(err?.message)).toMatch(/certificate/i);
  });

  test("with verification off, the session is encrypted", async () => {
    const c = await mysql.createConnection({ ...connectionOptions(LIVE, {}), ssl: { rejectUnauthorized: false } });
    try {
      const [rows] = await c.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
      expect((rows as { Value: string }[])[0]?.Value).not.toBe("");
    } finally {
      await c.end();
    }
  });
});
