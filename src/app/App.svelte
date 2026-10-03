<script lang="ts">
import type { RecordingView } from '../shared/recording';
import { MAX_UPLOAD_BYTES } from '../shared/recording';
import {
  deleteUpload,
  fetchList,
  fetchRecording,
  friendlyError,
  type RecordingList,
  type UploadReceipt,
  uploadLog,
} from './api';
import Replay from './Replay.svelte';

let path = $state(window.location.pathname);

let view = $state<RecordingView | null>(null);

let list = $state<RecordingList | null>(null);

let loading = $state('');

let problem = $state('');

let listFailed = $state(false);

let uploaded = $state<UploadReceipt | null>(null);

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
        list = { samples: [] };
      });
  }
});

function go(next: string) {
  history.pushState(null, '', next);
  path = next;
}

async function onDelete(receipt: UploadReceipt) {
  try {
    await deleteUpload(receipt);
    uploaded = null;
    go('/');
  } catch (error) {
    problem = friendlyError(error instanceof Error ? error : null);
  }
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
    const receipt = await uploadLog(file);
    loading = '';
    uploaded = receipt;
    go(receipt.url);
  } catch (error) {
    loading = '';
    problem = friendlyError(error instanceof Error ? error : null);
  }

  input.value = '';
}
</script>

<svelte:window onpopstate={() => (path = window.location.pathname)} />

<div aria-hidden="true" class="pointer-events-none fixed inset-0 z-0 bg-[linear-gradient(var(--color-faint)_1px,transparent_1px),linear-gradient(90deg,var(--color-faint)_1px,transparent_1px)] bg-[size:16px_16px]"></div>
<main class="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6">
  <nav class="flex items-center justify-between border-b border-ink pb-2">
    <button class="flex items-center gap-3" aria-label="BLACKBOX home" onclick={() => go('/')}>
      <span class="h-2.5 w-2.5 border border-ink"></span>
      <span class="font-mono text-sm font-semibold tracking-[0.3em] text-ink">BLACKBOX</span>
    </button>
    <span class="hidden font-mono text-[10px] tracking-[0.2em] text-dim uppercase sm:inline">flight recorder for agent runs</span>
  </nav>

  {#if loading}
    <p role="status" class="font-mono text-xs text-dim">{loading}</p>
  {/if}
  {#if problem}
    <div role="alert" class="border border-fault bg-paper p-4 font-mono text-xs text-ink">
      <p><span class="mr-2 text-fault uppercase">Error</span>{problem}</p>
      <button class="mt-3 border border-rule px-3 text-ink hover:border-ink" onclick={() => go('/')}>Go to the upload page</button>
    </div>
  {/if}

  {#if view}
    {#if uploaded && uploaded.id === view.id}
      <aside class="flex flex-wrap items-center gap-3 border border-rule bg-paper p-4 font-mono text-xs text-ink">
        <span>Only people you give this page's URL to can open this recording. It is not listed anywhere. The delete button shows only in the tab you uploaded from, until you reload or close it.</span>
        <button class="border border-fault px-3 text-fault hover:bg-faint" onclick={() => uploaded && onDelete(uploaded)}>Delete this recording</button>
      </aside>
    {/if}
    <Replay {view} />
  {:else if !recordingId}
    <header class="flex flex-col gap-3">
      <h1 class="text-2xl font-medium tracking-tight text-ink md:text-3xl">Replay a Pi agent run and see which step went wrong</h1>
      <p class="max-w-3xl text-sm leading-relaxed text-dim">
        Drop the JSON lines file that <code class="font-mono text-ink">pi --mode json</code> writes. BLACKBOX shows each step on a timeline. Cloudflare's Clef model answers "Is this the step where the run went wrong?" for each step with a score from 0 to 1. The step with the highest score is marked red when its score is 0.5 or more. Clef can mark the wrong step. Use the mark as a place to start reading.
      </p>
    </header>
    <section class="grid gap-6 md:grid-cols-2">
      <div class="flex flex-col gap-4">
        <label class="flex cursor-pointer flex-col items-center justify-center gap-2 border border-dashed border-dim bg-paper p-8 text-center hover:border-ink focus-within:border-ink">
          <span class="font-mono text-[10px] tracking-[0.2em] text-dim uppercase">Input</span>
          <span class="font-mono text-sm text-ink">Choose a Pi <code>--mode json</code> log or a terrarium run log</span>
          <span class="font-mono text-xs break-all text-dim">Make one with: <code>pi --mode json -p "your task" &gt; run.jsonl</code></span>
          <input type="file" accept=".jsonl,.json,.log,.txt,application/json,text/plain" class="sr-only" aria-label="Upload a Pi --mode json log file" disabled={!!loading} onchange={onFile} />
        </label>
        <dl class="grid grid-cols-[7rem_1fr] border-t border-ink bg-paper text-xs leading-relaxed text-dim">
          <dt class="border-b border-rule py-2 font-mono text-[10px] tracking-[0.15em] text-ink uppercase">Stored</dt><dd class="border-b border-rule py-2">the raw file in R2 and the parsed steps and scores in D1, on Cloudflare. There is no expiry. A recording stays until you delete it with its delete token or the site owner deletes it.</dd>
          <dt class="border-b border-rule py-2 font-mono text-[10px] tracking-[0.15em] text-ink uppercase">Who can see it</dt><dd class="border-b border-rule py-2">anyone you give the share URL to, and the site owner. Uploads are not listed on this page or in the API. The URL holds a random 128-bit id, so it cannot be guessed. Do not upload secrets.</dd>
          <dt class="border-b border-rule py-2 font-mono text-[10px] tracking-[0.15em] text-ink uppercase">Delete</dt><dd class="border-b border-rule py-2">the upload reply carries a one-time delete token. The page shows a delete button right after upload. Only a hash of the token is stored.</dd>
          <dt class="border-b border-rule py-2 font-mono text-[10px] tracking-[0.15em] text-ink uppercase">Redaction</dt><dd class="border-b border-rule py-2">host names and home folder paths are replaced before parsing. Other text is kept as you sent it.</dd>
          <dt class="border-b border-rule py-2 font-mono text-[10px] tracking-[0.15em] text-ink uppercase">Limits</dt><dd class="border-b border-rule py-2 font-mono">5 MB per file. Per IP: 20 uploads per hour, 5 uploads per minute, 5 narrations per minute, 60 reads per minute.</dd>
          <dt class="border-b border-rule py-2 font-mono text-[10px] tracking-[0.15em] text-ink uppercase">Models</dt><dd class="border-b border-rule py-2">each upload runs Cloudflare's Clef model on Workers AI, one call per 64 steps. Narration runs Meta's Llama 3.3 70B on Workers AI. Both can state things the log does not support.</dd>
        </dl>
      </div>
      <div class="flex flex-col">
        <h2 class="border-b border-ink pb-2 font-mono text-[10px] tracking-[0.2em] text-ink uppercase">Sample recordings</h2>
        {#each list?.samples ?? [] as sample, index (sample)}
          <button class="flex items-center gap-4 border-b border-rule bg-paper px-1 text-left font-mono text-sm text-ink hover:bg-faint" onclick={() => go(`/r/${sample}`)}>
            <span class="w-6 text-right text-xs text-dim">{String(index + 1).padStart(2, '0')}</span>{sample}
          </button>
        {/each}
        {#if listFailed}
          <p class="py-2 font-mono text-xs text-fault">The sample list did not load. Reload the page to try again.</p>
        {/if}
      </div>
    </section>
    <footer class="border-t border-rule pt-2 font-mono text-[10px] text-dim">API: <code>POST /api/recordings</code> with a multipart <code>file</code> field. Made by <a class="underline hover:text-ink" href="https://coey.dev">Jordan Coeyman</a>.</footer>
  {/if}
</main>
