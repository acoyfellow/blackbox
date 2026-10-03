import { z } from 'zod';
import recoveredSample from '../../samples/sample-recovered-landing.jsonl';
import wrongKeySample from '../../samples/sample-wrong-key.jsonl';
import {
  failureIndexFrom,
  MAX_UPLOAD_BYTES,
  parseRecording,
  redact,
  UPLOADS_PER_IP_PER_HOUR,
} from '../shared/recording';
import { GATEWAY, type JsonValue, NARRATOR_MODEL, narrationMessages, scoreSteps } from './clef';
import type { Env } from './env';
import {
  ensureSchema,
  listRecordings,
  loadRecording,
  recordUpload,
  saveRecording,
  uploadsInLastHour,
} from './store';

interface Sample {
  title: string;
  text: string;
}

export const SAMPLES = new Map<string, Sample>([
  ['sample-wrong-key', { title: 'Triage run: wrong key, two retries', text: wrongKeySample }],
  [
    'sample-recovered-landing',
    { title: 'Triage run: one retry, clean landing', text: recoveredSample },
  ],
]);

const idSchema = z.string().regex(/^[a-z0-9-]{3,64}$/);

const titleSchema = z.string().trim().min(1).max(120).catch('Untitled recording');

function json(body: JsonValue, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function ingest(env: Env, id: string, raw: string, title: string) {
  const redacted = redact(raw);
  const recording = parseRecording(redacted, title);

  if (!recording) return null;
  const scores = await scoreSteps(env.AI, recording.title, recording.steps);
  const failureIndex = failureIndexFrom(scores);
  await saveRecording(env.DB, env.LOGS, id, redacted, recording, scores, failureIndex);

  return { id, failureIndex, steps: recording.steps.length };
}

type Upload =
  | { ok: true; text: string; title: string }
  | { ok: false; status: number; error: string };

async function readUpload(request: Request): Promise<Upload> {
  const declared = request.headers.get('content-length');

  if (declared === null) return { ok: false, status: 411, error: 'content-length required' };

  if (Number(declared) > MAX_UPLOAD_BYTES)
    return { ok: false, status: 413, error: 'upload exceeds 5 MB' };
  const type = request.headers.get('content-type') ?? '';

  if (type.startsWith('multipart/form-data')) {
    const form = await request.formData();
    const file = form.get('file');

    if (!(file instanceof File)) return { ok: false, status: 422, error: 'missing file field' };

    if (file.size > MAX_UPLOAD_BYTES)
      return { ok: false, status: 413, error: 'upload exceeds 5 MB' };

    return {
      ok: true,
      text: await file.text(),
      title: titleSchema.parse(form.get('title') ?? file.name),
    };
  }

  const text = await request.text();

  if (new TextEncoder().encode(text).byteLength > MAX_UPLOAD_BYTES)
    return { ok: false, status: 413, error: 'upload exceeds 5 MB' };
  const url = new URL(request.url);

  return {
    ok: true,
    text,
    title: titleSchema.parse(url.searchParams.get('title') ?? 'Uploaded run'),
  };
}

async function handleUpload(request: Request, env: Env): Promise<Response> {
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const now = Date.now();

  if ((await uploadsInLastHour(env.DB, ip, now)) >= UPLOADS_PER_IP_PER_HOUR) {
    return json({ error: 'rate limit: 20 uploads per hour' }, 429);
  }

  const upload = await readUpload(request);

  if (!upload.ok) return json({ error: upload.error }, upload.status);
  await recordUpload(env.DB, ip, now);
  const id = crypto.randomUUID().slice(0, 12);
  const result = await ingest(env, id, upload.text, upload.title);

  if (!result) return json({ error: 'no Pi events or terrarium log found' }, 400);

  return json({ ...result, url: `/r/${id}` }, 201);
}

async function handleGet(env: Env, id: string): Promise<Response> {
  const existing = await loadRecording(env.DB, env.LOGS, id);

  if (existing) return json(existing);
  const sample = SAMPLES.get(id);

  if (!sample) return json({ error: 'not found' }, 404);
  await ingest(env, id, sample.text, sample.title);
  const seeded = await loadRecording(env.DB, env.LOGS, id);

  return seeded ? json(seeded) : json({ error: 'sample failed to load' }, 500);
}

async function handleNarrate(env: Env, id: string): Promise<Response> {
  const view = await loadRecording(env.DB, env.LOGS, id);

  if (!view) return json({ error: 'not found' }, 404);

  const stream = await env.AI.run(
    NARRATOR_MODEL,
    {
      messages: narrationMessages(view.title, view.steps, view.failureIndex),
      stream: true,
      max_tokens: 400,
    },
    GATEWAY,
  );

  if (!(stream instanceof ReadableStream)) return json({ error: 'narrator did not stream' }, 502);

  return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);

  if (parts[0] !== 'api') return json({ error: 'not found' }, 404);
  await ensureSchema(env.DB);

  if (parts[1] === 'recordings' && parts.length === 2) {
    if (request.method === 'POST') return handleUpload(request, env);
    const listed = await listRecordings(env.DB);

    return json({ recordings: listed, samples: [...SAMPLES.keys()] });
  }

  const id = idSchema.safeParse(parts[2]);

  if (parts[1] === 'recordings' && id.success) {
    if (parts[3] === 'narrate') return handleNarrate(env, id.data);

    if (parts.length === 3) return handleGet(env, id.data);
  }

  return json({ error: 'not found' }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (error) {
      console.error(
        'blackbox-core request failed',
        request.method,
        new URL(request.url).pathname,
        error,
      );

      return json({ error: 'internal error' }, 500);
    }
  },
};
