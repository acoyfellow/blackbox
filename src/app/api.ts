import { z } from 'zod';
import { type RecordingView, recordingViewSchema } from '../shared/recording';

const listSchema = z.object({ samples: z.array(z.string()) });

export type RecordingList = z.infer<typeof listSchema>;

const uploadSchema = z.object({ id: z.string(), url: z.string(), deleteToken: z.string() });

export type UploadReceipt = z.infer<typeof uploadSchema>;

const errorSchema = z.object({ error: z.string() });

const tokenText = z.union([z.string(), z.number()]).transform(String);

const sseChunk = z
  .object({
    response: tokenText.nullish(),
    choices: z
      .array(z.object({ delta: z.object({ content: tokenText.nullish() }).loose() }).loose())
      .nullish(),
  })
  .loose();

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const errorCopy = new Map<number, string>([
  [
    400,
    'BLACKBOX found no Pi events or terrarium log lines in this file. Upload the output of pi --mode json.',
  ],
  [404, 'This recording does not exist. Check the share URL.'],
  [
    411,
    'The upload had no size header. Upload the file from this page or send it with curl -F file=@run.jsonl.',
  ],
  [413, 'This file is larger than 5 MB. Upload a smaller log.'],
  [422, 'The upload had no file field. Send the log as a multipart field named file.'],
  [
    429,
    'You reached the rate limit. Wait one minute and try again. Uploads are limited to 20 per hour.',
  ],
]);

export function friendlyError(error: Error | null): string {
  if (error instanceof ApiError) {
    return (
      errorCopy.get(error.status) ??
      'The server could not complete the request. Try again in a minute.'
    );
  }

  return 'The request did not complete. Check your connection and try again.';
}

async function parsed<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const body: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    throw new ApiError(
      response.status,
      errorSchema.safeParse(body).data?.error ?? response.statusText,
    );
  }

  const result = schema.safeParse(body);

  if (!result.success) throw new ApiError(502, 'unexpected response shape');

  return result.data;
}

export async function fetchList(): Promise<RecordingList> {
  return parsed(await fetch('/api/recordings'), listSchema);
}

export async function fetchRecording(id: string): Promise<RecordingView> {
  return parsed(await fetch(`/api/recordings/${id}`), recordingViewSchema);
}

export async function deleteUpload(receipt: UploadReceipt): Promise<void> {
  const token = encodeURIComponent(receipt.deleteToken);

  const response = await fetch(`/api/recordings/${receipt.id}?token=${token}`, {
    method: 'DELETE',
  });

  if (!response.ok) throw new ApiError(response.status, 'delete failed');
}

export async function uploadLog(file: File): Promise<UploadReceipt> {
  const form = new FormData();
  form.set('file', file);
  form.set('title', file.name);

  return parsed(await fetch('/api/recordings', { method: 'POST', body: form }), uploadSchema);
}

export interface SseBatch {
  tokens: string[];
  rest: string;
}

export function sseTokens(buffer: string): SseBatch {
  const lines = buffer.split('\n');
  const rest = lines.pop() ?? '';
  const tokens: string[] = [];

  for (const line of lines) {
    const data = line.startsWith('data:') ? line.slice(5).trim() : '';

    if (!data || data === '[DONE]') continue;
    const chunk = sseChunk.safeParse(safeJson(data));

    if (!chunk.success) continue;
    const text = chunk.data.choices?.[0]?.delta.content ?? chunk.data.response;

    if (text) tokens.push(text);
  }

  return { tokens, rest };
}

function safeJson(text: string): z.core.util.JSONType | undefined {
  try {
    return z.json().parse(JSON.parse(text));
  } catch {
    return undefined;
  }
}

export async function narrate(id: string, onToken: (token: string) => void): Promise<void> {
  const response = await fetch(`/api/recordings/${id}/narrate`);

  if (!response.ok || !response.body) throw new ApiError(response.status, 'narration unavailable');
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
