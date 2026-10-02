# BLACKBOX

A flight recorder for AI agent runs. You upload a Pi `--mode json` event log or a terrarium run log, and BLACKBOX replays it as a cockpit:

- A timeline you can scrub, with one waypoint per step. Tool calls are green, assistant turns are blue, errors are orange.
- Gauges for tool count, faults, the current step's fault risk, and leg duration, plus altimeters for cost and tokens.
- `@cf/cloudflare/clef`, called through AI Gateway `default`, answers "Is this the step where the run went wrong?" for every step. The step with the highest score is marked red, if its score is at least 0.5.
- A Workers AI model narrates the run in a calm pilot voice as streamed text.
- Each recording gets a shareable URL at `/r/<id>`. Raw and parsed logs are stored in R2 (`blackbox-logs`), and metadata in D1 (`blackbox`).

## Limits

Uploads are capped at 5 MB, and each IP can upload 20 times per hour.

## API

- `POST /api/recordings`: send a multipart `file` or a raw body. Returns `{ id, url, failureIndex }`.
- `GET /api/recordings/:id`: returns the recording view.
- `GET /api/recordings/:id/narrate`: streams the narration as SSE.

## Samples

`samples/` contains two real Pi runs, built by `bun run samples` from local odds northstar logs. Host names, paths, and provider fields are redacted.

- `sample-wrong-key`: two failed codemode calls before recovery.
- `sample-recovered-landing`: one failed call, then a clean landing.

## Develop

```
bun install
bun run verify
bun run build && wrangler dev
bun run deploy
```

## Deployment

Live at https://blackbox.coey.dev. Two Workers:

- `blackbox` (front, `wrangler.jsonc`): static UI, per-IP rate limits, and one service binding `CORE`. It proxies `/api/*` to the core.
- `blackbox-core` (`core/wrangler.jsonc`): AI, D1, R2. No routes, no workers.dev, no preview URLs.

Deploy with `bun run deploy`. It deploys the core first, then the front. Proof is in `receipts/002-coey-dev.json`.
