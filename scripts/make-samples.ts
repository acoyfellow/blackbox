import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { redact } from '../src/shared/recording';

const KEEP = new Set(['session', 'tool_execution_start', 'tool_execution_end', 'message_end']);

const STRING_LIMIT = 1200;

const runsDir = new URL('../../odds/evals/northstar/runs/', import.meta.url).pathname;

const samples = [
  { id: 'sample-recovered-landing', source: '2026-10-02T17-06-22/odds.events.jsonl' },
  { id: 'sample-wrong-key', source: '2026-10-02T17-13-48/odds.events.jsonl' },
];

function shrink(value: z.core.util.JSONType): z.core.util.JSONType {
  const text = z.string().safeParse(value);

  if (text.success) return redact(text.data.slice(0, STRING_LIMIT));

  if (Array.isArray(value)) return value.slice(0, 40).map(shrink);

  const record = z.record(z.string(), z.json()).safeParse(value);

  if (record.success) {
    return Object.fromEntries(
      Object.entries(record.data)
        .filter(
          ([key]) =>
            key !== 'details' &&
            key !== 'nestedCalls' &&
            key !== 'sections' &&
            key !== 'provider' &&
            key !== 'api' &&
            key !== 'responseId',
        )
        .map(([key, inner]) => [key, inner === undefined ? null : shrink(inner)]),
    );
  }

  return value;
}

const typed = z.object({ type: z.string(), parentToolCallId: z.string().optional() }).loose();

mkdirSync(new URL('../samples/', import.meta.url).pathname, { recursive: true });

for (const sample of samples) {
  const lines = readFileSync(runsDir + sample.source, 'utf8').split('\n');
  const kept: string[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    const json = z.json().parse(JSON.parse(line));
    const event = typed.safeParse(json);

    if (!event.success || !KEEP.has(event.data.type) || event.data.parentToolCallId) continue;
    kept.push(JSON.stringify(shrink(json)));
  }

  const out = new URL(`../samples/${sample.id}.jsonl`, import.meta.url).pathname;
  writeFileSync(out, `${kept.join('\n')}\n`);
  console.log(sample.id, kept.length, 'events');
}
