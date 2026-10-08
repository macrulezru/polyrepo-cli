<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { TableCell } from '../api'
import { stripAnsi } from '../ansi'
import { groupColor } from '../groupColors'
import AnsiText from './AnsiText.vue'
import Icon from './Icon.vue'
import StatusChip, { type ChipTone } from './StatusChip.vue'

interface Row {
  gap: boolean
  cells: TableCell[]
}

const props = withDefaults(
  defineProps<{
    columns: string[]
    rows: Row[]
    selectable?: boolean
    groupable?: boolean
    filterable?: boolean
    rowFilter?: ((row: Row) => boolean) | undefined
    initialFilter?: string | undefined
    actionLabel?: string | undefined
  }>(),
  { selectable: false, groupable: true, filterable: true },
)

const emit = defineEmits<{ action: [key: string] }>()
const picked = defineModel<string[]>('picked', { default: () => [] })

const filter = ref(props.initialFilter ?? '')
const sortColumn = ref(-1)
const sortDesc = ref(false)
const collapsed = ref<string[]>([])

watch(
  () => props.initialFilter,
  (value) => {
    filter.value = value ?? ''
  },
)

interface Entry {
  row: Row
  index: number
}

interface Block {
  name: string
  mono: boolean
  entries: Entry[]
}

const CHIP_COLUMNS = ['Branch', 'Git', 'Release', 'npm', 'Deps']

const entries = computed(() => {
  const needle = filter.value.trim().toLowerCase()
  let result: Entry[] = props.rows.map((row, index) => ({ row, index }))
  const extra = props.rowFilter
  if (extra) result = result.filter(({ row }) => extra(row))
  if (needle !== '') {
    result = result.filter(({ row }) =>
      row.cells.some((cell) => stripAnsi(cell.text).toLowerCase().includes(needle)),
    )
  }
  if (sortColumn.value >= 0) {
    const column = sortColumn.value
    const direction = sortDesc.value ? -1 : 1
    result = [...result].sort(
      (a, b) =>
        direction *
        stripAnsi(a.row.cells[column]?.text ?? '').localeCompare(
          stripAnsi(b.row.cells[column]?.text ?? ''),
          undefined,
          { numeric: true },
        ),
    )
  }
  return result
})

function keyOf(index: number): string {
  return stripAnsi(props.rows[index]?.cells[0]?.text ?? '')
}

const blocks = computed<Block[]>(() => {
  const single: Entry[] = []
  const byName = new Map<string, Block>()
  for (const entry of entries.value) {
    const key = keyOf(entry.index)
    const slash = key.indexOf('/')
    if (!props.groupable || slash <= 0) {
      single.push(entry)
      continue
    }
    const name = key.slice(0, slash)
    let block = byName.get(name)
    if (!block) {
      block = { name, mono: true, entries: [] }
      byName.set(name, block)
    }
    block.entries.push(entry)
  }
  const monos = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
  const result: Block[] = []
  if (single.length > 0) result.push({ name: '', mono: false, entries: single })
  return [...result, ...monos]
})

const allNames = computed(() => [...new Set(blocks.value.filter((b) => b.mono).map((b) => b.name))])

function colorOf(block: Block): string {
  return groupColor(block.name, allNames.value)
}

function memberName(index: number): string {
  const key = keyOf(index)
  return key.slice(key.indexOf('/') + 1)
}

function blockKeys(block: Block): string[] {
  return block.entries.map(({ index }) => keyOf(index))
}

function blockState(block: Block): 'all' | 'some' | 'none' {
  const keys = blockKeys(block)
  const count = keys.filter((key) => picked.value.includes(key)).length
  return count === 0 ? 'none' : count === keys.length ? 'all' : 'some'
}

function toggleBlock(block: Block): void {
  const keys = blockKeys(block)
  picked.value =
    blockState(block) === 'all'
      ? picked.value.filter((key) => !keys.includes(key))
      : [...new Set([...picked.value, ...keys])]
}

function toggleFold(name: string): void {
  collapsed.value = collapsed.value.includes(name)
    ? collapsed.value.filter((value) => value !== name)
    : [...collapsed.value, name]
}

function sortBy(column: number): void {
  if (sortColumn.value === column) sortDesc.value = !sortDesc.value
  else {
    sortColumn.value = column
    sortDesc.value = false
  }
}

function toggle(key: string): void {
  picked.value = picked.value.includes(key)
    ? picked.value.filter((value) => value !== key)
    : [...picked.value, key]
}

function pickShown(): void {
  picked.value = [...new Set([...picked.value, ...entries.value.map(({ index }) => keyOf(index))])]
}

function chipTone(column: string, cell: TableCell): ChipTone {
  const text = stripAnsi(cell.text)
  if (column === 'Git') return text === 'dirty' ? 'danger' : 'ok'
  const styled = cell.styled
  if (/\x1b\[31m/.test(styled)) return 'danger'
  if (/\x1b\[33m/.test(styled)) return 'warn'
  if (/\x1b\[32m/.test(styled)) return 'ok'
  if (/\x1b\[3[46]m/.test(styled)) return 'info'
  return 'muted'
}

function isChip(column: string, cell: TableCell | undefined): boolean {
  if (!cell || !CHIP_COLUMNS.includes(column)) return false
  const text = stripAnsi(cell.text).trim()
  return text !== '' && text !== '—' && text !== '-'
}

interface Track {
  min: number
  fr: number
}

const TRACKS: Record<string, Track> = {
  Package: { min: 150, fr: 2.2 },
  Local: { min: 70, fr: 0.6 },
  Origin: { min: 70, fr: 0.6 },
  Branch: { min: 92, fr: 0.8 },
  Git: { min: 76, fr: 0.5 },
  Tag: { min: 120, fr: 2.4 },
  Release: { min: 68, fr: 0.4 },
  npm: { min: 104, fr: 0.9 },
  Deps: { min: 60, fr: 0.4 },
}

const FALLBACK: Track = { min: 100, fr: 1 }
const GAP = 12

function trackFor(column: string, index: number): Track {
  if (index === 0) return TRACKS.Package ?? FALLBACK
  return TRACKS[column] ?? FALLBACK
}

const template = computed(() => {
  const parts = [
    ...(props.selectable ? ['34px'] : []),
    ...props.columns.map((column, index) => {
      const track = trackFor(column, index)
      return `minmax(${track.min}px, ${track.fr}fr)`
    }),
    ...(props.actionLabel ? ['auto'] : []),
  ]
  return parts.join(' ')
})

const minWidth = computed(() => {
  const tracks = props.columns.map((column, index) => trackFor(column, index).min)
  const count = tracks.length + (props.selectable ? 1 : 0) + (props.actionLabel ? 1 : 0)
  const total =
    tracks.reduce((sum, value) => sum + value, 0) +
    (props.selectable ? 34 : 0) +
    (props.actionLabel ? 100 : 0)
  return `${total + (count - 1) * GAP + 24}px`
})
</script>

<template>
  <div class="rt">
    <div v-if="filterable || selectable || $slots.actions" class="rt__bar">
      <input
        v-if="filterable"
        v-model="filter"
        class="input rt__filter"
        placeholder="Filter the table"
      />
      <span class="rt__spacer" />
      <div v-if="selectable" class="rt__group" role="group" aria-label="Selection">
        <span class="muted rt__count">{{ picked.length }} selected</span>
        <button
          class="btn btn--small"
          title="Select every package in the table (only the matching ones while a filter is on)"
          @click="pickShown"
        >
          Select all
        </button>
        <button class="btn btn--small" :disabled="!picked.length" @click="picked = []">
          Unselect
        </button>
      </div>
      <div v-if="$slots.actions" class="rt__group" role="group" aria-label="Actions">
        <slot name="actions" :picked="picked" />
      </div>
    </div>

    <div class="rt__scroll">
      <div class="rt__sheet" :style="{ '--cols': template, minWidth }">
        <div class="g g--head" role="row">
          <span v-if="selectable" />
          <button
            v-for="(column, index) in columns"
            :key="column"
            class="g__sort"
            :aria-sort="sortColumn === index ? (sortDesc ? 'descending' : 'ascending') : 'none'"
            @click="sortBy(index)"
          >
            {{ column }}
            <Icon
              v-if="sortColumn === index"
              class="g__arrow"
              :name="sortDesc ? 'chevdown' : 'chevup'"
              :size="13"
            />
          </button>
          <span v-if="actionLabel" />
        </div>

        <p v-if="entries.length === 0" class="muted rt__none">No rows match.</p>

        <section
          v-for="block in blocks"
          :key="block.name || '(single)'"
          class="blk"
          :class="{ 'blk--mono': block.mono }"
          :style="block.mono ? { '--gc': colorOf(block) } : undefined"
        >
          <div v-if="block.mono" class="g g--title">
            <span v-if="selectable" class="g__pick">
              <input
                type="checkbox"
                :checked="blockState(block) === 'all'"
                :indeterminate="blockState(block) === 'some'"
                :aria-label="`Select all of ${block.name}`"
                @change="toggleBlock(block)"
              />
            </span>
            <button
              class="blk__fold"
              :aria-expanded="!collapsed.includes(block.name)"
              @click="toggleFold(block.name)"
            >
              <Icon :name="collapsed.includes(block.name) ? 'right' : 'chevdown'" :size="14" />
              <span class="blk__name">{{ block.name }}</span>
              <span class="blk__count">{{ block.entries.length }} packages</span>
              <span class="blk__tag">monorepo</span>
            </button>
          </div>
          <div v-else-if="blocks.length > 1" class="blk__single-title">
            Single packages <span class="blk__count">{{ block.entries.length }}</span>
          </div>

          <template v-if="!block.mono || !collapsed.includes(block.name)">
            <div
              v-for="{ row, index } in block.entries"
              :key="index"
              class="g g--row"
              :class="{ 'g--on': picked.includes(keyOf(index)) }"
              role="row"
            >
              <span v-if="selectable" class="g__pick">
                <input
                  type="checkbox"
                  :checked="picked.includes(keyOf(index))"
                  :aria-label="`Select ${keyOf(index)}`"
                  @change="toggle(keyOf(index))"
                />
              </span>
              <template v-for="(cell, cellIndex) in row.cells" :key="cellIndex">
                <span
                  v-if="cellIndex === 0"
                  class="g__name"
                  :class="{ 'g__name--member': block.mono }"
                  :title="keyOf(index)"
                  >{{ block.mono ? memberName(index) : keyOf(index) }}</span
                >
                <span v-else-if="isChip(columns[cellIndex] ?? '', cell)" class="g__cell">
                  <StatusChip
                    :tone="chipTone(columns[cellIndex] ?? '', cell)"
                    :title="stripAnsi(cell.text)"
                    >{{ stripAnsi(cell.text) }}</StatusChip
                  >
                </span>
                <span v-else class="g__cell g__cell--text" :title="stripAnsi(cell.text)">
                  <AnsiText :text="cell.styled" />
                </span>
              </template>
              <span v-if="actionLabel" class="g__cell">
                <button class="btn btn--small" @click="emit('action', keyOf(index))">
                  {{ actionLabel }}
                </button>
              </span>
            </div>
          </template>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.rt {
  @include stack($space-3);
  min-width: 0;

  &__bar {
    @include cluster($space-3);
  }

  &__spacer {
    flex: 1;
  }

  &__group {
    @include cluster($space-2);
    padding: 3px $space-2;
    border: 1px solid var(--border);
    border-radius: $radius-md;
    background: var(--surface-2);
  }

  &__count {
    padding: 0 $space-1;
    font-size: 13px;
  }

  &__filter {
    width: 240px;
    height: $control-height-sm + 2;
  }

  &__scroll {
    overflow-x: auto;
    padding-bottom: $space-1;
  }

  &__sheet {
    @include stack($space-3);
  }

  &__none {
    padding: $space-4;
  }
}

.g {
  display: grid;
  grid-template-columns: var(--cols);
  align-items: center;
  column-gap: 12px;
  padding: 0 $space-3;
  font-size: 13px;

  &--head {
    padding: 0 $space-3 0 calc(#{$space-3} + 1px);
    margin-bottom: -$space-1;
  }

  &--row {
    min-height: 36px;
    border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
    transition: background $transition-fast;

    &:first-of-type,
    .blk__single-title + & {
      border-top: 0;
    }

    &:hover {
      background: var(--surface-2);
    }
  }

  &--on {
    background: var(--accent-soft) !important;
  }

  &--title {
    min-height: 40px;
  }

  &__sort {
    @include eyebrow;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 4px 0;
    border: 0;
    background: transparent;
    cursor: pointer;
    text-align: left;
    @include focus-ring;
  }

  &__pick {
    display: flex;
    align-items: center;

    + .blk__fold {
      grid-column: 2 / -1;
    }
  }

  &__name {
    font-family: $font-mono;
    font-weight: 600;
    @include truncate;

    &--member {
      padding-left: $space-4;
      font-weight: 500;
    }
  }

  &__cell {
    min-width: 0;
    font-family: $font-mono;
    @include truncate;
  }
}

.blk {
  @include surface($radius-lg);
  overflow: hidden;

  &--mono {
    --gc: var(--accent);
    background: color-mix(in srgb, var(--gc) 7%, var(--surface));
    border-color: color-mix(in srgb, var(--gc) 45%, var(--border));
    box-shadow: inset 4px 0 0 var(--gc);

    .g--title {
      background: color-mix(in srgb, var(--gc) 20%, var(--surface));
    }

    .g--row {
      border-top-color: color-mix(in srgb, var(--gc) 18%, transparent);

      &:hover {
        background: color-mix(in srgb, var(--gc) 14%, var(--surface));
      }
    }
  }

  &__fold {
    grid-column: 1 / -1;
    display: inline-flex;
    align-items: center;
    gap: $space-2;
    padding: 8px 0;
    border: 0;
    background: transparent;
    cursor: pointer;
    text-align: left;
    font-family: $font-sans;
    @include focus-ring;
  }

  &__name {
    font-size: $font-size-md;
    font-weight: 700;
    color: var(--gc);
  }

  &__count {
    color: var(--muted);
    font-size: $font-size-sm;
  }

  &__tag {
    padding: 0 8px;
    border-radius: $radius-pill;
    background: color-mix(in srgb, var(--gc) 22%, transparent);
    color: var(--gc);
    font-size: $font-size-xs;
  }

  &__single-title {
    display: flex;
    gap: $space-2;
    align-items: baseline;
    padding: 8px $space-3;
    background: var(--surface-2);
    font-weight: 600;
  }
}
</style>
