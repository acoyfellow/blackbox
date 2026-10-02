import { describe, expect, test } from 'bun:test';
import { sseTokens } from '../src/app/api';
import {
  failureIndexFrom,
  parsePiEvents,
  parseRecording,
  parseTerrariumLog,
  redact,
} from '../src/shared/recording';
import { clefPayload, parseClefReply } from '../src/worker/clef';

const wrongKey = await Bun.file(
  new URL('../samples/sample-wrong-key.jsonl', import.meta.url),
).text();
const recovered = await Bun.file(
  new URL('../samples/sample-recovered-landing.jsonl', import.meta.url),
).text();

describe('pi json parsing', () => {
  test('sample with retries has failing codemode steps', () => {
    const recording = parsePiEvents(wrongKey, 'wrong key');
    expect(recording).not.toBeNull();
    const tools = recording?.steps.filter((step) => step.kind === 'tool') ?? [];
    expect(tools.map((step) => step.isError)).toEqual([true, true, false, false]);
    expect(recording?.steps.every((step, index) => step.index === index)).toBe(true);
  });

  test('cost and tokens accumulate from usage', () => {
    const recording = parsePiEvents(recovered, 'recovered');
    const cost = recording?.steps.reduce((sum, step) => sum + step.costUsd, 0) ?? 0;
    expect(cost).toBeGreaterThan(0.05);
  });

  test('timeline is monotonic from zero', () => {
    const steps = parsePiEvents(wrongKey, 'x')?.steps ?? [];
    expect(steps[0]?.startMs).toBe(0);
    for (const step of steps) expect(step.endMs).toBeGreaterThanOrEqual(step.startMs);
  });

  test('garbage yields null', () => {
    expect(parseRecording('not a log\n{bad json', 'x')).toBeNull();
  });
});

describe('terrarium log parsing', () => {
  test('header and exit become phases', () => {
    const log =
      'terrarium 0.0.1\nrun: ter_x\nmodel: m1\nagent: pi -p\ntask: do it\n\nstartup-timeout\nexit: 143\n';
    const recording = parseTerrariumLog(log, 'fallback');
    expect(recording?.title).toBe('ter_x');
    expect(recording?.steps.at(-1)?.isError).toBe(true);
    expect(recording?.model).toBe('m1');
  });
});

describe('clef', () => {
  test('payload asks one noul question per step', () => {
    const steps = parsePiEvents(wrongKey, 'x')?.steps ?? [];
    const payload = clefPayload('x', steps, steps);
    expect(Object.keys(payload.questions)).toHaveLength(steps.length);
  });

  test('reply parsing accepts both shapes and rejects junk', () => {
    const answers = { step_0: { type: 'noul', noul: 0.2 } };
    expect(parseClefReply({ answers })).toEqual({ step_0: 0.2 });
    expect(parseClefReply({ result: { answers } })).toEqual({ step_0: 0.2 });
    expect(() => parseClefReply({ nope: 1 })).toThrow();
  });

  test('failure index picks the top score above half', () => {
    expect(
      failureIndexFrom([
        { index: 1, probability: 0.3 },
        { index: 3, probability: 0.9 },
      ]),
    ).toBe(3);
    expect(failureIndexFrom([{ index: 1, probability: 0.3 }])).toBeNull();
  });
});

describe('safety', () => {
  test('redacts internal hosts and home paths', () => {
    expect(redact('see foo.' + 'cloudflare.' + 'dev' + ' and /Users/someone/x')).toBe(
      'see redacted.host and /Users/pilot/x',
    );
  });

  test('samples contain no internal hostnames', () => {
    expect(`${wrongKey}${recovered}`).not.toMatch(/\.internal\b|\.corp\b|/Users\/[a-z]+\//);
  });

  test('sse parsing yields tokens and keeps partial lines', () => {
    const { tokens, rest } = sseTokens(
      'data: {"response":"Good"}\ndata: {"response":" day"}\ndata: {"resp',
    );
    expect(tokens.join('')).toBe('Good day');
    expect(rest).toBe('data: {"resp');
  });
});
