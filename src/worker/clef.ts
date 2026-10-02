import { z } from 'zod';
import { clip, type Score, type Step } from '../shared/recording';

export const CLEF_MODEL = '@cf/cloudflare/clef';
export const NARRATOR_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export const GATEWAY = { gateway: { id: 'default' } };
const MAX_QUESTIONS = 64;
export const FAILURE_QUESTION = 'Is this the step where the run went wrong?';

export interface AiBinding {
  run(model: string, input: object, options?: object): Promise<unknown>;
}

const clefReply = z.object({
  answers: z.record(
    z.string(),
    z.object({ type: z.literal('noul'), noul: z.number().min(0).max(1) }).loose(),
  ),
});

const wrappedReply = z.object({ result: clefReply });

export function parseClefReply(raw: unknown): Record<string, number> {
  const direct = clefReply.safeParse(raw);
  const wrapped = wrappedReply.safeParse(raw);
  const answers = direct.success
    ? direct.data.answers
    : wrapped.success
      ? wrapped.data.result.answers
      : null;
  if (!answers)
    throw new Error(`clef reply did not match schema: ${clip(JSON.stringify(raw), 200)}`);
  return Object.fromEntries(Object.entries(answers).map(([key, value]) => [key, value.noul]));
}

export function clefPayload(title: string, steps: Step[], window: Step[]) {
  const timeline = steps.map((step) => ({
    step: step.index,
    kind: step.kind,
    name: step.name,
    error: step.isError,
    detail: clip(step.summary, 220),
  }));
  const questions = Object.fromEntries(
    window.map((step) => [
      `step_${step.index}`,
      {
        type: 'noul',
        instructions: `Consider step ${step.index} (${step.kind} ${step.name}) in the agent run timeline. ${FAILURE_QUESTION} Answer yes only for the first step whose action or decision caused the run to fail, retry, or waste effort.`,
      },
    ]),
  );
  return { state: { run: title, timeline }, questions };
}

export async function scoreSteps(ai: AiBinding, title: string, steps: Step[]): Promise<Score[]> {
  const scores: Score[] = [];
  for (let offset = 0; offset < steps.length; offset += MAX_QUESTIONS) {
    const window = steps.slice(offset, offset + MAX_QUESTIONS);
    const raw = await ai.run(CLEF_MODEL, clefPayload(title, steps, window), GATEWAY);
    const answers = parseClefReply(raw);
    for (const step of window) {
      const probability = answers[`step_${step.index}`];
      if (probability !== undefined) scores.push({ index: step.index, probability });
    }
  }
  return scores;
}

export function narrationMessages(title: string, steps: Step[], failureIndex: number | null) {
  const log = steps
    .map(
      (step) =>
        `${step.index}. [${step.kind}:${step.name}${step.isError ? ' ERROR' : ''}] ${clip(step.summary, 200)}`,
    )
    .join('\n');
  const marker =
    failureIndex === null
      ? 'The scorer found no clear failure step.'
      : `The scorer marked step ${failureIndex} as where the run went wrong.`;
  return [
    {
      role: 'system',
      content:
        'You are an airline captain calmly narrating a flight recorder replay of an AI agent run. Short, steady sentences. Refer to steps as waypoints with their numbers. Under 180 words. No markdown.',
    },
    { role: 'user', content: `Recording: ${title}\n${marker}\n\n${log}` },
  ];
}
