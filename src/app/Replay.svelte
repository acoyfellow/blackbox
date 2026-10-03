<script lang="ts">
import type { RecordingView, Step } from '../shared/recording';
import Altimeter from './Altimeter.svelte';
import { friendlyError, narrate } from './api';
import Gauge from './Gauge.svelte';

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

function barClass(step: Step): string {
  if (step.index === view.failureIndex)
    return 'bg-red-500 shadow-[0_0_14px_rgba(239,68,68,0.9)] animate-pulse';

  if (step.isError) return 'bg-orange-500/80';

  if (step.kind === 'tool') return 'bg-emerald-400/80';

  if (step.kind === 'assistant') return 'bg-sky-400/70';

  return 'bg-zinc-500/60';
}

function onKey(event: KeyboardEvent) {
  if (event.key === 'ArrowRight') cursor = Math.min(steps.length - 1, cursor + 1);

  if (event.key === 'ArrowLeft') cursor = Math.max(0, cursor - 1);

  if (event.key === ' ') playing = !playing;
}
</script>

<svelte:window onkeydown={onKey} />

<section class="flex flex-col gap-6">
  <header class="flex flex-wrap items-end justify-between gap-4 border-b border-zinc-800 pb-4">
    <div>
      <div class="font-mono text-[10px] tracking-[0.4em] text-amber-400/80 uppercase">Recording {view.id}</div>
      <h1 class="break-words text-2xl font-semibold text-zinc-100">{view.title}</h1>
      <div class="font-mono text-xs text-zinc-500">{view.format} · {view.model} · {steps.length} waypoints</div>
    </div>
    <div class="flex items-center gap-3 font-mono text-xs">
      {#if view.failureIndex === null}
        <span class="rounded-full border border-emerald-500/50 px-3 py-1 text-emerald-300">NO FAULT FOUND</span>
      {:else}
        <button
          class="animate-pulse rounded-full border border-red-500 px-3 py-1 text-red-400 hover:bg-red-500/10"
          onclick={() => (cursor = view.failureIndex ?? 0)}
        >
          FAULT AT WAYPOINT {view.failureIndex}
        </button>
      {/if}
    </div>
  </header>

  <div class="grid grid-cols-2 gap-6 rounded-2xl border border-zinc-800 bg-gradient-to-b from-zinc-900 to-black p-6 shadow-[inset_0_0_60px_rgba(0,0,0,0.9)] md:grid-cols-6">
    <Gauge label="tools" value={tools} max={Math.max(4, steps.filter((s) => s.kind === 'tool').length)} display={`${tools}`} />
    <Gauge label="faults" value={errors} max={Math.max(3, errors)} display={`${errors}`} alarm={errors > 0} />
    <Gauge label="fault risk" value={currentRisk} max={1} display={`${Math.round(currentRisk * 100)}%`} alarm={currentRisk >= 0.5} />
    <Gauge label="leg secs" value={durationS} max={60} display={durationS.toFixed(1)} />
    <Altimeter label="cost" value={flownCost} max={totalCost} display={`$${flownCost.toFixed(3)}`} />
    <Altimeter label="tokens" value={flownTokens} max={totalTokens} display={`${(flownTokens / 1000).toFixed(1)}k`} />
  </div>

  <div class="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
    <div class="relative h-16 w-full">
      {#each steps as step (step.index)}
        <button
          aria-label="waypoint {step.index}"
          class="absolute bottom-0 w-[max(6px,0.6%)] rounded-t-sm transition-all duration-300 {barClass(step)} {step.index === cursor ? 'ring-2 ring-amber-300' : ''} {step.index > cursor ? 'opacity-30' : ''}"
          style:left="{(step.index / Math.max(1, steps.length - 1)) * 98}%"
          style:height="{20 + (risk.get(step.index) ?? 0) * 80}%"
          onclick={() => (cursor = step.index)}
        ></button>
      {/each}
    </div>
    <input
      type="range"
      min="0"
      max={Math.max(0, steps.length - 1)}
      bind:value={cursor}
      aria-label="Scrub to a waypoint"
      class="mt-3 w-full accent-amber-400"
    />
    <div class="mt-2 flex items-center justify-between font-mono text-xs text-zinc-500">
      <button class="rounded border border-zinc-700 px-3 py-1 text-amber-300 hover:bg-zinc-800" aria-label={playing ? 'Pause replay' : 'Start replay'} onclick={() => (playing = !playing)}>
        {playing ? '❚❚ HOLD' : '▶ REPLAY'}
      </button>
      <span>T+{((current?.endMs ?? 0) / 1000).toFixed(1)}s / {(span / 1000).toFixed(1)}s</span>
    </div>
  </div>

  <div class="grid gap-6 md:grid-cols-2">
    {#if current}
      {#key current.index}
        <article class="rounded-2xl border p-4 transition-colors duration-300 {current.index === view.failureIndex ? 'border-red-500/70 bg-red-950/30' : 'border-zinc-800 bg-zinc-950'}">
          <div class="mb-2 flex items-center justify-between font-mono text-xs">
            <span class="tracking-[0.3em] text-zinc-400 uppercase">WP {current.index} · {current.kind} · {current.name}</span>
            <span class={current.isError ? 'text-orange-400' : 'text-emerald-400'}>{current.isError ? 'ERROR' : 'NOMINAL'}</span>
          </div>
          <p class="max-h-56 overflow-auto font-mono text-xs leading-relaxed break-words text-zinc-300">{current.summary || '—'}</p>
        </article>
      {/key}
    {/if}
    <article class="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
      <div class="mb-2 flex items-center justify-between font-mono text-xs">
        <h2 class="tracking-[0.3em] text-zinc-400 uppercase">Narration</h2>
        <button class="rounded border border-zinc-700 px-3 py-1 text-sky-300 hover:bg-zinc-800 disabled:opacity-40" disabled={narrating} onclick={startNarration}>
          {narrating ? 'ON AIR…' : 'NARRATE'}
        </button>
      </div>
      <p aria-live="polite" class="min-h-24 text-sm leading-relaxed whitespace-pre-wrap text-sky-100/90">{#if narration}{narration}{:else if narrating}Waiting for the first words from Meta Llama 3.3 70B…{:else if !narrationProblem}Press NARRATE for a short summary of this run. The model can get step numbers or causes wrong. Check them against the timeline.{/if}{#if narrating}<span aria-hidden="true" class="animate-pulse">▍</span>{/if}</p>
      {#if narrationProblem}<p role="alert" class="mt-2 font-mono text-xs text-red-300">{narrationProblem}</p>{/if}
    </article>
  </div>
</section>
