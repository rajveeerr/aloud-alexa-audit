# @answerable/web

The audit app, bulk table, homepage widget and integration mockups.

## Run

```sh
bun run web                      # http://localhost:5180 against the API at http://localhost:4100
VITE_USE_MOCKS=1 bun run web     # no API needed: saved reports from the real pipeline
bun run web:build
```

Env: `VITE_API_URL` (default `http://localhost:4100`), `VITE_API_KEY` (default `dev-key`),
`VITE_USE_MOCKS=1` for mock mode. The API's `WEB_ORIGIN` must match the app's origin for CORS.

Mock reports are rebuilt from fixtures with `bun run --cwd apps/web mocks` (replay, no network).

## End-to-end tests

Mock mode, no services needed:

```sh
bun run --cwd apps/web e2e
```

Real stack: web app → API → queue → worker → MySQL, with model calls replayed from `fixtures/llm`:

```sh
bun run db:up                       # MySQL on 3317, Redis on 6389
bun run --cwd apps/web e2e:real
```

The real suite reuses an API already listening on 4100, or starts one with `bun run dev`
(`API_KEY_DEV=dev-key`, a raised widget limit). The app's dev server proxies `/v1` to the API, so
CORS doesn't apply. If you reuse your own API, start it with `API_KEY_DEV=dev-key` and a high
`PUBLIC_RATE_LIMIT`, since the widget allows 5 audits an hour per IP by default.

The real suite writes the screenshots in `e2e/screenshots`; the mock suite writes to
`test-results/mock-screenshots` (not committed).
