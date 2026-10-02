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
import { GATEWAY, NARRATOR_MODEL, narrationMessages, scoreSteps } from './clef';
import type { Env } from './env';
import {
  ensureSchema,
  listRecordings,
  loadRecording,
  recordUpload,
  saveRecording,
  uploadsInLastHour,
} from './store';

export const SAMPLES: Record<string, { title: string; text: string }> = {
  'sample-wrong-key': { title: 'Triage run: wrong key, two retries', text: wrongKeySample },
  'sample-recovered-landing': {
    title: 'Triage run: one retry, clean landing',
    text: recoveredSample,
  },
};

const idSchema = z.string().regex(/^[a-z0-9-]{3,64}$/);
const titleSchema = z.string().trim().min(1).max(120).catch('Untitled recording');

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function ingest(env: Env, id: string, raw: string, title: string) {
  const recording = parseRecording(redact(raw), title);
  if (!recording) return null;
  const scores = await scoreSteps(env.AI, recording.title, recording.steps);
  const failureIndex = failureIndexFrom(scores);
  await saveRecording(env.DB, env.LOGS, id, raw, recording, scores, failureIndex);
  return { id, failureIndex, steps: recording.steps.length };
}

async function readUpload(request: Request): Promise<{ text: string; title: string } | string> {
  const length = Number(request.headers.get('content-length') ?? '0');
  if (length > MAX_UPLOAD_BYTES) return 'upload exceeds 5 MB';
  const type = request.headers.get('content-type') ?? '';
  if (type.startsWith('multipart/form-data')) {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return 'missing file field';
    if (file.size > MAX_UPLOAD_BYTES) return 'upload exceeds 5 MB';
    return { text: await file.text(), title: titleSchema.parse(form.get('title') ?? file.name) };
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_UPLOAD_BYTES) return 'upload exceeds 5 MB';
  const url = new URL(request.url);
  return { text, title: titleSchema.parse(url.searchParams.get('title') ?? 'Uploaded run') };
}

async function handleUpload(request: Request, env: Env): Promise<Response> {
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const now = Date.now();
  if ((await uploadsInLastHour(env.DB, ip, now)) >= UPLOADS_PER_IP_PER_HOUR) {
    return json({ error: 'rate limit: 20 uploads per hour' }, 429);
  }
  const upload = await readUpload(request);
  if (typeof upload === 'string') return json({ error: upload }, 413);
  await recordUpload(env.DB, ip, now);
  const id = crypto.randomUUID().slice(0, 12);
  const result = await ingest(env, id, upload.text, upload.title);
  if (!result) return json({ error: 'no Pi events or terrarium log found' }, 400);
  return json({ ...result, url: `/r/${id}` }, 201);
}

async function handleGet(env: Env, id: string): Promise<Response> {
  const existing = await loadRecording(env.DB, env.LOGS, id);
  if (existing) return json(existing);
  const sample = SAMPLES[id];
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
    return json({ recordings: listed, samples: Object.keys(SAMPLES) });
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
      const message = error instanceof Error ? error.message : 'unknown error';
      return json({ error: message }, 500);
    }
  },
};
