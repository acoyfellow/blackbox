import { z } from 'zod';
import { type RecordingView, recordingViewSchema } from '../shared/recording';

const listSchema = z.object({
  recordings: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      model: z.string(),
      steps: z.number(),
      created_at: z.string(),
      failure_index: z.number().nullable(),
    }),
  ),
  samples: z.array(z.string()),
});
export type RecordingList = z.infer<typeof listSchema>;

const uploadSchema = z.object({ id: z.string(), url: z.string() });
const errorSchema = z.object({ error: z.string() });
const sseChunk = z.object({ response: z.string().nullish() }).loose();

async function parsed<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const body: unknown = await response.json();
  if (!response.ok) throw new Error(errorSchema.safeParse(body).data?.error ?? response.statusText);
  return schema.parse(body);
}

export async function fetchList(): Promise<RecordingList> {
  return parsed(await fetch('/api/recordings'), listSchema);
}

export async function fetchRecording(id: string): Promise<RecordingView> {
  return parsed(await fetch(`/api/recordings/${id}`), recordingViewSchema);
}

export async function uploadLog(file: File): Promise<string> {
  const form = new FormData();
  form.set('file', file);
  form.set('title', file.name);
  const result = await parsed(
    await fetch('/api/recordings', { method: 'POST', body: form }),
    uploadSchema,
  );
  return result.id;
}

export function sseTokens(buffer: string): { tokens: string[]; rest: string } {
  const lines = buffer.split('\n');
  const rest = lines.pop() ?? '';
  const tokens: string[] = [];
  for (const line of lines) {
    const data = line.startsWith('data:') ? line.slice(5).trim() : '';
    if (!data || data === '[DONE]') continue;
    const chunk = sseChunk.safeParse(safeJson(data));
    if (chunk.success && chunk.data.response) tokens.push(chunk.data.response);
  }
  return { tokens, rest };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export async function narrate(id: string, onToken: (token: string) => void): Promise<void> {
  const response = await fetch(`/api/recordings/${id}/narrate`);
  if (!response.ok || !response.body) throw new Error('narration unavailable');
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const next = sseTokens(buffer + value);
    buffer = next.rest;
    for (const token of next.tokens) onToken(token);
  }
}
