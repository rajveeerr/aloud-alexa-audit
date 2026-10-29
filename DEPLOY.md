# Deploying answerable for $0

```
Vercel (apps/web: app + widget.html)  ──▶  Render free web service (Dockerfile: API + worker, RUN_WORKER=1)
                                              ├──▶ TiDB Cloud Starter (MySQL-compatible, TLS)
                                              └──▶ Upstash Redis (TLS, rediss://)
```

Everything below fits the free plans. Do the steps in order: the API needs the database and Redis
URLs, the web app needs the API's URL and a key, and the API needs the web app's URL for CORS.

You need: the repo on GitHub, and free accounts on TiDB Cloud, Upstash, Render and Vercel. Pick one
region for all three backends. Oregon on Render is AWS us-west-2, which TiDB and Upstash both offer.
`render.yaml` sets `region: oregon`; change it there if you pick another.

## 1. Try the image locally first (optional)

```sh
bun run db:up            # MySQL on 3317, Redis on 6389
bun run docker:build
bun run docker:run       # API + worker on http://localhost:4100, database answerable_docker
```

`NODE_ENV=production` is baked into the image, so `API_KEY_DEV` is never seeded there. Add a key
with `docker exec <container> bun apps/api/src/add-key.ts local` (see step 5).

## 2. TiDB Cloud (MySQL)

TiDB Cloud's free tier is called Starter (it used to be Serverless).

1. Create a cluster: TiDB Cloud console, **Create Cluster**, plan **Starter**, region AWS us-west-2
   (Oregon).
2. Open the cluster, click **Connect**, choose **Connect With: General**, and click
   **Generate Password**. Copy the password now; it isn't shown again.
3. Note the host (like `gateway01.us-west-2.prod.aws.tidbcloud.com`), the port (`4000`) and the
   user (like `4AbCdEfGh.root`).
4. Your `DATABASE_URL` is:

   ```
   mysql://4AbCdEfGh.root:<password>@gateway01.us-west-2.prod.aws.tidbcloud.com:4000/answerable
   ```

   URL-encode the password if it has characters such as `@`, `/` or `#`. The `answerable` database
   doesn't have to exist: the migration step creates it.

**TLS.** TiDB Cloud refuses plain connections. Set `DATABASE_SSL=1` (render.yaml already does), or
add `?ssl=true` to the URL. Either one turns on verified TLS (`rejectUnauthorized: true`, TLS 1.2 or
newer) in `packages/db`. No CA file is needed: the certificate chains to a public root that Bun
already trusts. Locally, leave both unset; the compose MySQL is plain TCP.

**Compatibility, checked against the schema:**

- No foreign keys are used, so TiDB's foreign key handling doesn't matter.
- The `json`, `enum`, `datetime(3)` and `serial` columns in `packages/db/drizzle` all work on TiDB.
- Row size: TiDB caps a single row at 6 MB (`txn-entry-size-limit`). The largest stored report from
  the saved listings is about 65 KB (`B09VD1Z3TK`, measured with `max(length(report))` on a local
  database holding audits of every saved listing). That's around 1% of the cap. Request bodies are
  capped at 256 KB by the API, so a pasted listing can't come close either.
- Auto-increment ids on TiDB are unique but not consecutive. Nothing depends on them being
  consecutive.

## 3. Upstash (Redis)

1. Upstash console, **Create Database**, type Redis, region AWS us-west-2 (Oregon).
2. Leave **Eviction** off. BullMQ needs Redis to keep every key (`noeviction`). With eviction on,
   queued jobs can disappear.
3. On the database page, copy the URL that starts with `rediss://` (the two s's mean TLS). It
   looks like:

   ```
   rediss://default:<password>@<name>-12345.upstash.io:6379
   ```

That's `REDIS_URL`. ioredis turns on TLS by itself for `rediss://`. The worker's connection already
uses `maxRetriesPerRequest: null`, as BullMQ requires, and the API's connection fails fast instead
(`apps/worker/src/queue.ts`, covered by `queue.test.ts`).

## 4. Render (API + worker)

1. Render dashboard, **New**, **Blueprint**, connect the GitHub repo. Render reads `render.yaml`
   and proposes one free web service, `answerable-api`, built from the root `Dockerfile`.
2. Render asks for each `sync: false` value:

   | Variable | Value | Secret? |
   |---|---|---|
   | `DATABASE_URL` | the TiDB URL from step 2 | yes |
   | `REDIS_URL` | the Upstash `rediss://` URL from step 3 | yes |
   | `WEB_ORIGIN` | the Vercel URL, like `https://answerable.vercel.app` (no trailing slash). Not known yet: put `http://localhost:5181` and fix it in step 7 | no |
   | `GEMINI_API_KEY` | blank for replay only (no model calls), or a key from AI Studio | yes |
   | `SERPAPI_KEY` | blank (saved listings only), or your SerpApi key | yes |
   | `AUDIT_WEBHOOK_URL` | blank unless you want the `audit.completed` webhook | no |
   | `AUDIT_WEBHOOK_SECRET` | blank, or a long random string if the URL is set | yes |

   The others have values in `render.yaml`: `NODE_ENV=production`, `RUN_WORKER=1`,
   `TRUST_PROXY=1`, `DATABASE_SSL=1`, `DEMO_READONLY=1`, the widget limits, `PUBLIC_LIVE=0`,
   `GEMINI_MODEL`, `GEMINI_RPM=10`. Don't set `PORT`; Render sets it and the API reads it.
3. **Apply**. The first build takes a few minutes. On start the container runs the migrations
   (creating the `answerable` database if needed), then the API with the worker. The logs should
   end with:

   ```
   migrations applied
   api listening on http://127.0.0.1:10000 with the worker
   no dev API key seeded (set API_KEY_DEV outside production to add one)
   ```

   The last line is expected. Production keys are added in step 5.
4. Note the service URL, like `https://answerable-api.onrender.com`.

**Keep these secret** (Render stores them; never put them in the repo or in a `VITE_*` variable):
`GEMINI_API_KEY`, `SERPAPI_KEY`, `DATABASE_URL`, `REDIS_URL`, `AUDIT_WEBHOOK_SECRET`, and every API
key you create. Don't set `API_KEY_DEV` on Render: with `NODE_ENV=production` it's ignored on
purpose, so a forgotten setting can't turn on a well-known key.

**TRUST_PROXY=1.** Render puts one load balancer in front of the service. With `TRUST_PROXY=1`,
Express takes the client's address from the last hop of `X-Forwarded-For`, so the widget's per-IP
limit counts visitors, not the load balancer. Leave it at a number: `true` would trust whatever
`X-Forwarded-For` a client sends and let anyone dodge the limit (the API reads `true` as 1 and
warns). Unset, every visitor would share the load balancer's address and one limit. Step 8 has a
check.

## 5. Add an API key for the web app

Keys are stored only as SHA-256 hashes, and `API_KEY_DEV` isn't seeded in production. Make one from
your machine, pointed at the TiDB database. Run it after the first Render deploy (which applied the
migrations), or run `bun run db:migrate` with the same two variables first:

```sh
DATABASE_URL='mysql://4AbCdEfGh.root:<password>@gateway01.us-west-2.prod.aws.tidbcloud.com:4000/answerable' \
DATABASE_SSL=1 \
bun run key:add vercel-app
```

It prints the key (`ans_...`) once; copy it. An optional second argument sets the key's limit in
requests a minute (default 120): `bun run key:add partner-x 30`. Run it again with another name for
each integration, so a key can be removed on its own:
`DELETE FROM api_keys WHERE name = 'partner-x';` in the TiDB SQL editor.

## 6. Vercel (web app and widget)

1. Vercel dashboard, **Add New**, **Project**, import the repo.
2. **Root Directory**: `apps/web`. Leave "Include files outside the root directory" on; the app
   imports `packages/contracts`.
3. Build settings come from `apps/web/vercel.json`: install `cd ../.. && bun install
   --frozen-lockfile` (the workspace install at the repo root), build `bun run build`
   (`tsc -b && vite build`), output `dist`. If a build log says `bun: command not found`, change
   the install command to `npm i -g bun@1.1 && cd ../.. && bun install --frozen-lockfile`.
4. Environment variables, for Production:

   | Variable | Value |
   |---|---|
   | `VITE_API_URL` | the Render URL, like `https://answerable-api.onrender.com` |
   | `VITE_API_KEY` | the key from step 5 |

   These are read at build time, so changing either one needs a redeploy.
5. **Deploy**, and note the URL, like `https://answerable.vercel.app`.

`vercel.json` also:

- sends every app route (`/`, `/audits`, `/audits/:id`, `/bulk`, `/integrations`, anything else)
  to `index.html`, so deep links and reloads work;
- serves `widget.html` as it is, and `/widget` as a short alias for it;
- adds `nosniff`, a referrer policy, HSTS and a permissions policy everywhere. The app can't be
  framed (`frame-ancestors 'none'`). The widget may be framed only by itself and salesduo.com;
  edit that header if it goes elsewhere;
- caches the hashed files in `/assets/` for a year.

**The key in the app bundle.** Every `VITE_*` value ends up in the app's JavaScript, so anyone who
opens the app can read `VITE_API_KEY`. That's why `render.yaml` turns on `DEMO_READONLY=1`. With it,
every keyed request is held to the saved listings: `live` is treated as `false` (no SerpApi
searches), pasted listings get `403 demo_readonly`, bulk jobs take at most 10 ASINs, and
`/v1/rescore` gets `403 demo_readonly`. Reads work as usual. In the app, the Integrations page's
"Send re-score" button shows the refusal message. The widget bundle carries no key at all (a test
checks the build). For real use, put the app behind a server-side proxy that adds `x-api-key`,
build without `VITE_API_KEY`, and set `DEMO_READONLY=0`.

## 7. Point CORS at the web app

Back in Render, set `WEB_ORIGIN` to the exact Vercel origin, like `https://answerable.vercel.app`
(scheme and host, no path, no trailing slash), and save. Render redeploys. CORS allows that one
origin only, so Vercel preview URLs (`answerable-git-<branch>-...vercel.app`) can't call the API.
Test on the production URL.

## 8. Post-deploy checks

```sh
API=https://answerable-api.onrender.com
WEB=https://answerable.vercel.app
KEY=ans_...   # from step 5
```

The first request after a quiet spell can take up to a minute while Render wakes the service.

```sh
# 1. Health: expect 200 and {"ok":true,"db":true,"redis":true}
curl -s -w '\n%{http_code}\n' $API/v1/health

# 2. The OpenAPI document: expect "openapi":"3.1.0"
curl -s $API/v1/openapi.json | head -c 120; echo

# 3. Saved listings: expect B0C9W8DD9S (Ddaowanx) among them
curl -s "$API/v1/listings?source=serpapi"; echo

# 4. The hero audit: expect 202, then status done and score 52 within a few seconds
ID=$(curl -s -X POST $API/v1/audits -H "x-api-key: $KEY" -H 'content-type: application/json' \
  -d '{"asin":"B0C9W8DD9S","source":"serpapi"}' | sed -E 's/.*"id":"([^"]+)".*/\1/')
echo $ID
sleep 5
curl -s $API/v1/audits/$ID -H "x-api-key: $KEY" | grep -oE '"(status|score)":("[a-z]+"|[0-9]+)' | head -2

# 5. The key is required: expect 401
curl -s -o /dev/null -w '%{http_code}\n' $API/v1/audits

# 6. Read-only demo: expect 403 and "code":"demo_readonly"
curl -s -X POST $API/v1/rescore -H "x-api-key: $KEY" -H 'content-type: application/json' \
  -d '{"asin":"B0C9W8DD9S","reason":"check"}'; echo

# 7. CORS: expect access-control-allow-origin: https://answerable.vercel.app
curl -s -o /dev/null -D - -X OPTIONS $API/v1/audits -H "Origin: $WEB" \
  -H 'Access-Control-Request-Method: POST' | grep -i access-control-allow-origin

# 8. The widget's endpoint, no key: expect 202 with "status":"queued"
curl -s -X POST $API/v1/public/audits -H 'content-type: application/json' -d '{"asin":"B0C9W8DD9S"}'; echo

# 9. Web routes: expect 200 for each, the deep link included
for p in / /audits /audits/00000000-0000-0000-0000-000000000000 /bulk /integrations /widget.html /widget; do
  printf '%s %s\n' "$(curl -s -o /dev/null -w '%{http_code}' $WEB$p)" "$p"; done

# 10. Security headers: expect nosniff, frame-ancestors 'none' on the app, salesduo.com on the widget
curl -sI $WEB/ | grep -iE 'x-content-type-options|content-security-policy|strict-transport'
curl -sI $WEB/widget.html | grep -i content-security-policy

# 11. The widget bundle has no API key: expect no output
for js in $(curl -s $WEB/widget.html | grep -oE '/assets/[^"]+\.js'); do curl -s $WEB$js | grep -o "$KEY"; done
```

Then in a browser: open `$WEB`, click the Ddaowanx product and wait for the report (score 52).
Open `$WEB/widget.html`, enter `B0C9W8DD9S`, and check that the result shows 52 with 3 gaps.

**TRUST_PROXY check (optional; uses up your own widget allowance for an hour).** Send 6 widget
audits from one machine. The 6th should be `429`, while a different network (a phone off Wi-Fi)
still gets `202`. If the 6th is still 202, the API isn't seeing client addresses.

```sh
for i in 1 2 3 4 5 6; do curl -s -o /dev/null -w '%{http_code}\n' -X POST $API/v1/public/audits \
  -H 'content-type: application/json' -d '{"asin":"B09YP9YYZG"}'; done
```

## Free-tier limits and what the demo does at each

Check each provider's pricing page; these numbers change.

| Limit | What happens |
|---|---|
| **Render free** sleeps after about 15 minutes with no requests, and takes up to a minute to wake. 750 instance hours a month. Ephemeral disk, 512 MB memory. | The first request after a sleep is slow. The web app keeps polling (with backoff, up to 15 minutes), so an audit page opened during a wake-up still gets its report. The worker sleeps too: queued audits continue once the service is awake. New model recordings written to `fixtures/llm` in the container are lost on every restart or redeploy. |
| **Upstash free** has a monthly command allowance (500K at the time of writing) and 256 MB. | An idle BullMQ worker still polls Redis, on the order of a thousand commands an hour while the service is awake. That's fine with Render sleeping when idle. Something keeping the service awake around the clock (an uptime pinger) could use up the month's allowance; then Redis calls fail, `/v1/health` answers 503 and new audits get 503. |
| **TiDB Starter** has monthly storage and Request Unit allowances, far above what this demo uses. | If they run out, TiDB throttles and requests slow down or fail with 503. |
| **Gemini free tier**: requests per minute and per day, per model. For Flash-Lite, roughly 10 a minute and 500 a day; check the AI Studio rate-limit page. | Without `GEMINI_API_KEY`, audits only replay recorded answers. A saved listing with recordings works at no cost, and anything else fails with `not_recorded` (the widget says "We can't audit this product yet. Try one of the example products."). With a key, the worker keeps to `GEMINI_RPM` by itself. When the daily quota is used up, the audit stays queued with a note and retries just after midnight US Pacific, when the quota resets. Free-tier prompts may be used by Google to improve its products; only public listing data is sent. |
| **SerpApi free**: 250 searches a month, 50 an hour. | Only used for live fetches, which need `SERPAPI_KEY`. `DEMO_READONLY=1` turns live off for keyed requests, and `PUBLIC_LIVE=0` keeps the widget on saved listings, so the deployed demo spends nothing. When searches run out, a live fetch fails, the job retries, and the audit ends `failed`. Saved listings keep working. |

## Known issue: some saved dataset listings fail in the Linux image

Running the image locally, all 5 saved SerpApi listings (the Ddaowanx hero included) audit with
their recorded scores. Only 10 of the 20 saved dataset listings do. The other 10 fail with
`not_recorded`, among them U Brands `B09VD1Z3TK`, which the e2e suite expects to score 84.

The cause: with no live search, `findCompetitors` (packages/pipeline/src/audit.ts) takes saved
competitors in the order `fsStores().listings.saved()` lists them, and that is `readdir` order. On
macOS (APFS) that order is fixed, and the recordings in `fixtures/llm` were made with it. On Linux it
comes out different, so some audits pick other competitors, build a brief prompt that was never
recorded, and fail in replay mode. Render's filesystem may give yet another order.

The proper fix is one line, sorting `saved()`, plus re-recording the affected model calls with a
Gemini key (`bun cli audit <asin> --source dataset --record` for each failing ASIN). Then check the
scores the tests and e2e expect. That is a quota decision, so it isn't done here. Until then, the
hero demo works. With `GEMINI_API_KEY` set on Render, the failing dataset audits record new answers
instead of failing, which costs quota and is lost on restart.
