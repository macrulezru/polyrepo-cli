<script setup lang="ts">
import { computed } from 'vue'
import { ansiSegments } from '../ansi'

const props = defineProps<{ text: string }>()
const URL_PATTERN = /(https?:\/\/[^\s<>"'`)\]]+)/g

interface Part {
  text: string
  cls: string
  href?: string
}

const segments = computed<Part[]>(() => {
  const parts: Part[] = []
  for (const segment of ansiSegments(props.text)) {
    let last = 0
    for (const match of segment.text.matchAll(URL_PATTERN)) {
      const index = match.index ?? 0
      if (index > last) parts.push({ text: segment.text.slice(last, index), cls: segment.cls })
      const url = match[0].replace(/[.,;:]+$/, '')
      parts.push({ text: url, cls: segment.cls, href: url })
      last = index + url.length
    }
    if (last < segment.text.length) {
      parts.push({ text: segment.text.slice(last), cls: segment.cls })
    }
  }
  return parts
})
</script>

<template>
  <span class="ansi"
    ><template v-for="(segment, index) in segments" :key="index"
      ><a
        v-if="segment.href"
        class="ansi__link"
        :class="segment.cls"
        :href="segment.href"
        target="_blank"
        rel="noopener noreferrer"
        >{{ segment.text }}</a
      ><span v-else :class="segment.cls">{{ segment.text }}</span></template
    ></span
  >
</template>

<style lang="scss">
.ansi {
  .ansi__link {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

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
