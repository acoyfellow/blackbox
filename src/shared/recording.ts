import { z } from 'zod';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const UPLOADS_PER_IP_PER_HOUR = 20;
const SUMMARY_LIMIT = 600;

export const stepSchema = z.object({
  index: z.number().int().nonnegative(),
  kind: z.enum(['tool', 'assistant', 'user', 'system', 'phase']),
  name: z.string(),
  startMs: z.number(),
  endMs: z.number(),
  isError: z.boolean(),
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  costUsd: z.number().nonnegative(),
  summary: z.string(),
});
export type Step = z.infer<typeof stepSchema>;

export const recordingSchema = z.object({
  format: z.enum(['pi-json', 'terrarium']),
  title: z.string(),
  model: z.string(),
  steps: z.array(stepSchema),
});
export type Recording = z.infer<typeof recordingSchema>;

export const scoreSchema = z.object({
  index: z.number().int().nonnegative(),
  probability: z.number().min(0).max(1),
});
export type Score = z.infer<typeof scoreSchema>;

export const recordingViewSchema = recordingSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  scores: z.array(scoreSchema),
  failureIndex: z.number().int().nullable(),
});
export type RecordingView = z.infer<typeof recordingViewSchema>;

const usageSchema = z
  .object({
    input: z.number().optional(),
    output: z.number().optional(),
    cacheRead: z.number().optional(),
    cacheWrite: z.number().optional(),
    cost: z.object({ total: z.number().optional() }).partial().optional(),
  })
  .nullish();

const contentPartSchema = z.object({
  type: z.string(),
  text: z.string().optional(),
  thinking: z.string().optional(),
  name: z.string().optional(),
});

const messageSchema = z.object({
  role: z.string(),
  timestamp: z.number().optional(),
  model: z.string().nullish(),
  content: z.union([z.string(), z.array(contentPartSchema)]).optional(),
  usage: usageSchema,
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
  isError: z.boolean().optional(),
});

const piEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('session'), timestamp: z.string().optional() }),
  z.object({
    type: z.literal('tool_execution_start'),
    toolCallId: z.string(),
    toolName: z.string(),
    args: z.unknown().optional(),
    parentToolCallId: z.string().optional(),
  }),
  z.object({
    type: z.literal('tool_execution_end'),
    toolCallId: z.string(),
    toolName: z.string(),
    isError: z.boolean().optional(),
    result: z.unknown().optional(),
    parentToolCallId: z.string().optional(),
  }),
  z.object({ type: z.literal('message_end'), message: messageSchema }),
]);
type PiEvent = z.infer<typeof piEventSchema>;
type Message = z.infer<typeof messageSchema>;

export function clip(text: string, limit = SUMMARY_LIMIT): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value) ?? '';
}

function resultText(result: unknown): string {
  const parsed = z.object({ content: z.array(contentPartSchema) }).safeParse(result);
  if (!parsed.success) return stringify(result);
  return parsed.data.content.map((part) => part.text ?? '').join(' ');
}

function messageText(message: Message): string {
  if (typeof message.content === 'string') return message.content;
  return (message.content ?? [])
    .map((part) => part.text ?? part.thinking ?? (part.name ? `→ ${part.name}` : ''))
    .join(' ');
}

function parseJsonLines(text: string): PiEvent[] {
  const events: PiEvent[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    const json = z.json().safeParse(safeJson(trimmed));
    if (!json.success) continue;
    const event = piEventSchema.safeParse(json.data);
    if (event.success) events.push(event.data);
  }
  return events;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

interface OpenTool {
  name: string;
  startMs: number;
  args: string;
}

export function parsePiEvents(text: string, title: string): Recording | null {
  const events = parseJsonLines(text);
  const steps: Step[] = [];
  const open = new Map<string, OpenTool>();
  let clock = 0;
  let model = 'unknown';
  const push = (step: Omit<Step, 'index'>) => steps.push({ ...step, index: steps.length });

  for (const event of events) {
    if (event.type === 'session' && event.timestamp) {
      const parsed = Date.parse(event.timestamp);
      if (!Number.isNaN(parsed)) clock = parsed;
    }
    if (event.type === 'tool_execution_start' && !event.parentToolCallId) {
      open.set(event.toolCallId, {
        name: event.toolName,
        startMs: clock,
        args: stringify(event.args),
      });
    }
    if (event.type === 'tool_execution_end' && !event.parentToolCallId) {
      const started = open.get(event.toolCallId);
      open.delete(event.toolCallId);
      push({
        kind: 'tool',
        name: event.toolName,
        startMs: started?.startMs ?? clock,
        endMs: clock,
        isError: event.isError ?? false,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        summary: clip(
          `${started ? `${clip(started.args, 240)} ⇒ ` : ''}${resultText(event.result)}`,
        ),
      });
    }
    if (event.type === 'message_end') {
      const message = event.message;
      const previous = clock;
      if (message.timestamp) clock = Math.max(clock, message.timestamp);
      if (message.model) model = message.model;
      const last = steps.at(-1);
      if (message.role === 'toolResult') {
        if (last && last.kind === 'tool' && last.endMs < clock) last.endMs = clock;
        if (last && last.kind === 'tool') {
          last.inputTokens += message.usage?.input ?? 0;
          last.costUsd += message.usage?.cost?.total ?? 0;
        }
        continue;
      }
      const role =
        message.role === 'assistant' || message.role === 'user' ? message.role : 'system';
      const usage = message.usage;
      push({
        kind: role,
        name: role,
        startMs: previous,
        endMs: clock,
        isError: false,
        inputTokens: (usage?.input ?? 0) + (usage?.cacheRead ?? 0) + (usage?.cacheWrite ?? 0),
        outputTokens: usage?.output ?? 0,
        costUsd: usage?.cost?.total ?? 0,
        summary: clip(messageText(message)),
      });
    }
  }
  if (steps.length === 0) return null;
  return { format: 'pi-json', title, model, steps: fixClock(steps) };
}

function fixClock(steps: Step[]): Step[] {
  const origin = steps.find((step) => step.startMs > 0)?.startMs ?? 0;
  return steps.map((step) => ({
    ...step,
    startMs: Math.max(0, step.startMs - origin),
    endMs: Math.max(0, step.endMs - origin, step.startMs - origin),
  }));
}

const headerLine = /^([a-z][a-z ._-]{0,30}):\s(.*)$/i;

export function parseTerrariumLog(text: string, title: string): Recording | null {
  if (!text.startsWith('terrarium')) return null;
  const embedded = parsePiEvents(text, title);
  const headers = new Map<string, string>();
  for (const line of text.split('\n')) {
    const match = headerLine.exec(line);
    if (match?.[1] && match[2] !== undefined && !headers.has(match[1]))
      headers.set(match[1], match[2]);
  }
  const model = headers.get('model') ?? embedded?.model ?? 'unknown';
  const exit = headers.get('exit');
  const failed = exit !== undefined && exit !== '0';
  const phases: Step[] = [
    phase(0, 'spawn', `agent ${headers.get('agent') ?? '?'}`, false),
    phase(1, 'task', headers.get('task') ?? '', false),
  ];
  const body = embedded?.steps ?? [];
  const shifted = body.map((step, offset) => ({ ...step, index: offset + 2 }));
  const tail = text
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('{'))
    .slice(-6);
  const exitStep = phase(
    shifted.length + 2,
    'exit',
    `${exit ?? 'unknown'} ${tail.join(' ')}`,
    failed,
  );
  const lastEnd = shifted.at(-1)?.endMs ?? 0;
  exitStep.startMs = lastEnd;
  exitStep.endMs = lastEnd + 1000;
  return {
    format: 'terrarium',
    title: headers.get('run') ?? title,
    model,
    steps: [...phases, ...shifted, exitStep],
  };
}

function phase(index: number, name: string, summary: string, isError: boolean): Step {
  return {
    index,
    kind: 'phase',
    name,
    startMs: index * 1000,
    endMs: index * 1000 + 1000,
    isError,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    summary: clip(summary),
  };
}

export function parseRecording(text: string, title: string): Recording | null {
  return parseTerrariumLog(text, title) ?? parsePiEvents(text, title);
}

export function failureIndexFrom(scores: Score[]): number | null {
  const top = scores.reduce<Score | null>(
    (best, score) => (best === null || score.probability > best.probability ? score : best),
    null,
  );
  return top && top.probability >= 0.5 ? top.index : null;
}

export function totals(steps: Step[]) {
  return steps.reduce(
    (sum, step) => ({
      inputTokens: sum.inputTokens + step.inputTokens,
      outputTokens: sum.outputTokens + step.outputTokens,
      costUsd: sum.costUsd + step.costUsd,
      errors: sum.errors + (step.isError ? 1 : 0),
    }),
    { inputTokens: 0, outputTokens: 0, costUsd: 0, errors: 0 },
  );
}

const hostPattern = /\b[a-z0-9-]+(\.[a-z0-9-]+)*\.(internal|corp|lan|local)\b/gi;

export function redact(text: string): string {
  return text
    .replace(hostPattern, 'redacted.host')
    .replace(/\/Users\/[A-Za-z0-9._-]+/g, '/Users/pilot')
    .replace(/\/private\/var\/folders\/[^\s"]+/g, '/tmp/run');
}
