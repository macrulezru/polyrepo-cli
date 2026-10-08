<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ diff: string }>()

interface Token {
  text: string
  cls: string
}

interface DiffLine {
  type: 'ctx' | 'add' | 'del'
  text: string
  oldNo: number | null
  newNo: number | null
}

interface Hunk {
  header: string
  lines: DiffLine[]
}

const PATTERN =
  /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],:])/g

function tokens(text: string): Token[] {
  const result: Token[] = []
  let last = 0
  for (const match of text.matchAll(PATTERN)) {
    const index = match.index ?? 0
    if (index > last) result.push({ text: text.slice(last, index), cls: '' })
    if (match[1] !== undefined) {
      result.push({ text: match[1], cls: match[2] ? 'key' : 'str' })
      if (match[2]) result.push({ text: match[2], cls: 'punct' })
    } else if (match[3] !== undefined) result.push({ text: match[3], cls: 'num' })
    else if (match[4] !== undefined) result.push({ text: match[4], cls: 'kw' })
    else result.push({ text: match[5] ?? '', cls: 'punct' })
    last = index + match[0].length
  }
  if (last < text.length) result.push({ text: text.slice(last), cls: '' })
  return result
}

const hunks = computed<Hunk[]>(() => {
  const found: Hunk[] = []
  let current: Hunk | undefined
  let oldNo = 0
  let newNo = 0
  for (const raw of props.diff.split('\n')) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw)
    if (header) {
      oldNo = Number(header[1])
      newNo = Number(header[2])
      current = { header: raw, lines: [] }
      found.push(current)
      continue
    }
    if (!current || raw.startsWith('\\')) continue
    const mark = raw[0]
    if (mark === '+')
      current.lines.push({ type: 'add', text: raw.slice(1), oldNo: null, newNo: newNo++ })
    else if (mark === '-')
      current.lines.push({ type: 'del', text: raw.slice(1), oldNo: oldNo++, newNo: null })
    else if (mark === ' ') {
      current.lines.push({ type: 'ctx', text: raw.slice(1), oldNo: oldNo++, newNo: newNo++ })
    }
  }
  return found
})

function sign(type: DiffLine['type']): string {
  return type === 'add' ? '+' : type === 'del' ? '−' : ' '
}
</script>

<template>
  <div class="diff" role="region" aria-label="Changes in this file">
    <section v-for="(hunk, index) in hunks" :key="index" class="hunk">
      <div class="hunk__head">{{ hunk.header }}</div>
      <div v-for="(line, at) in hunk.lines" :key="at" class="row" :class="`row--${line.type}`">
        <span class="row__no">{{ line.oldNo ?? '' }}</span>
        <span class="row__no">{{ line.newNo ?? '' }}</span>
        <span class="row__sign">{{ sign(line.type) }}</span>
        <span class="row__text"
          ><span v-for="(token, tokenAt) in tokens(line.text)" :key="tokenAt" :class="token.cls">{{
            token.text
          }}</span
          ><span v-if="line.text === ''">&nbsp;</span></span
        >
      </div>
    </section>
    <p v-if="hunks.length === 0" class="muted diff__none">No textual changes to show.</p>
  </div>
</template>

<style scoped lang="scss">
.diff {
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: $radius-md;
  background: var(--surface-2);
  font-family: $font-mono;
  font-size: $font-size-sm;
  line-height: 1.6;
  max-height: 460px;

  &__none {
    padding: $space-3;
  }
}

.hunk {
  min-width: max-content;

  &__head {
    padding: 2px $space-3;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: $font-size-xs;
  }
}

.row {
  display: flex;

  &--add {
    background: color-mix(in srgb, var(--ok) 16%, transparent);
  }

  &--del {
    background: color-mix(in srgb, var(--danger) 16%, transparent);
  }

  &__no {
    flex: none;
    width: 4ch;
    padding: 0 6px;
    color: var(--muted);
    text-align: right;
    user-select: none;
  }

  &__sign {
    flex: none;
    width: 2ch;
    color: var(--muted);
    user-select: none;
  }

  &--add &__sign {
    color: var(--ok);
  }

  &--del &__sign {
    color: var(--danger);
  }

  &__text {
    white-space: pre;
    padding-right: $space-4;
  }
}

.key {
  color: var(--accent);
}

.str {
  color: var(--ok);
}

.num {
  color: var(--warn);
}

.kw {
  color: #b052d6;
}

.punct {
  color: var(--muted);
}
</style>
