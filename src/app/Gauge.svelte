<script lang="ts">
let {
  label,
  value,
  max,
  display,
  alarm = false,
}: { label: string; value: number; max: number; display: string; alarm?: boolean } = $props();

const ratio = $derived(max > 0 ? Math.min(1, Math.max(0, value / max)) : 0);
const angle = $derived(-120 + ratio * 240);
const ticks = Array.from({ length: 13 }, (_, i) => -120 + i * 20);
</script>

<div class="flex flex-col items-center gap-1">
  <svg viewBox="-60 -60 120 120" class="h-32 w-32 drop-shadow-[0_0_12px_rgba(16,185,129,0.25)]">
    <circle r="56" class="fill-zinc-950 stroke-zinc-700" stroke-width="2" />
    <circle r="50" class="fill-none stroke-zinc-900" stroke-width="6" />
    {#each ticks as tick, i (tick)}
      <line
        x1="0"
        y1="-48"
        x2="0"
        y2={i % 3 === 0 ? -40 : -44}
        transform="rotate({tick})"
        class={i >= 10 ? 'stroke-red-500' : 'stroke-zinc-400'}
        stroke-width={i % 3 === 0 ? 2 : 1}
      />
    {/each}
    <g transform="rotate({angle})" class="transition-transform duration-500 ease-out">
      <line x1="0" y1="6" x2="0" y2="-42" class={alarm ? 'stroke-red-500' : 'stroke-amber-300'} stroke-width="3" stroke-linecap="round" />
    </g>
    <circle r="5" class="fill-zinc-300" />
    <text y="26" text-anchor="middle" class="fill-emerald-300 font-mono text-[11px]">{display}</text>
  </svg>
  <div class="font-mono text-[10px] tracking-[0.3em] text-zinc-500 uppercase">{label}</div>
</div>
