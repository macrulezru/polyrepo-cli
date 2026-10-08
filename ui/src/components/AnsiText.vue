<script setup lang="ts">
import { computed } from 'vue'
import { ansiSegments } from '../ansi'

const props = defineProps<{ text: string }>()
const segments = computed(() => ansiSegments(props.text))
</script>

<template>
  <span class="ansi"
    ><span v-for="(segment, index) in segments" :key="index" :class="segment.cls">{{
      segment.text
    }}</span></span
  >
</template>

<style lang="scss">
.ansi {
  .a-bold {
    font-weight: 700;
  }
  .a-dim {
    opacity: 0.62;
  }
  .a-italic {
    font-style: italic;
  }
  .a-underline {
    text-decoration: underline;
  }
  .a-red {
    color: var(--danger);
  }
  .a-green {
    color: var(--ok);
  }
  .a-yellow {
    color: var(--warn);
  }
  .a-blue {
    color: var(--accent);
  }
  .a-magenta {
    color: #b052d6;
  }
  .a-cyan {
    color: #1d97ad;
  }
  .a-white,
  .a-bright-white {
    color: var(--text);
  }
  .a-black,
  .a-bright-black {
    color: var(--muted);
  }
  .a-bright-red {
    color: var(--danger);
  }
  .a-bright-green {
    color: var(--ok);
  }
  .a-bright-yellow {
    color: var(--warn);
  }
  .a-bright-blue {
    color: var(--accent);
  }
  .a-bright-magenta {
    color: #b052d6;
  }
  .a-bright-cyan {
    color: #1d97ad;
  }
}
</style>
