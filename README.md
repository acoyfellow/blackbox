# BLACKBOX

BLACKBOX replays a Pi `--mode json` agent log as a step timeline and marks the step that the Clef model scores as the point where the run went wrong.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/acoyfellow/blackbox)

Live at https://blackbox.coey.dev.

![BLACKBOX upload page at 1440 px wide](docs/screenshot.png)

## How It Works

1. You upload a Pi `--mode json` log or a terrarium run log, up to 5 MB.
2. The front Worker `blackbox` checks the per-IP rate limit, then sends the request to the core Worker `blackbox-core` through a service binding.
3. The core replaces host names and `/Users/<name>` paths, then parses the events into steps: tool calls, assistant turns, and errors.
4. Cloudflare's Clef model `@cf/cloudflare/clef` on Workers AI, called through AI Gateway `default`, answers "Is this the step where the run went wrong?" for each step with a score from 0 to 1. The step with the highest score is marked red if its score is 0.5 or more.
5. The core writes the redacted raw log to R2 (`blackbox-logs`) and the steps and scores to D1 (`blackbox`), then returns a share URL `/r/<id>` and a one-time delete token. The id is 16 random bytes (128 bits) in base64url. Only a SHA-256 hash of the delete token is stored.
6. On the replay page, NARRATE streams a short summary from Meta's Llama 3.3 70B (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) on Workers AI over SSE. The page renders it as plain text.

## Evidence

- `receipts/001-first-deploy.json`: first deploy and the Clef scores for both samples.
- `receipts/002-coey-dev.json`: split into front and core Workers on `blackbox.coey.dev`.
- `receipts/003-marketing-pass.json`: live checks after this pass, including one upload, one read, and one narration.
- `receipts/004-deploy-button.json`: the root config deployed as `blackbox-buttontest` with fresh D1 and R2, one real upload, then teardown.
- `receipts/lighthouse-mobile.json`: Lighthouse mobile run against the live site.
- `findings.md`: what Clef marked on the two sample runs. On `sample-wrong-key` it marked step 2 (p=0.54), the decision to skip the docs, and not the two error steps that came after it.

## Limits and Costs

- Upload size: 5 MB per file. Uploads without a `content-length` header get 411.
- Rate limits per IP: 20 uploads per hour (D1 count), 5 uploads per minute, 5 narrations per minute, and 60 reads per minute (Workers rate limit bindings).
- Visibility: uploads are private by default. Anyone you give the share URL to can read the recording, and so can the site owner. `GET /api/recordings` returns only the bundled samples, never uploads. There is no login. Recordings uploaded before the 128-bit ids keep their old short ids and still open by URL.
- Retention: recordings have no expiry. The uploader can delete one with its delete token.
- Redaction covers host names and home folder paths only. Do not upload logs that contain secrets.
- Clef can mark the wrong step, and a score under 0.5 marks no step. The narrator can state wrong step numbers or causes.
- Cost: each upload runs Clef once per 64 steps, and each narration runs Llama 3.3 70B once on Workers AI. The site owner pays for both.

## Runbook

- Logs: both Workers set `observability.enabled`. Run `bunx wrangler tail blackbox-core` for core errors. Each failed request logs `blackbox-core request failed` with the method, path, and error. Clients get `{"error":"internal error"}` with status 500.
- Errors the core returns: 400 (no Pi events found), 404, 411 (no content-length), 413 (over 5 MB), 422 (no `file` field), 429 (rate limit), 500, 502 (narrator did not stream).
- Clef reply drift: a 500 on upload with `clef reply did not match schema` in the tail means the Clef output shape changed. Update `parseClefReply` in `src/worker/clef.ts`.
- Rate limit too tight or abused: edit `ratelimits` in `wrangler.prod.jsonc` and `UPLOADS_PER_IP_PER_HOUR` in `src/shared/recording.ts`, then `bun run deploy:prod`.
- Remove a recording without its token: delete `raw/<id>.log` and `parsed/<id>.json` in R2 bucket `blackbox-logs`, then `DELETE FROM recordings WHERE id = '<id>'` in D1 `blackbox`.
- Alerts: none are configured. Nothing pages anyone when errors rise. Check the Workers dashboard or `wrangler tail`.

## Self-host

Click the Deploy button, or run `cp wrangler-button.jsonc wrangler.jsonc && bun install && bun run deploy`. The button config is `wrangler-button.jsonc`: a single Worker (`src/standalone/index.ts`) that serves the UI and the API. It creates a D1 database and an R2 bucket in your account and binds Workers AI and three rate limits. Tables are created on the first request, so there are no migrations to run.

BLACKBOX needs no secrets. `vars.example` says so. If you add a secret later, set it with `bunx wrangler secret put NAME`.

The root config sets `workers_dev: true` because the button deploys into your own account and needs a URL. `.guardrailignore` lists `wrangler.jsonc` and `wrangler-button.jsonc` for that reason only: guardrail flags any public workers.dev Worker that has AI, D1, or R2 bindings. Anyone can upload, so the rate limits and your Workers AI quota are the only protection.

Production on `blackbox.coey.dev` uses two Workers: `wrangler.prod.jsonc` (front: rate limits and assets) and `core/wrangler.prod.jsonc` (core: AI, D1, R2). `bun run deploy:prod` deploys core first, then front.

## Develop Locally

```
git submodule update --init
bun install
bun run verify
bun run build
bunx wrangler dev
```

API:

- `POST /api/recordings`: send a multipart `file` field or a raw body. Returns `{ id, url, deleteToken, failureIndex, steps }`.
- `GET /api/recordings`: returns `{ samples }`, the bundled sample ids. Uploads are never listed.
- `DELETE /api/recordings/:id?token=<deleteToken>`: removes the D1 row and both R2 objects. A wrong token or unknown id returns 404.
- `GET /api/recordings/:id`: returns the recording view.
- `GET /api/recordings/:id/narrate`: streams the narration as SSE.

`samples/` contains two real Pi runs made by `bun run samples`, with host names, paths, and provider fields redacted.

`bun run verify` runs type checks, Biome, oxlint with the anti-slop rules (`tools/anti-slop` submodule), `scripts/copy-check.ts` (fails on banned copy phrases and the U+2192 arrow), and the tests.

## Stack

- Svelte 5, Tailwind CSS 4, Vite 8
- Cloudflare Workers (front and core), Workers AI, AI Gateway, D1, R2, Workers rate limit bindings
- Zod for every parse boundary
- Bun for tests and scripts

## License

MIT. See `LICENSE`.
