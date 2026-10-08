<script setup lang="ts">
export type ChipTone = 'ok' | 'warn' | 'danger' | 'info' | 'muted'

defineProps<{ tone: ChipTone; title?: string | undefined }>()
</script>

<template>
  <span class="chip" :class="`chip--${tone}`" :title="title"><slot /></span>
</template>

<style scoped lang="scss">
.chip {
  display: inline-block;
  max-width: 100%;
  padding: 0 9px;
  border-radius: $radius-pill;
  font-family: $font-mono;
  font-size: 12px;
  line-height: 20px;
  white-space: nowrap;
  vertical-align: middle;
  @include truncate;

  &--ok {
    background: color-mix(in srgb, var(--ok) 16%, transparent);
    color: var(--ok);
  }
  &--warn {
    background: var(--warn-soft);
    color: var(--warn);
  }
  &--danger {
    background: var(--danger-soft);
    color: var(--danger);
  }
  &--info {
    background: var(--accent-soft);
    color: var(--accent);
  }
  &--muted {
    background: var(--surface-2);
    color: var(--muted);
  }
}
</style>
