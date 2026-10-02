<script lang="ts">
import type { RecordingView } from '../shared/recording';
import { MAX_UPLOAD_BYTES } from '../shared/recording';
import { fetchList, fetchRecording, friendlyError, type RecordingList, uploadLog } from './api';
import Replay from './Replay.svelte';

let path = $state(window.location.pathname);

let view = $state<RecordingView | null>(null);

let list = $state<RecordingList | null>(null);

let loading = $state('');

let problem = $state('');

let listFailed = $state(false);

const recordingId = $derived(path.startsWith('/r/') ? path.slice(3) : null);

$effect(() => {
  const id = recordingId;
  view = null;

  if (id) {
    problem = '';
    loading =
      'Loading the recording. Clef scores a sample on first open, which can take a few seconds.';
    fetchRecording(id)
      .then((loaded) => {
        view = loaded;
      })
      .catch((error: Error) => {
        problem = friendlyError(error instanceof Error ? error : null);
      })
      .finally(() => {
        loading = '';
      });
  } else {
    fetchList()
      .then((loaded) => {
        list = loaded;
      })
      .catch(() => {
        listFailed = true;
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
  problem = '';

  if (file.size > MAX_UPLOAD_BYTES) {
    problem = 'This file is larger than 5 MB. Upload a smaller log.';
    input.value = '';

    return;
  }

  loading = 'Uploading and scoring each step with Clef…';

  try {
    const id = await uploadLog(file);
    loading = '';
    go(`/r/${id}`);
  } catch (error) {
    loading = '';
    problem = friendlyError(error instanceof Error ? error : null);
  }

  input.value = '';
}
</script>

<svelte:window onpopstate={() => (path = window.location.pathname)} />

<div aria-hidden="true" class="pointer-events-none fixed inset-0 z-0 bg-[url(/backdrop.jpg)] bg-cover bg-center opacity-25 "></div>
<div aria-hidden="true" class="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(0,0,0,0.85)_75%)]"></div>
<main class="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6">
  <nav class="flex items-center justify-between">
    <button class="flex items-center gap-3" aria-label="BLACKBOX home" onclick={() => go('/')}>
      <span class="h-3 w-3 animate-pulse rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.9)]"></span>
      <span class="font-mono text-sm font-bold tracking-[0.5em] text-amber-300">BLACKBOX</span>
    </button>
    <span class="hidden font-mono text-[10px] tracking-[0.3em] text-zinc-500 uppercase sm:inline">flight recorder for agent runs</span>
  </nav>

  {#if loading}
    <p role="status" class="font-mono text-sm text-amber-300/80">{loading}</p>
  {/if}
  {#if problem}
    <div role="alert" class="rounded-xl border border-red-500/60 bg-red-950/40 p-4 font-mono text-sm text-red-200">
      <p>{problem}</p>
      <button class="mt-3 rounded border border-red-400/60 px-3 py-1 text-red-100 hover:bg-red-500/10" onclick={() => go('/')}>Go to the upload page</button>
    </div>
  {/if}

  {#if view}
    <Replay {view} />
  {:else if !recordingId}
    <header class="flex flex-col gap-3">
      <h1 class="text-2xl font-semibold text-zinc-100 md:text-3xl">Replay a Pi agent run and see which step went wrong</h1>
      <p class="max-w-3xl text-sm leading-relaxed text-zinc-400">
        Drop the JSON lines file that <code class="text-amber-200">pi --mode json</code> writes. BLACKBOX shows each step on a timeline. The Clef model answers "Is this the step where the run went wrong?" for each step with a score from 0 to 1. The step with the highest score is marked red when its score is 0.5 or more. Clef can mark the wrong step. Use the mark as a place to start reading.
      </p>
    </header>
    <section class="grid gap-6 md:grid-cols-2">
      <div class="flex flex-col gap-4">
        <label class="group flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-zinc-700 bg-zinc-950 p-8 text-center transition hover:border-amber-400 focus-within:border-amber-400 focus-within:ring-2 focus-within:ring-amber-300">
          <span aria-hidden="true" class="text-4xl transition group-hover:scale-110">⬆</span>
          <span class="font-mono text-sm text-zinc-300">Choose a Pi <code>--mode json</code> log or a terrarium run log</span>
          <span class="font-mono text-xs break-all text-zinc-500">Make one with: <code>pi --mode json -p "your task" &gt; run.jsonl</code></span>
          <input type="file" accept=".jsonl,.json,.log,.txt,application/json,text/plain" class="sr-only" aria-label="Upload a Pi --mode json log file" disabled={!!loading} onchange={onFile} />
        </label>
        <ul class="flex flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-950/80 p-4 text-xs leading-relaxed text-zinc-400">
          <li><span class="text-zinc-200">Stored:</span> the raw file in R2 and the parsed steps and scores in D1, on Cloudflare. There is no expiry. Recordings stay until the site owner deletes them.</li>
          <li><span class="text-zinc-200">Who can see it:</span> anyone with the share URL. New uploads also show in the public "Recent" list on this page. Do not upload secrets.</li>
          <li><span class="text-zinc-200">Redaction:</span> host names and home folder paths are replaced before parsing. Other text is kept as you sent it.</li>
          <li><span class="text-zinc-200">Limits:</span> 5 MB per file. Per IP: 20 uploads per hour, 5 uploads per minute, 5 narrations per minute, 60 reads per minute.</li>
          <li><span class="text-zinc-200">Models:</span> each upload runs Clef on Workers AI, one call per 64 steps. Narration runs Llama 3.3 70B. Both can state things the log does not support.</li>
        </ul>
      </div>
      <div class="flex flex-col gap-3">
        <h2 class="font-mono text-[10px] tracking-[0.4em] text-zinc-400 uppercase">Sample recordings</h2>
        {#each list?.samples ?? [] as sample (sample)}
          <button class="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-left font-mono text-sm text-emerald-300 hover:border-emerald-400" onclick={() => go(`/r/${sample}`)}>
            <span aria-hidden="true">▶</span> {sample}
          </button>
        {/each}
        <h2 class="mt-4 font-mono text-[10px] tracking-[0.4em] text-zinc-400 uppercase">Recent</h2>
        {#if list === null}
          <p role="status" class="font-mono text-xs text-zinc-500">Loading recent recordings…</p>
        {:else if listFailed}
          <p class="font-mono text-xs text-red-300">The recent list did not load. Reload the page to try again.</p>
        {:else if list.recordings.length === 0}
          <p class="font-mono text-xs text-zinc-500">No uploads yet. Open a sample, or upload a log.</p>
        {/if}
        {#each list?.recordings ?? [] as item (item.id)}
          <button class="flex justify-between gap-3 rounded-lg border border-zinc-900 px-3 py-2 text-left font-mono text-xs text-zinc-400 hover:border-zinc-700" onclick={() => go(`/r/${item.id}`)}>
            <span class="min-w-0 truncate">{item.title}</span>
            <span class="shrink-0 {item.failure_index === null ? 'text-emerald-400' : 'text-red-400'}">
              {item.failure_index === null ? 'no fault marked' : `fault at step ${item.failure_index}`}
            </span>
          </button>
        {/each}
      </div>
    </section>
    <footer class="font-mono text-[10px] text-zinc-500">API: <code>POST /api/recordings</code> with a multipart <code>file</code> field. Made by <a class="underline hover:text-zinc-300" href="https://coey.dev">Jordan Coeyman</a>.</footer>
  {/if}
</main>
