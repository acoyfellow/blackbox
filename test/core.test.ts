import { describe, expect, test } from 'bun:test';
import type { AiReply, ClefInput, NarratorInput } from '../src/worker/clef';
import type { D1Statement, Env, R2Object } from '../src/worker/env';
import core from '../src/worker/index';

const sample = await Bun.file(new URL('../samples/sample-wrong-key.jsonl', import.meta.url)).text();

function fakeEnv(stored: Map<string, string>, failAi = false): Env {
  const statement: D1Statement = {
    bind: () => statement,
    first: async () => ({ n: 0 }),
    all: async () => ({ results: [] }),
    run: async () => ({ success: true }),
  };

  const object = (value: string): R2Object => ({ text: async () => value });

  return {
    AI: {
      run: async (_model: string, input: ClefInput | NarratorInput): Promise<AiReply> => {
        if (failAi) throw new Error('secret upstream detail');

        if (!('questions' in input)) return {};

        const answers = Object.fromEntries(
          Object.keys(input.questions).map((key) => [key, { type: 'noul', noul: 0.1 }]),
        );

        return { answers };
      },
    },
    DB: { prepare: () => statement },
    LOGS: {
      put: async (key: string, value: string) => {
        stored.set(key, value);

        return object(value);
      },
      get: async (key: string) => {
        const value = stored.get(key);

        return value === undefined ? null : object(value);
      },
      delete: async (keys: string[]) => {
        for (const key of keys) stored.delete(key);
      },
    },
  };
}

function upload(body: string, headers: Record<string, string>) {
  return new Request('https://blackbox.test/api/recordings', { method: 'POST', body, headers });
}

describe('core upload safety', () => {
  test('raw log is stored redacted', async () => {
    const stored = new Map<string, string>();
    const body = `${sample}\n{"type":"note","path":"/Users/realname/secret","host":"db.corp"}`;

    const response = await core.fetch(
      upload(body, { 'content-length': String(body.length) }),
      fakeEnv(stored),
    );

    expect(response.status).toBe(201);
    const raw = [...stored].find(([key]) => key.startsWith('raw/'))?.[1] ?? '';
    expect(raw).not.toContain('/Users/realname');
    expect(raw).not.toContain('db.corp');
  });

  test('upload without content-length is refused', async () => {
    const response = await core.fetch(upload(sample, {}), fakeEnv(new Map()));
    expect(response.status).toBe(411);
  });

  test('internal errors do not leak messages', async () => {
    const response = await core.fetch(
      upload(sample, { 'content-length': String(sample.length) }),
      fakeEnv(new Map(), true),
    );

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('secret upstream detail');
  });

  test('path traversal ids are rejected', async () => {
    const response = await core.fetch(
      new Request('https://blackbox.test/api/recordings/..%2F..%2Fraw'),
      fakeEnv(new Map()),
    );

    expect(response.status).toBe(404);
  });
});
