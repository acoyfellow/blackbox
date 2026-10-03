import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import type { AiReply, ClefInput, JsonValue, NarratorInput } from '../src/worker/clef';
import type { D1Binding, D1Statement, Env, R2Object } from '../src/worker/env';
import core from '../src/worker/index';

const sample = await Bun.file(new URL('../samples/sample-wrong-key.jsonl', import.meta.url)).text();

const jsonValue: z.ZodType<JsonValue> = z.json();

function sqliteBinding(database: Database): D1Binding {
  const statementFor = (sql: string, values: (string | number | null)[]): D1Statement => ({
    bind: (...next) => statementFor(sql, next),
    first: async () => jsonValue.parse(database.query(sql).get(...values) ?? null),
    all: async () => ({ results: z.array(jsonValue).parse(database.query(sql).all(...values)) }),
    run: async () => {
      database.query(sql).run(...values);

      return { success: true };
    },
  });

  return { prepare: (sql) => statementFor(sql, []) };
}

function liveEnv(objects: Map<string, string>): Env {
  const object = (value: string): R2Object => ({ text: async () => value });

  return {
    AI: {
      run: async (_model: string, input: ClefInput | NarratorInput): Promise<AiReply> => {
        if (!('questions' in input)) return {};

        const answers = Object.fromEntries(
          Object.keys(input.questions).map((key) => [key, { type: 'noul', noul: 0.1 }]),
        );

        return { answers };
      },
    },
    DB: sqliteBinding(new Database(':memory:')),
    LOGS: {
      put: async (key, value) => {
        objects.set(key, value);

        return object(value);
      },
      get: async (key) => {
        const value = objects.get(key);

        return value === undefined ? null : object(value);
      },
      delete: async (keys) => {
        for (const key of keys) objects.delete(key);
      },
    },
  };
}

const uploadReply = z.object({ id: z.string(), url: z.string(), deleteToken: z.string() });

const listReply = z.object({ samples: z.array(z.string()) }).strict();

async function uploadTo(env: Env) {
  const response = await core.fetch(
    new Request('https://blackbox.test/api/recordings', {
      method: 'POST',
      body: sample,
      headers: { 'content-length': String(sample.length) },
    }),
    env,
  );

  expect(response.status).toBe(201);

  return uploadReply.parse(await response.json());
}

const at = (path: string, method = 'GET') =>
  new Request(`https://blackbox.test${path}`, { method });

describe('private recordings', () => {
  test('upload id is 128-bit base64url', async () => {
    const reply = await uploadTo(liveEnv(new Map()));
    expect(reply.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(reply.url).toBe(`/r/${reply.id}`);
  });

  test('list never returns an uploaded id', async () => {
    const env = liveEnv(new Map());
    const reply = await uploadTo(env);
    const response = await core.fetch(at('/api/recordings'), env);
    const text = await response.text();
    expect(text).not.toContain(reply.id);
    expect(listReply.parse(JSON.parse(text)).samples).toEqual([
      'sample-wrong-key',
      'sample-recovered-landing',
    ]);
  });

  test('a random id returns 404', async () => {
    const env = liveEnv(new Map());
    await uploadTo(env);
    const response = await core.fetch(at('/api/recordings/Zx9Qp2Lm7Rt4Vb8Nc1Hd5w'), env);
    expect(response.status).toBe(404);
  });

  test('delete with token removes row and both objects', async () => {
    const objects = new Map<string, string>();
    const env = liveEnv(objects);
    const reply = await uploadTo(env);
    expect(objects.size).toBe(2);

    const wrong = await core.fetch(
      at(`/api/recordings/${reply.id}?token=${'A'.repeat(43)}`, 'DELETE'),
      env,
    );

    expect(wrong.status).toBe(404);
    expect(objects.size).toBe(2);

    const deleted = await core.fetch(
      at(`/api/recordings/${reply.id}?token=${reply.deleteToken}`, 'DELETE'),
      env,
    );

    expect(deleted.status).toBe(200);
    expect(objects.size).toBe(0);
    expect((await core.fetch(at(`/api/recordings/${reply.id}`), env)).status).toBe(404);

    const again = await core.fetch(
      at(`/api/recordings/${reply.id}?token=${reply.deleteToken}`, 'DELETE'),
      env,
    );

    expect(again.status).toBe(404);
  });

  test('token is not stored in plain text', async () => {
    const database = new Database(':memory:');
    const env = { ...liveEnv(new Map()), DB: sqliteBinding(database) };
    const reply = await uploadTo(env);
    const rows = JSON.stringify(database.query('SELECT * FROM delete_tokens').all());
    expect(rows).not.toContain(reply.deleteToken);
    expect(rows).toContain(reply.id);
  });
});
