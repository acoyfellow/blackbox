<script lang="ts">
import type { RecordingView } from '../shared/recording';
import { fetchList, fetchRecording, type RecordingList, uploadLog } from './api';
import Replay from './Replay.svelte';

let path = $state(window.location.pathname);
let view = $state<RecordingView | null>(null);
let list = $state<RecordingList | null>(null);
let status = $state('');

const recordingId = $derived(path.startsWith('/r/') ? path.slice(3) : null);

$effect(() => {
  const id = recordingId;
  view = null;
  if (id) {
    status = 'Reading flight recorder and scoring with Clef…';
    fetchRecording(id)
      .then((loaded) => {
        view = loaded;
        status = '';
      })
      .catch((error: unknown) => {
        status = error instanceof Error ? error.message : 'load failed';
      });
  } else {
    fetchList()
      .then((loaded) => {
        list = loaded;
      })
      .catch(() => {
        list = { recordings: [], samples: [] };
      });
  }
});

function go(next: string) {
  history.pushState(null, '', next);
  path = next;
}

async function onFile(event: Event) {
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement)) return;
  const file = input.files?.[0];
  if (!file) return;
  status = 'Uploading and scoring…';
  try {
    go(`/r/${await uploadLog(file)}`);
  } catch (error) {
    status = error instanceof Error ? error.message : 'upload failed';
  }
}
</script>

<svelte:window onpopstate={() => (path = window.location.pathname)} />

<main class="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-6 py-8">
  <nav class="flex items-center justify-between">
    <button class="flex items-center gap-3" onclick={() => go('/')}>
      <span class="h-3 w-3 animate-pulse rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.9)]"></span>
      <span class="font-mono text-sm font-bold tracking-[0.5em] text-amber-300">BLACKBOX</span>
    </button>
    <span class="font-mono text-[10px] tracking-[0.3em] text-zinc-600 uppercase">flight recorder for agent runs</span>
  </nav>

  {#if status}
    <div class="font-mono text-sm text-amber-300/80">{status}</div>
  {/if}

  {#if view}
    <Replay {view} />
  {:else if !recordingId}
    <section class="grid gap-6 md:grid-cols-2">
      <label class="group flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-zinc-700 bg-zinc-950 p-10 transition hover:border-amber-400">
        <span class="text-4xl transition group-hover:scale-110">⬆</span>
        <span class="font-mono text-sm text-zinc-300">Drop a Pi <code>--mode json</code> log or terrarium run log</span>
        <span class="font-mono text-xs text-zinc-600">5 MB max · 20 per hour · or POST /api/recordings</span>
        <input type="file" class="hidden" onchange={onFile} />
      </label>
      <div class="flex flex-col gap-3">
        <div class="font-mono text-[10px] tracking-[0.4em] text-zinc-500 uppercase">Sample recordings</div>
        {#each list?.samples ?? [] as sample (sample)}
          <button class="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-left font-mono text-sm text-emerald-300 hover:border-emerald-400" onclick={() => go(`/r/${sample}`)}>
            ▶ {sample}
          </button>
        {/each}
        <div class="mt-4 font-mono text-[10px] tracking-[0.4em] text-zinc-500 uppercase">Recent</div>
        {#each list?.recordings ?? [] as item (item.id)}
          <button class="flex justify-between rounded-lg border border-zinc-900 px-3 py-2 text-left font-mono text-xs text-zinc-400 hover:border-zinc-700" onclick={() => go(`/r/${item.id}`)}>
            <span>{item.title}</span>
            <span class={item.failure_index === null ? 'text-emerald-400' : 'text-red-400'}>
              {item.failure_index === null ? 'clean' : `fault @${item.failure_index}`}
            </span>
          </button>
        {/each}
      </div>
    </section>
  {/if}
</main>
