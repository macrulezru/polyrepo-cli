<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ago, api, type RunSummary, type TableCell } from '../api'
import { useRun } from '../composables/useRun'
import { navigate, useRoute } from '../router'
import { askNotificationPermission, loadPackages, loadRuns, store } from '../store'
import EmptyState from '../components/EmptyState.vue'
import Icon from '../components/Icon.vue'
import LoadingState from '../components/LoadingState.vue'
import Onboarding from '../components/Onboarding.vue'
import PageHeader from '../components/PageHeader.vue'
import ReportTable from '../components/ReportTable.vue'
import StatusBadge from '../components/StatusBadge.vue'
import { stripAnsi } from '../ansi'

const route = useRoute()
const picked = ref<string[]>([])
const error = ref('')
const startedId = ref('')
const quick = ref(false)
const chip = ref(route.value.query.get('chip') ?? '')

const latest = computed(() =>
  store.runs.find(
    (run) => run.command === 'list' && (run.status === 'done' || run.status === 'failed'),
  ),
)
const sourceId = computed(() => startedId.value || latest.value?.id || '')
const { summary, builder, tick, running, loaded } = useRun(sourceId)

const freshTable = computed(() => {
  void tick.value
  for (const section of builder.value.sections) {
    for (const item of section.items) if (item.kind === 'table') return item
  }
  return undefined
})

watch(freshTable, (found) => {
  if (found && sourceId.value) store.reportCache = { id: sourceId.value, table: found }
})

const baseTable = computed(() => {
  if (freshTable.value) return freshTable.value
  const cache = store.reportCache
  return cache && cache.id === sourceId.value ? cache.table : undefined
})

const table = computed(() => {
  const base = baseTable.value
  if (!base) return undefined
  const since = summary.value ? new Date(summary.value.startedAt).getTime() : 0
  const rows = base.rows.map((row) => {
    const key = stripAnsi(row.cells[0]?.text ?? '')
    const patch = store.patches[key]
    if (!patch || patch.at < since) return row
    const cells = base.columns.map((name, index) => {
      const at = patch.columns.indexOf(name)
      return (at >= 0 ? patch.cells[at] : undefined) ?? row.cells[index] ?? { text: '', styled: '' }
    })
    return { ...row, cells }
  })
  return { ...base, rows }
})

const YELLOW = /\x1b\[33m/

interface Chip {
  id: string
  label: string
  test: (cells: TableCell[]) => boolean
}

function columnOf(name: string): number {
  return table.value?.columns.indexOf(name) ?? -1
}

const CHIPS: { id: string; label: string; column: string; test: (cell: TableCell) => boolean }[] = [
  {
    id: 'dirty',
    label: 'Local changes',
    column: 'Git',
    test: (cell) => stripAnsi(cell.text) === 'dirty',
  },
  {
    id: 'branch',
    label: 'Off the main branch',
    column: 'Branch',
    test: (cell) => YELLOW.test(cell.styled),
  },
  {
    id: 'npm',
    label: 'Not on npm / behind',
    column: 'npm',
    test: (cell) => YELLOW.test(cell.styled),
  },
  {
    id: 'origin',
    label: 'Differs from origin',
    column: 'Origin',
    test: (cell) => YELLOW.test(cell.styled),
  },
  {
    id: 'deps',
    label: 'Stale dependencies',
    column: 'Deps',
    test: (cell) => YELLOW.test(cell.styled),
  },
]

const chips = computed<(Chip & { count: number })[]>(() => {
  const source = table.value
  if (!source) return []
  const result: (Chip & { count: number })[] = []
  for (const def of CHIPS) {
    const index = columnOf(def.column)
    if (index < 0) continue
    const test = (cells: TableCell[]): boolean => {
      const cell = cells[index]
      return cell ? def.test(cell) : false
    }
    const count = source.rows.filter((row) => test(row.cells)).length
    if (count > 0) result.push({ id: def.id, label: def.label, test, count })
  }
  return result
})

const rowFilter = computed(() => {
  const active = chips.value.find((item) => item.id === chip.value)
  if (!active) return undefined
  return (row: { cells: TableCell[] }) => active.test(row.cells)
})

const stale = computed(() => {
  const when = summary.value?.startedAt
  return when ? Date.now() - new Date(when).getTime() > 15 * 60 * 1000 : false
})

const initialFilter = computed(() => route.value.query.get('filter') ?? '')

async function refresh(): Promise<void> {
  error.value = ''
  store.reportStale = false
  try {
    const run = await api.post<RunSummary>('/api/runs', {
      command: 'list',
      options: { quick: quick.value },
    })
    askNotificationPermission()
    startedId.value = run.id
    await loadRuns()
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
}

const ACTIONS: { id: string; label: string }[] = [
  { id: 'bump', label: 'Bump' },
  { id: 'publish', label: 'Publish' },
  { id: 'tag', label: 'Tag' },
  { id: 'sync-deps', label: 'Sync deps' },
  { id: 'switch-default', label: 'Switch branch' },
  { id: 'exec', label: 'Run command' },
]

function act(id: string): void {
  navigate('commands', id, { packages: picked.value.join(',') })
}

function release(): void {
  navigate('release', '', picked.value.length ? { packages: picked.value.join(',') } : {})
}

onMounted(async () => {
  await Promise.all([loadRuns(), loadPackages()])
})
</script>

<template>
  <div class="page">
    <Onboarding v-if="store.packagesLoaded && store.packages.length === 0 && !running" />

    <template v-else>
      <PageHeader title="Packages" :subtitle="`${store.packages.length} found`">
        <template #actions>
          <label class="check" title="Skip the network checks">
            <input v-model="quick" type="checkbox" />
            <span>Quick</span>
          </label>
          <button class="btn" @click="release">
            <Icon name="rocket" :size="14" />
            Release…
          </button>
          <button class="btn btn--primary" :disabled="running" @click="refresh">
            <Icon name="play" :size="14" />
            {{ table ? 'Refresh' : 'Check packages' }}
          </button>
        </template>
      </PageHeader>

      <p v-if="error" class="notice notice--error">{{ error }}</p>
      <p v-for="warning in store.warnings" :key="warning" class="notice notice--warn">
        {{ warning }}
      </p>

      <p v-if="store.refreshing.length" class="muted page__source">
        <span class="page__spin" aria-hidden="true" />
        Updating {{ store.refreshing.length }} package{{
          store.refreshing.length === 1 ? '' : 's'
        }}…
      </p>
      <p v-if="store.reportStale && !store.refreshing.length" class="notice notice--warn">
        Some packages changed after the last check. Refresh to see their current state.
      </p>

      <p v-if="summary" class="muted page__source">
        <StatusBadge :status="summary.status" />
        Checked {{ ago(summary.startedAt) }}
        <span v-if="stale" class="page__stale">may be out of date</span>
        <a :href="`#/runs/${summary.id}`">Open the log</a>
      </p>

      <div v-if="chips.length" class="chips" role="group" aria-label="Needs attention">
        <span class="label">Needs attention</span>
        <button
          v-for="item in chips"
          :key="item.id"
          class="chips__chip"
          :class="{ 'chips__chip--on': chip === item.id }"
          @click="chip = chip === item.id ? '' : item.id"
        >
          {{ item.label }}
          <strong>{{ item.count }}</strong>
        </button>
      </div>
      <p v-else-if="table && !running && table.columns.includes('Deps')" class="notice chips__ok">
        Everything checked looks in order: no local changes, no drift, nothing waiting to publish.
      </p>

      <ReportTable
        v-if="table"
        v-model:picked="picked"
        :columns="table.columns"
        :rows="table.rows"
        :busy-keys="store.refreshing"
        :row-filter="rowFilter"
        :initial-filter="initialFilter"
        selectable
      >
        <template #actions>
          <button
            v-for="action in ACTIONS"
            :key="action.id"
            class="btn btn--small"
            :disabled="!picked.length"
            @click="act(action.id)"
          >
            {{ action.label }}
          </button>
        </template>
      </ReportTable>

      <LoadingState
        v-else-if="!store.packagesLoaded || (sourceId && !loaded && !running)"
        text="Loading packages…"
      />

      <template v-else-if="!running">
        <p v-if="summary?.status === 'failed'" class="notice notice--error page__failed">
          <span>The last check did not finish{{ summary.error ? `: ${summary.error}` : '' }}.</span>
          <a :href="`#/runs/${summary.id}`">Open its log</a>
          <a href="#/commands/doctor">Check your setup</a>
        </p>
        <EmptyState
          icon="layers"
          title="No report yet"
          text="Run a check to see versions, branches, git state, tags, releases and dependency drift for every package at a glance."
        >
          <button class="btn btn--primary" @click="refresh">
            <Icon name="play" :size="14" />
            Check packages
          </button>
        </EmptyState>
      </template>
      <LoadingState v-else text="Checking packages…" />
    </template>
  </div>
</template>

<style scoped lang="scss">
.page {
  @include stack($space-3);

  &__source {
    @include cluster($space-2);
    font-size: 13px;
  }

  &__spin {
    width: 12px;
    height: 12px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  &__failed {
    display: flex;
    flex-wrap: wrap;
    gap: $space-3;
  }

  &__stale {
    padding: 0 8px;
    border-radius: $radius-pill;
    background: var(--warn-soft);
    color: var(--warn);
    font-size: $font-size-xs;
  }
}

.chips {
  @include cluster($space-2);

  &__chip {
    display: inline-flex;
    align-items: center;
    gap: $space-2;
    padding: 4px 12px;
    border: 1px solid color-mix(in srgb, var(--warn) 45%, var(--border));
    border-radius: $radius-pill;
    background: var(--warn-soft);
    color: var(--warn);
    cursor: pointer;
    @include focus-ring;

    &--on {
      background: var(--warn);
      color: var(--bg);
      border-color: var(--warn);
    }
  }

  &__ok {
    font-size: 13px;
  }
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
