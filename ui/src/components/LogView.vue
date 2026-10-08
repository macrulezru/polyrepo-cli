<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { healthOf, itemText, type LogBuilder, type LogItem, type LogSection } from '../logModel'
import AnsiText from './AnsiText.vue'
import Icon from './Icon.vue'
import { useCopy } from '../composables/useCopy'

const props = defineProps<{
  builder: LogBuilder
  tick: number
  running: boolean
  fileName: string
  initialSearch?: string | undefined
}>()

const search = ref(props.initialSearch ?? '')
const onlyProblems = ref(false)
const follow = ref(true)
const collapsed = reactive(new Set<number>())
const scroller = ref<HTMLElement>()
const { copied, copy } = useCopy()

const needle = computed(() => search.value.trim().toLowerCase())

function matches(item: LogItem): boolean {
  return itemText(item).toLowerCase().includes(needle.value)
}

const visible = computed(() => {
  void props.tick
  const result: { section: LogSection; items: LogItem[] }[] = []
  for (const section of props.builder.sections) {
    const health = healthOf(section)
    if (onlyProblems.value && section.title !== '' && health !== 'fail' && health !== 'warn')
      continue
    let items = section.items
    if (needle.value !== '') {
      const titleHit = section.title.toLowerCase().includes(needle.value)
      if (!titleHit) items = items.filter(matches)
      if (items.length === 0 && !titleHit) continue
    }
    if (section.title === '' && items.length === 0) continue
    result.push({ section, items })
  }
  return result
})

const totals = computed(() => {
  void props.tick
  let ok = 0
  let fail = 0
  let warn = 0
  let steps = 0
  for (const section of props.builder.sections) {
    ok += section.ok
    fail += section.fail
    warn += section.warn
    if (section.title !== '') steps += 1
  }
  return { ok, fail, warn, steps }
})

function toggle(id: number): void {
  if (collapsed.has(id)) collapsed.delete(id)
  else collapsed.add(id)
}

function collapseAll(): void {
  for (const section of props.builder.sections) {
    if (section.title !== '') collapsed.add(section.id)
  }
}

function expandAll(): void {
  collapsed.clear()
}

function onScroll(): void {
  const el = scroller.value
  if (!el) return
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  if (!atBottom && follow.value) follow.value = false
}

function toBottom(): void {
  const el = scroller.value
  if (el) el.scrollTop = el.scrollHeight
}

watch(
  () => props.tick,
  async () => {
    if (!follow.value) return
    await nextTick()
    toBottom()
  },
)

watch(follow, async (on) => {
  if (!on) return
  await nextTick()
  toBottom()
})

function download(): void {
  const blob = new Blob([props.builder.text()], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = props.fileName
  link.click()
  URL.revokeObjectURL(url)
}

function commandLine(item: Extract<LogItem, { kind: 'command' }>): string {
  return [item.cmd, ...item.args].join(' ')
}

function healthIcon(section: LogSection): string {
  const health = healthOf(section)
  if (health === 'fail') return '✗'
  if (health === 'warn') return '!'
  if (health === 'ok') return '✓'
  return '·'
}
</script>

<template>
  <div class="log">
    <div class="log__bar">
      <label class="log__search">
        <Icon name="search" :size="15" />
        <input v-model="search" class="log__search-input" placeholder="Search the log" />
      </label>
      <label class="check log__problems">
        <input v-model="onlyProblems" type="checkbox" />
        <span>Only problems</span>
      </label>
      <span class="log__totals">
        <span v-if="totals.ok" class="log__total log__total--ok">✓ {{ totals.ok }}</span>
        <span v-if="totals.warn" class="log__total log__total--warn">! {{ totals.warn }}</span>
        <span v-if="totals.fail" class="log__total log__total--fail">✗ {{ totals.fail }}</span>
      </span>
      <span class="log__spacer" />
      <button
        v-if="totals.steps > 1"
        class="btn btn--small btn--ghost"
        title="Collapse every step"
        @click="collapseAll"
      >
        Collapse
      </button>
      <button v-if="collapsed.size" class="btn btn--small btn--ghost" @click="expandAll">
        Expand
      </button>
      <button
        class="btn btn--small"
        :class="{ 'log__follow--on': follow }"
        title="Keep the newest line in view"
        @click="follow = !follow"
      >
        <Icon name="down" :size="14" />
        Follow
      </button>
      <button class="btn btn--small" @click="copy('log', builder.text())">
        <Icon :name="copied === 'log' ? 'check' : 'copy'" :size="14" />
        {{ copied === 'log' ? 'Copied' : 'Copy' }}
      </button>
      <button class="btn btn--small" @click="download">
        <Icon name="download" :size="14" />
        Save
      </button>
    </div>

    <div ref="scroller" class="log__body" @scroll="onScroll">
      <p v-if="visible.length === 0" class="log__empty muted">
        {{ running ? 'Waiting for output…' : 'Nothing to show.' }}
      </p>
      <section
        v-for="entry in visible"
        :key="entry.section.id"
        class="sec"
        :class="entry.section.title !== '' ? `sec--${healthOf(entry.section)}` : 'sec--root'"
      >
        <button
          v-if="entry.section.title !== ''"
          class="sec__head"
          :aria-expanded="!collapsed.has(entry.section.id)"
          @click="toggle(entry.section.id)"
        >
          <Icon :name="collapsed.has(entry.section.id) ? 'right' : 'chevdown'" :size="14" />
          <span class="sec__mark">{{ healthIcon(entry.section) }}</span>
          <span class="sec__title">{{ entry.section.title }}</span>
          <span class="sec__count muted">{{ entry.section.index }}/{{ entry.section.total }}</span>
        </button>
        <div
          v-show="!collapsed.has(entry.section.id) || entry.section.title === ''"
          class="sec__body"
        >
          <template v-for="(item, index) in entry.items" :key="index">
            <div v-if="item.kind === 'blank'" class="it it--blank" />
            <div v-else-if="item.kind === 'heading'" class="it it--heading">
              <AnsiText :text="item.text" />
            </div>
            <div v-else-if="item.kind === 'line'" class="it it--line">
              <AnsiText :text="item.text" />
            </div>
            <div
              v-else-if="item.kind === 'status'"
              class="it it--status"
              :class="`it--${item.level}`"
            >
              <span class="it__mark">{{
                item.level === 'ok' ? '✓' : item.level === 'fail' ? '✗' : '!'
              }}</span>
              <AnsiText :text="item.text" />
            </div>
            <div
              v-else-if="item.kind === 'command'"
              class="it it--command"
              :class="{ 'it--mutating': item.mutating }"
            >
              <span v-if="item.dryRun" class="it__tag">dry-run</span>
              <span class="it__prompt">$</span>
              <code>{{ commandLine(item) }}</code>
            </div>
            <pre
              v-else-if="item.kind === 'output'"
              class="it it--output"
            ><AnsiText :text="item.text" /></pre>
            <pre
              v-else-if="item.kind === 'raw'"
              class="it it--raw"
              :class="{ 'it--stderr': item.stream === 'stderr' }"
            ><AnsiText :text="item.text" /></pre>
            <div v-else-if="item.kind === 'progress'" class="it it--progress">
              <span v-if="item.state === 'running'" class="spin" aria-hidden="true" />
              <span v-else class="it__mark it--ok">✓</span>
              <span>{{ item.message }}</span>
            </div>
            <div v-else-if="item.kind === 'table'" class="tbl">
              <table>
                <thead>
                  <tr>
                    <th v-for="column in item.columns" :key="column">{{ column }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(row, rowIndex) in item.rows"
                    :key="rowIndex"
                    :class="{ tbl__gap: row.gap }"
                  >
                    <td v-for="(cell, cellIndex) in row.cells" :key="cellIndex">
                      <AnsiText :text="cell.styled" />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
        </div>
      </section>
      <div v-if="running" class="log__live"><span class="spin" aria-hidden="true" />Running</div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.log {
  @include surface;
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;

  &__bar {
    @include cluster;
    padding: $space-2 $space-3;
    border-bottom: 1px solid var(--border);
  }

  &__search {
    @include control;
    display: flex;
    align-items: center;
    gap: $space-2;
    height: $control-height-sm + 2;
    width: 240px;
    max-width: 100%;
    color: var(--muted);
  }

  &__search-input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--text);
  }

  &__problems {
    font-size: 13px;
  }

  &__totals {
    @include cluster($space-2);
  }

  &__total {
    font-size: 13px;
    font-weight: 600;

    &--ok {
      color: var(--ok);
    }
    &--warn {
      color: var(--warn);
    }
    &--fail {
      color: var(--danger);
    }
  }

  &__spacer {
    flex: 1;
  }

  &__follow--on {
    background: var(--accent-soft);
    border-color: var(--accent);
  }

  &__body {
    @include scroll-area;
    flex: 1;
    min-height: 0;
    padding: $space-3;
    font-family: $font-mono;
    font-size: 13px;
    line-height: 1.55;
  }

  &__empty {
    font-family: $font-sans;
    padding: $space-4;
  }

  &__live {
    @include cluster;
    margin-top: $space-2;
    color: var(--muted);
    font-family: $font-sans;
  }
}

.sec {
  margin-bottom: $space-2;
  border-left: 3px solid var(--border);
  border-radius: 2px;

  &--root {
    border-left-color: transparent;
  }
  &--ok {
    border-left-color: var(--ok);
  }
  &--warn {
    border-left-color: var(--warn);
  }
  &--fail {
    border-left-color: var(--danger);
  }

  &__head {
    display: flex;
    align-items: center;
    gap: $space-2;
    width: 100%;
    padding: 4px $space-2;
    border: 0;
    background: var(--surface-2);
    text-align: left;
    cursor: pointer;
    font-family: $font-sans;
    @include focus-ring;
  }

  &__mark {
    font-weight: 700;
  }
  &--ok &__mark {
    color: var(--ok);
  }
  &--warn &__mark {
    color: var(--warn);
  }
  &--fail &__mark {
    color: var(--danger);
  }

  &__title {
    flex: 1;
    font-weight: 600;
    @include truncate;
  }

  &__body {
    padding: 2px $space-2 2px $space-3;
  }
}

.it {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;

  &--blank {
    height: 0.6em;
  }
  &--heading {
    margin: $space-2 0 2px;
    font-weight: 700;
    color: var(--accent);
  }
  &--status {
    display: flex;
    gap: $space-2;
  }
  &__mark {
    font-weight: 700;
  }
  &--ok {
    color: var(--ok);
  }
  &--warn {
    color: var(--warn);
  }
  &--fail {
    color: var(--danger);
  }
  &--command {
    color: var(--muted);
  }
  &--mutating code {
    color: var(--text);
  }
  &__tag {
    margin-right: $space-2;
    padding: 0 6px;
    border-radius: $radius-pill;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: $font-size-xs;
  }
  &__prompt {
    margin-right: 6px;
  }
  &--output,
  &--raw {
    font-family: inherit;
    color: var(--muted);
  }
  &--stderr {
    color: var(--warn);
  }
  &--progress {
    display: flex;
    align-items: center;
    gap: $space-2;
    color: var(--muted);
  }
}

.tbl {
  overflow-x: auto;
  margin: $space-2 0;

  table {
    border-collapse: collapse;
    font-size: 13px;
  }

  th {
    @include eyebrow;
    padding: 4px $space-4 4px 0;
    text-align: left;
    white-space: nowrap;
    border-bottom: 1px solid var(--border);
  }

  td {
    padding: 2px $space-4 2px 0;
    white-space: pre;
  }

  &__gap td {
    padding-top: $space-3;
  }
}

.spin {
  width: 12px;
  height: 12px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
