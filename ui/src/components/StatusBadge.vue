<script setup lang="ts">
import type { RunStatus } from '../api'

defineProps<{ status: RunStatus | 'partial' | 'attention' }>()

const LABELS: Record<RunStatus | 'partial' | 'attention', string> = {
  partial: 'Partly done',
  attention: 'Needs attention',
  running: 'Running',
  waiting: 'Waiting for you',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
}
</script>

<template>
  <span class="badge" :class="`badge--${status}`">{{ LABELS[status] }}</span>
</template>

<style scoped lang="scss">
.badge {
  padding: 1px 10px;
  border-radius: $radius-pill;
  background: var(--surface-2);
  color: var(--muted);
  font-size: $font-size-sm;
  font-weight: 600;
  white-space: nowrap;

  &--running,
  &--waiting {
    background: var(--accent-soft);
    color: var(--accent);
  }
  &--done {
    background: color-mix(in srgb, var(--ok) 16%, transparent);
    color: var(--ok);
  }
  &--attention,
  &--partial {
    background: var(--warn-soft);
    color: var(--warn);
  }
  &--failed {
    background: var(--danger-soft);
    color: var(--danger);
  }
}
</style>
