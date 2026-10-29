# @answerable/web

Two pages, two bundles:

- `index.html`: the internal app (audits, reports, bulk, integration mockups). Uses the API key.
- `widget.html`: the homepage widget for salesduo.com. Only calls the public endpoints and carries
  no API key; a test builds the app and fails if the key turns up anywhere the widget loads.

## Run

```sh
cp apps/web/.env.example apps/web/.env.local   # VITE_API_URL, VITE_API_KEY=dev-key
bun run web                      # http://localhost:5180, widget at /widget.html
VITE_USE_MOCKS=1 bun run web     # no API needed: saved reports from the real pipeline
bun run web:build
```

`VITE_API_KEY` has no default in code; it comes only from env. Start the API with the same key
(`API_KEY_DEV=dev-key bun run dev`), and set the API's `WEB_ORIGIN` to the app's origin for CORS.

**The app's key is for internal or demo use only.** Every `VITE_*` value is inlined into the app's
JavaScript, so anyone who can load the app can read the key. In production, serve the app behind a
server-side proxy that adds `x-api-key` itself, and build without `VITE_API_KEY`. The widget
bundle never needs a key.

Mock reports are rebuilt from fixtures with `bun run --cwd apps/web mocks` (replay, no network).

## Tests

Unit tests (polling backoff, proof wording, the widget bundle check) run with the root `bun test`.

End to end, mock mode, no services needed:

```sh
bun run --cwd apps/web e2e
```

End to end against the real stack: web app → API → queue → worker → MySQL, with model calls
replayed from `fixtures/llm`:

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
