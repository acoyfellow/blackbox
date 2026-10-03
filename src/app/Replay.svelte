<script lang="ts">
import type { RecordingView, Step } from '../shared/recording';
import { friendlyError, narrate } from './api';

let { view }: { view: RecordingView } = $props();

let cursor = $state(0);

let playing = $state(false);

let narration = $state('');

let narrating = $state(false);

let narrationProblem = $state('');

const steps = $derived(view.steps);

const current = $derived<Step | undefined>(steps[cursor]);

const flown = $derived(steps.slice(0, cursor + 1));

const totalCost = $derived(steps.reduce((sum, step) => sum + step.costUsd, 0));

const totalTokens = $derived(
  steps.reduce((sum, step) => sum + step.inputTokens + step.outputTokens, 0),
);

const flownCost = $derived(flown.reduce((sum, step) => sum + step.costUsd, 0));

const flownTokens = $derived(
  flown.reduce((sum, step) => sum + step.inputTokens + step.outputTokens, 0),
);

const errors = $derived(flown.filter((step) => step.isError).length);

const tools = $derived(flown.filter((step) => step.kind === 'tool').length);

const span = $derived(Math.max(1, steps.at(-1)?.endMs ?? 1));

const risk = $derived(new Map(view.scores.map((score) => [score.index, score.probability])));

const currentRisk = $derived(risk.get(cursor) ?? 0);

const toolTotal = $derived(steps.filter((step) => step.kind === 'tool').length);

const durationS = $derived(current ? (current.endMs - current.startMs) / 1000 : 0);

$effect(() => {
  if (!playing) return;

  const timer = setInterval(() => {
    if (cursor >= steps.length - 1) playing = false;
    else cursor += 1;
  }, 700);

  return () => clearInterval(timer);
});

async function startNarration() {
  narration = '';
  narrationProblem = '';
  narrating = true;

  try {
    await narrate(view.id, (token) => {
      narration += token;
    });
  } catch (error) {
    narrationProblem = friendlyError(error instanceof Error ? error : null);
  }

  narrating = false;
}

function seconds(ms: number): string {
  return (ms / 1000).toFixed(1);
}

function rowClass(step: Step): string {
  if (step.index === cursor) return 'bg-faint';

  return step.index > cursor ? 'text-dim' : '';
}

function onKey(event: KeyboardEvent) {
  if (event.key === 'ArrowRight') cursor = Math.min(steps.length - 1, cursor + 1);

  if (event.key === 'ArrowLeft') cursor = Math.max(0, cursor - 1);

  if (event.key === ' ') playing = !playing;
}
</script>

<svelte:window onkeydown={onKey} />

<section class="flex flex-col gap-6">
  <header class="flex flex-wrap items-end justify-between gap-4 border-b border-ink pb-3">
    <div class="min-w-0">
      <div class="font-mono text-[10px] tracking-[0.2em] text-dim uppercase">Recording {view.id}</div>
      <h1 class="break-words text-2xl font-medium tracking-tight text-ink">{view.title}</h1>
      <div class="font-mono text-xs text-dim">{view.format} · {view.model} · {steps.length} waypoints</div>
    </div>
    <div class="font-mono text-xs">
      {#if view.failureIndex === null}
        <span class="border border-rule px-3 py-1 text-ink">NO FAULT FOUND</span>
      {:else}
        <button class="border border-fault px-3 text-fault hover:bg-faint" onclick={() => (cursor = view.failureIndex ?? 0)}>
          FAULT AT WAYPOINT {view.failureIndex}
        </button>
      {/if}
    </div>
  </header>

  <dl class="grid grid-cols-2 border-t border-l border-rule font-mono sm:grid-cols-3 md:grid-cols-6">
    {#each [
      ['tools', `${tools} / ${toolTotal}`],
      ['faults', `${errors}`],
      ['fault risk', currentRisk.toFixed(3)],
      ['leg secs', durationS.toFixed(1)],
      ['cost', `$${flownCost.toFixed(3)} / $${totalCost.toFixed(3)}`],
      ['tokens', `${(flownTokens / 1000).toFixed(1)}k / ${(totalTokens / 1000).toFixed(1)}k`],
    ] as [label, value] (label)}
      <div class="border-r border-b border-rule bg-paper px-3 py-2">
        <dt class="text-[10px] tracking-[0.15em] text-dim uppercase">{label}</dt>
        <dd class="text-right text-sm text-ink {label === 'fault risk' && currentRisk >= 0.5 ? 'text-fault' : ''}">{value}</dd>
      </div>
    {/each}
  </dl>

  <div class="border border-rule bg-paper p-3">
    <div class="relative h-12 w-full border-b border-ink bg-[linear-gradient(90deg,var(--color-faint)_1px,transparent_1px)] bg-[size:10%_100%]">
      {#each steps as step (step.index)}
        <button
          aria-label="waypoint {step.index}"
          class="absolute bottom-0 min-h-0 w-px {step.index === view.failureIndex ? 'bg-fault w-[3px]' : 'bg-ink'} {step.index > cursor ? 'opacity-30' : ''}"
          style:left="{(step.index / Math.max(1, steps.length - 1)) * 99.5}%"
          style:height="{8 + (risk.get(step.index) ?? 0) * 92}%"
          onclick={() => (cursor = step.index)}
        ></button>
      {/each}
    </div>
    <input type="range" min="0" max={Math.max(0, steps.length - 1)} bind:value={cursor} aria-label="Scrub to a waypoint" class="mt-2 w-full accent-[var(--color-ink)]" />
    <div class="flex items-center justify-between font-mono text-xs text-dim">
      <button class="border border-rule px-3 text-ink hover:border-ink" aria-label={playing ? 'Pause replay' : 'Start replay'} onclick={() => (playing = !playing)}>
        {playing ? 'HOLD' : 'REPLAY'}
      </button>
      <span>T+{seconds(current?.endMs ?? 0)}s / {seconds(span)}s</span>
    </div>
  </div>

  <div class="overflow-x-auto border-t border-ink">
    <table class="w-full border-collapse font-mono text-xs">
      <thead>
        <tr class="border-b border-rule text-left text-[10px] tracking-[0.15em] text-dim uppercase">
          <th scope="col" class="py-1 pr-3 text-right font-normal">#</th>
          <th scope="col" class="py-1 pr-3 text-right font-normal">T+s</th>
          <th scope="col" class="py-1 pr-3 font-normal">Tool</th>
          <th scope="col" class="py-1 pr-3 font-normal">Status</th>
          <th scope="col" class="py-1 pr-3 text-right font-normal">Clef p</th>
          <th scope="col" class="w-24 py-1 font-normal"><span class="sr-only">Clef bar</span></th>
        </tr>
      </thead>
      <tbody>
        {#each steps as step (step.index)}
          <tr class="cursor-pointer border-b border-rule {rowClass(step)} {step.index === view.failureIndex ? 'text-fault' : ''}" onclick={() => (cursor = step.index)}>
            <td class="py-1 pr-3 text-right">{String(step.index).padStart(3, '0')}</td>
            <td class="py-1 pr-3 text-right">{seconds(step.startMs)}</td>
            <td class="max-w-48 truncate py-1 pr-3">{step.kind} · {step.name}</td>
            <td class="py-1 pr-3">{step.index === view.failureIndex ? 'FAULT' : step.isError ? 'ERROR' : 'OK'}</td>
            <td class="py-1 pr-3 text-right">{(risk.get(step.index) ?? 0).toFixed(3)}</td>
            <td class="py-1"><div class="h-1 w-24 bg-faint"><div class="h-1 {step.index === view.failureIndex ? 'bg-fault' : 'bg-dim'}" style:width="{(risk.get(step.index) ?? 0) * 100}%"></div></div></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <div class="grid gap-6 md:grid-cols-2">
    {#if current}
      <article class="border-t p-0 {current.index === view.failureIndex ? 'border-fault' : 'border-ink'}">
        <div class="flex items-center justify-between border-b border-rule py-2 font-mono text-[10px] tracking-[0.15em] uppercase">
          <span class="text-dim">WP {current.index} · {current.kind} · {current.name}</span>
          <span class={current.index === view.failureIndex || current.isError ? 'text-fault' : 'text-ink'}>{current.isError ? 'ERROR' : 'NOMINAL'}</span>
        </div>
        <p class="max-h-56 overflow-auto py-2 font-mono text-xs leading-relaxed break-words text-ink">{current.summary || '—'}</p>
      </article>
    {/if}
    <article class="border-t border-ink">
      <div class="flex items-center justify-between border-b border-rule font-mono text-xs">
        <h2 class="text-[10px] tracking-[0.15em] text-dim uppercase">Narration</h2>
        <button class="border border-rule px-3 text-ink hover:border-ink disabled:opacity-40" disabled={narrating} onclick={startNarration}>
          {narrating ? 'ON AIR…' : 'NARRATE'}
        </button>
      </div>
      <p aria-live="polite" class="min-h-24 py-2 text-sm leading-relaxed whitespace-pre-wrap text-ink">{#if narration}{narration}{:else if narrating}Waiting for the first words from Meta Llama 3.3 70B…{:else if !narrationProblem}Press NARRATE for a short summary of this run. The model can get step numbers or causes wrong. Check them against the timeline.{/if}{#if narrating}<span aria-hidden="true">▍</span>{/if}</p>
      {#if narrationProblem}<p role="alert" class="mt-2 font-mono text-xs text-fault">{narrationProblem}</p>{/if}
    </article>
  </div>
</section>
