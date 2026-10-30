# Deploying Aloud

Everything fits on free plans.

| Service | Runs | Config |
|---|---|---|
| Render (free web service) | API and worker in one container (`RUN_WORKER=1`) | `render.yaml`, `Dockerfile` |
| Vercel | Web app and widget (`apps/web`) | `apps/web/vercel.json` |
| TiDB Cloud Starter (formerly Serverless) | MySQL-compatible database, TLS only | `DATABASE_URL` |
| Upstash | Redis for the BullMQ queue, TLS (`rediss://`) | `REDIS_URL` |

Put the three backends in one region. `render.yaml` uses `region: oregon`, which is AWS us-west-2 on TiDB and Upstash. Order matters: the API needs the database and Redis URLs, the web app needs the API URL and a key, and CORS needs the web app's URL.

## Environment variables (Render)

| Variable | Required | Secret | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | yes | `mysql://<user>:<password>@<host>:4000/aloud`. URL-encode the password. The migration creates the database. |
| `REDIS_URL` | yes | yes | Upstash `rediss://default:<password>@<host>:6379` |
| `WEB_ORIGIN` | yes | no | Exact Vercel origin, no trailing slash. The only origin CORS allows. |
| `DATABASE_SSL` | yes on TiDB | no | `1` turns on verified TLS. Same as `?ssl=true` in the URL. Set in `render.yaml`. |
| `NODE_ENV`, `RUN_WORKER`, `TRUST_PROXY`, `REDIS_PREFIX` | set | no | `production`, `1`, `1`, `aloud` in `render.yaml` |
| `GEMINI_API_KEY` | no | yes | Without it, audits only replay recorded answers. |
| `SERPAPI_KEY` | no | yes | Without it, only saved listings can be audited. |
| `GEMINI_MODEL`, `GEMINI_RPM` | no | no | `gemini-3.5-flash-lite`, `10` |
| `DEMO_READONLY` | no | no | `1` holds keyed requests to saved listings (see below). `render.yaml` sets `0`. |
| `PUBLIC_RATE_LIMIT`, `PUBLIC_RATE_WINDOW_SEC`, `PUBLIC_EMAIL_LIMIT` | no | no | Widget limits per IP: `5` audits per `3600` seconds, `10` emails |
| `PUBLIC_LIVE` | no | no | `1` lets the widget audit any ASIN live (see below). Default `0`; `render.yaml` sets `1`. |
| `PUBLIC_LIVE_DAILY_LIMIT` | no | no | Live widget audits per UTC day, for everyone together. Default `25`. |
| `RETRY_BACKOFF_MS` | no | no | Retry backoff for failed audits, `10000` |
| `AUDIT_WEBHOOK_URL`, `AUDIT_WEBHOOK_SECRET` | no | secret: yes | Signed `audit.completed` / `audit.failed` webhooks. The URL needs the secret. |
| `PORT` | no | no | Render sets it. Don't override. |
| `API_KEY_DEV` | never in production | | Ignored when `NODE_ENV=production`, so a leftover setting can't enable a well-known key. |

Vercel needs `VITE_API_URL` (the Render URL) and `VITE_API_KEY` (a key from `key:add`). Both are read at build time.

## 1. TiDB Cloud

1. Create a cluster on the Starter plan in AWS us-west-2.
2. Open **Connect**, choose **General**, click **Generate Password** and copy it (it's shown once).
3. Build `DATABASE_URL` from the host (like `gateway01.us-west-2.prod.aws.tidbcloud.com`), port `4000` and user (like `4AbCdEfGh.root`), with `/aloud` as the database.

TiDB refuses plain connections, so keep `DATABASE_SSL=1`. No CA file is needed. The schema uses no foreign keys, and the largest saved report is about 65 KB against TiDB's 6 MB row limit.

## 2. Upstash

1. Create a Redis database in AWS us-west-2.
2. Leave **Eviction** off. BullMQ needs `noeviction`, or queued jobs can disappear.
3. Copy the `rediss://` URL as `REDIS_URL`.

## 3. Render

1. **New > Blueprint**, connect the repo. Render reads `render.yaml` and proposes one free web service, `aloud-api`, built from the `Dockerfile`.
2. Fill in the `sync: false` values from the table. `WEB_ORIGIN` isn't known yet: use `http://localhost:5181` for now.
3. **Apply**. On start the container runs the migrations, then the API with the worker. The log ends with:

   ```
   migrations applied
   api listening on http://127.0.0.1:10000 with the worker
   no dev API key seeded (set API_KEY_DEV outside production to add one)
   ```

## 4. Create a production API key

Keys are stored as SHA-256 hashes and no dev key is seeded in production. After the first deploy has applied the migrations, run this from your machine against TiDB:

```sh
DATABASE_URL='mysql://<user>:<password>@<host>:4000/aloud' DATABASE_SSL=1 bun run key:add vercel-app
```

It prints the key (`ans_...`) once. An optional second argument sets requests per minute (default 120): `bun run key:add partner-x 30`. Use one key per integration so each can be removed alone: `DELETE FROM api_keys WHERE name = 'partner-x';`.

## 5. Vercel

1. Import the repo with **Root Directory** `apps/web`, and keep "Include files outside the root directory" on (the app imports `packages/contracts`).
2. Build settings come from `vercel.json`: install at the repo root with `bun install --frozen-lockfile`, build `bun run build`, output `dist`. If the log says `bun: command not found`, change the install command to `npm i -g bun@1.1 && cd ../.. && bun install --frozen-lockfile`.
3. Set `VITE_API_URL` and `VITE_API_KEY` for Production and deploy.

`vercel.json` also rewrites app routes to `index.html`, serves `/widget` as `widget.html`, adds security headers, blocks framing of the app, and allows the widget to be framed only by itself and salesduo.com.

**The key is in the app bundle.** Every `VITE_*` value ends up in the JavaScript, so anyone can read `VITE_API_KEY`. With `DEMO_READONLY=0` (the `render.yaml` default) that key can run live audits, spending SerpApi and Gemini quota, and its per-minute limit is the only cap. Set `DEMO_READONLY=1` to hold keyed requests to saved listings: `live` is forced off, pasted listings and `/v1/rescore` get `403 demo_readonly`, and bulk jobs take at most 10 ASINs. For real use, put the app behind a server-side proxy that adds `x-api-key`. The widget bundle carries no key.

**The widget audits any ASIN.** Saved products replay for free. With `PUBLIC_LIVE=1`, any other ASIN is fetched live with no competitors, so it costs exactly 1 SerpApi search. At most `PUBLIC_LIVE_DAILY_LIMIT` (25) of those run per UTC day; after that the widget gets `429 daily_limit` until midnight UTC. Saved products don't count, and the per-IP limit still applies. Competitors are compared only in the full app.

## 6. TRUST_PROXY and CORS

`TRUST_PROXY` is the number of proxies in front of the API. Render has one load balancer, so it's `1`, and the widget's per-IP limit sees the visitor's address. Unset, every visitor shares the load balancer's address and one limit. Don't use `true`: it trusts any `X-Forwarded-For` a client sends. The API reads `true` as 1 with a warning and refuses anything else that isn't a count.

Once Vercel is up, set `WEB_ORIGIN` on Render to the exact production origin (scheme and host, no path) and let it redeploy. Preview URLs aren't allowed.

## Free-tier limits

| Limit | What happens |
|---|---|
| Render sleeps after about 15 idle minutes and takes up to a minute to wake. 512 MB memory, ephemeral disk. | The first request is slow. The web app keeps polling for up to 15 minutes, so the report still arrives. Queued audits resume when the service wakes. New recordings in `fixtures/llm` are lost on restart. |
| Upstash has a monthly command allowance (500K at the time of writing). | An idle worker still polls Redis while awake. Fine while Render sleeps; an uptime pinger could use up the month. Then `/v1/health` and new audits return 503. |
| TiDB Starter has monthly storage and Request Unit allowances. | Far above this app's use. If exhausted, TiDB throttles and requests slow down or fail with 503. |
| Gemini free tier: about 10 requests a minute and 500 a day for Flash-Lite. | The worker keeps to `GEMINI_RPM`. When the daily quota runs out, the audit stays queued and retries just after midnight US Pacific. Without a key, unrecorded audits fail with `not_recorded`. |
| SerpApi free: 250 searches a month, 50 an hour. | Only live fetches use it. When searches run out, the live fetch fails, the job retries, then the audit ends `failed`. Saved listings keep working. The widget then says the check is busy. At 25 a day the widget alone could use the month in 10 days; `PUBLIC_LIVE_DAILY_LIMIT=8` stays within it. |

## Post-deploy checks

```sh
API=https://aloud-api.onrender.com; WEB=https://aloud.vercel.app; KEY=ans_...

curl -s -w ' %{http_code}\n' $API/v1/health                            # 200 {"ok":true,"db":true,"redis":true}
curl -s $API/v1/openapi.json | head -c 80; echo                        # "openapi":"3.1.0"
curl -s -o /dev/null -w '%{http_code}\n' $API/v1/audits                # 401 without a key

# Hero audit: 202, then status "done" and score 52 within a few seconds
ID=$(curl -s -X POST $API/v1/audits -H "x-api-key: $KEY" -H 'content-type: application/json' \
  -d '{"asin":"B0C9W8DD9S","source":"serpapi"}' | sed -E 's/.*"id":"([^"]+)".*/\1/')
sleep 5; curl -s $API/v1/audits/$ID -H "x-api-key: $KEY" | grep -oE '"(status|score)":("[a-z]+"|[0-9]+)'

# CORS: access-control-allow-origin should be $WEB
curl -s -o /dev/null -D - -X OPTIONS $API/v1/audits -H "Origin: $WEB" \
  -H 'Access-Control-Request-Method: POST' | grep -i access-control-allow-origin

# Widget endpoint, no key: 202 "queued". Six in an hour from one IP should give 429 on the sixth.
curl -s -X POST $API/v1/public/audits -H 'content-type: application/json' -d '{"asin":"B0C9W8DD9S"}'; echo

# Web routes, including a deep link: all 200
for p in / /audits/00000000-0000-0000-0000-000000000000 /bulk /integrations /widget.html /widget; do
  printf '%s %s\n' "$(curl -s -o /dev/null -w '%{http_code}' $WEB$p)" "$p"; done
```

Saved listings replay with the same scores on any OS, so a saved dataset listing such as `B09VD1Z3TK` (U Brands board) should score 84. With `DEMO_READONLY=1`, a `POST /v1/rescore` with the key should return `403` and `"code":"demo_readonly"`.
