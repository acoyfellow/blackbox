# BLACKBOX

BLACKBOX replays a Pi `--mode json` agent log as a step timeline and marks the step that the Clef model scores as the point where the run went wrong.

![BLACKBOX upload page at 1440 px wide](docs/screenshot.png)

Live at https://blackbox.coey.dev.

## How It Works

1. You upload a Pi `--mode json` log or a terrarium run log, up to 5 MB.
2. The front Worker `blackbox` checks the per-IP rate limit, then sends the request to the core Worker `blackbox-core` through a service binding.
3. The core replaces host names and `/Users/<name>` paths, then parses the events into steps: tool calls, assistant turns, and errors.
4. `@cf/cloudflare/clef`, called through AI Gateway `default`, answers "Is this the step where the run went wrong?" for each step with a score from 0 to 1. The step with the highest score is marked red if its score is 0.5 or more.
5. The core writes the raw log to R2 (`blackbox-logs`) and the steps and scores to D1 (`blackbox`), then returns a share URL `/r/<id>`.
6. On the replay page, NARRATE streams a short summary from `@cf/meta/llama-3.3-70b-instruct-fp8-fast` over SSE. The page renders it as plain text.

## Evidence

- `receipts/001-first-deploy.json`: first deploy and the Clef scores for both samples.
- `receipts/002-coey-dev.json`: split into front and core Workers on `blackbox.coey.dev`.
- `receipts/003-marketing-pass.json`: live checks after this pass, including one upload, one read, and one narration.
- `findings.md`: what Clef marked on the two sample runs. On `sample-wrong-key` it marked step 2 (p=0.54), the decision to skip the docs, and not the two error steps that came after it.

## Limits

- Upload size: 5 MB per file.
- Rate limits per IP: 20 uploads per hour (D1 count), 5 uploads per minute, 5 narrations per minute, and 60 reads per minute (Workers rate limit bindings).
- Visibility: anyone with a share URL can read the recording. The home page lists the 30 newest uploads. There is no login and no delete button.
- Retention: recordings have no expiry.
- Redaction covers host names and home folder paths only. Do not upload logs that contain secrets.
- Clef can mark the wrong step, and a score under 0.5 marks no step. The narrator can state wrong step numbers or causes.
- Cost: each upload runs Clef once per 64 steps, and each narration runs Llama 3.3 70B once on Workers AI. The site owner pays for both.

## Run It Yourself

```
bun install
bun run verify
bun run build
bunx wrangler dev
```

Deploy to your own account after you change `account_id`, the D1 `database_id`, and the route:

```
bun run deploy
```

`bun run deploy` builds the UI, deploys `blackbox-core` first, then deploys `blackbox`.

API:

- `POST /api/recordings`: send a multipart `file` field or a raw body. Returns `{ id, url, failureIndex, steps }`.
- `GET /api/recordings/:id`: returns the recording view.
- `GET /api/recordings/:id/narrate`: streams the narration as SSE.

`samples/` contains two real Pi runs made by `bun run samples`, with host names, paths, and provider fields redacted.

`bun run verify` runs type checks, Biome, the tests, and `scripts/copy-check.ts`, which fails on banned copy phrases and the U+2192 arrow.

## Stack

- Svelte 5, Tailwind CSS 4, Vite 8
- Cloudflare Workers (front and core), Workers AI, AI Gateway, D1, R2, Workers rate limit bindings
- Zod for every parse boundary
- Bun for tests and scripts
