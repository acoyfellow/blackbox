<script lang="ts">
let { label, value, max, display }: { label: string; value: number; max: number; display: string } =
  $props();
const ratio = $derived(max > 0 ? Math.min(1, value / max) : 0);
</script>

<div class="flex flex-col items-center gap-1">
  <div class="relative h-32 w-10 overflow-hidden rounded-sm border border-zinc-700 bg-zinc-950">
    <div
      class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-emerald-600/70 to-emerald-300/40 transition-all duration-500 ease-out"
      style:height="{ratio * 100}%"
    ></div>
    {#each [0.25, 0.5, 0.75] as mark (mark)}
      <div class="absolute inset-x-0 h-px bg-zinc-600" style:bottom="{mark * 100}%"></div>
    {/each}
  </div>
  <div class="font-mono text-[11px] text-emerald-300">{display}</div>
  <div class="font-mono text-[10px] tracking-[0.3em] text-zinc-500 uppercase">{label}</div>
</div>
