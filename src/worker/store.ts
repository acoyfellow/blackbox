import { z } from 'zod';
import {
  type Recording,
  type RecordingView,
  recordingSchema,
  type Score,
  scoreSchema,
} from '../shared/recording';
import type { D1Binding, R2Binding } from './env';

export const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS recordings (id TEXT PRIMARY KEY, title TEXT NOT NULL, format TEXT NOT NULL, model TEXT NOT NULL, steps INTEGER NOT NULL, created_at TEXT NOT NULL, failure_index INTEGER, scores TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS uploads (ip TEXT NOT NULL, at INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS uploads_ip_at ON uploads (ip, at)',
];

const rowSchema = z.object({
  id: z.string(),
  title: z.string(),
  format: z.string(),
  model: z.string(),
  steps: z.number(),
  created_at: z.string(),
  failure_index: z.number().nullable(),
  scores: z.string(),
});

const countSchema = z.object({ n: z.number() });

export async function ensureSchema(db: D1Binding): Promise<void> {
  for (const sql of SCHEMA) await db.prepare(sql).run();
}

export async function uploadsInLastHour(db: D1Binding, ip: string, now: number): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM uploads WHERE ip = ? AND at > ?')
    .bind(ip, now - 3_600_000)
    .first();

  return countSchema.parse(row).n;
}

export async function recordUpload(db: D1Binding, ip: string, now: number): Promise<void> {
  await db.prepare('INSERT INTO uploads (ip, at) VALUES (?, ?)').bind(ip, now).run();
}

export async function saveRecording(
  db: D1Binding,
  logs: R2Binding,
  id: string,
  raw: string,
  recording: Recording,
  scores: Score[],
  failureIndex: number | null,
): Promise<void> {
  await logs.put(`raw/${id}.log`, raw);
  await logs.put(`parsed/${id}.json`, JSON.stringify(recording));
  await db
    .prepare(
      'INSERT OR REPLACE INTO recordings (id, title, format, model, steps, created_at, failure_index, scores) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      id,
      recording.title,
      recording.format,
      recording.model,
      recording.steps.length,
      new Date().toISOString(),
      failureIndex,
      JSON.stringify(scores),
    )
    .run();
}

export async function loadRecording(
  db: D1Binding,
  logs: R2Binding,
  id: string,
): Promise<RecordingView | null> {
  const row = await db.prepare('SELECT * FROM recordings WHERE id = ?').bind(id).first();

  if (!row) return null;
  const meta = rowSchema.parse(row);
  const object = await logs.get(`parsed/${id}.json`);

  if (!object) return null;
  const recording = recordingSchema.parse(JSON.parse(await object.text()));

  return {
    ...recording,
    id: meta.id,
    createdAt: meta.created_at,
    failureIndex: meta.failure_index,
    scores: z.array(scoreSchema).parse(JSON.parse(meta.scores)),
  };
}

const listItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  model: z.string(),
  steps: z.number(),
  created_at: z.string(),
  failure_index: z.number().nullable(),
});

export async function listRecordings(db: D1Binding) {
  const { results } = await db
    .prepare(
      'SELECT id, title, model, steps, created_at, failure_index FROM recordings ORDER BY created_at DESC LIMIT 30',
    )
    .all();

  return z.array(listItemSchema).parse(results);
}
