<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { api, dayLabel, formatDuration, type RunSummary } from '../api'
import { COMMAND_ICONS } from '../commandIcons'
import { hrefFor } from '../router'
import { loadRuns, store } from '../store'
import EmptyState from '../components/EmptyState.vue'
import Icon from '../components/Icon.vue'
import PageHeader from '../components/PageHeader.vue'
import StatusBadge from '../components/StatusBadge.vue'

const filter = ref('')
const status = ref<'all' | 'problems' | 'active' | 'done'>('all')
const error = ref('')
let timer = 0

const STATUSES = [
  { id: 'all' as const, label: 'All' },
  { id: 'active' as const, label: 'Running' },
  { id: 'problems' as const, label: 'Problems' },
  { id: 'done' as const, label: 'Done' },
]

function isActive(run: RunSummary): boolean {
  return run.status === 'running' || run.status === 'waiting'
}

function hasProblems(run: RunSummary): boolean {
  return run.status === 'failed' || (run.stats?.fail ?? 0) > 0 || (run.stats?.warn ?? 0) > 0
}

const rows = computed(() => {
  const needle = filter.value.trim().toLowerCase()
  return store.runs.filter((run) => {
    if (status.value === 'active' && !isActive(run)) return false
    if (status.value === 'problems' && !hasProblems(run)) return false
    if (status.value === 'done' && (run.status !== 'done' || hasProblems(run))) return false
    return (
      needle === '' ||
      run.title.toLowerCase().includes(needle) ||
      run.command.toLowerCase().includes(needle)
    )
  })
})

const days = computed(() => {
  const result: { label: string; runs: RunSummary[] }[] = []
  for (const run of rows.value) {
    const label = dayLabel(run.startedAt)
    const last = result[result.length - 1]
    if (last && last.label === label) last.runs.push(run)
    else result.push({ label, runs: [run] })
  }
  return result
})

const finished = computed(() => store.runs.filter((run) => !isActive(run)))

function time(run: RunSummary): string {
  return new Date(run.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function took(run: RunSummary): string {
  if (isActive(run)) return formatDuration(run.startedAt, null)
  return run.finishedAt ? formatDuration(run.startedAt, run.finishedAt) : ''
}

function result(run: RunSummary): string {
  const stats = run.stats
  if (!stats) return ''
  const parts: string[] = []
  if (stats.steps > 0) parts.push(`${stats.steps} package${stats.steps === 1 ? '' : 's'}`)
  if (stats.fail > 0) parts.push(`${stats.fail} failed`)
  if (stats.warn > 0) parts.push(`${stats.warn} warning${stats.warn === 1 ? '' : 's'}`)
  if (parts.length === 0 && stats.ok > 0) parts.push(`${stats.ok} passed`)
  return parts.join(' · ')
}

async function remove(id: string): Promise<void> {
  try {
    await api.post(`/api/runs/${id}/remove`)
    await loadRuns()
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
}

async function clearFinished(keep: number): Promise<void> {
  error.value = ''
  const old = finished.value.slice(keep)
  for (const run of old) {
    try {
      await api.post(`/api/runs/${run.id}/remove`)
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : String(caught)
      break
    }
  }
  await loadRuns()
}

onMounted(() => {
  void loadRuns()
  timer = window.setInterval(loadRuns, 3000)
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <div class="page">
    <PageHeader title="Runs" :subtitle="`${store.runs.length} kept in the history`">
      <template #actions>
        <input v-model="filter" class="input page__filter" placeholder="Filter runs" />
        <button
          class="btn"
          :disabled="finished.length <= 20"
          title="Delete every finished run except the newest 20"
          @click="clearFinished(20)"
        >
          <Icon name="trash" :size="14" />
          Keep last 20
        </button>
      </template>
    </PageHeader>

    <div class="seg" role="group" aria-label="Show">
      <button
        v-for="item in STATUSES"
        :key="item.id"
        class="seg__btn"
        :class="{ 'seg__btn--on': status === item.id }"
        @click="status = item.id"
      >
        {{ item.label }}
      </button>
    </div>

    <p v-if="error" class="notice notice--error">{{ error }}</p>

    <EmptyState
      v-if="store.runs.length === 0"
      icon="outdated"
      title="Nothing has run yet"
      text="Every command you start from here is kept with its full log, so you can come back to it later."
    >
      <a class="btn btn--primary" :href="hrefFor('commands')">Choose a command</a>
    </EmptyState>
    <p v-else-if="rows.length === 0" class="muted">No runs match.</p>

    <section v-for="day in days" :key="day.label" class="day">
      <h2 class="day__label">{{ day.label }}</h2>
      <ul class="runs">
        <li v-for="run in day.runs" :key="run.id" class="runs__row card">
          <a class="runs__link" :href="hrefFor('runs', run.id)">
            <span class="runs__icon"
              ><Icon :name="COMMAND_ICONS[run.command] ?? 'play'" :size="16"
            /></span>
            <span class="runs__main">
              <span class="runs__title">{{ run.title }}</span>
              <span v-if="result(run)" class="muted runs__result">{{ result(run) }}</span>
            </span>
            <StatusBadge :status="run.status" />
            <span class="muted runs__when"
              >{{ time(run) }}<template v-if="took(run)"> · {{ took(run) }}</template></span
            >
          </a>
          <button
            class="btn btn--small btn--ghost btn--danger"
            :disabled="isActive(run)"
            title="Delete this run"
            @click="remove(run.id)"
          >
            <Icon name="trash" :size="14" />
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped lang="scss">
.page {
  @include stack($space-3);

  &__filter {
    width: 220px;
  }
}

.seg {
  display: inline-flex;
  align-self: flex-start;
  padding: 3px;
  border: 1px solid var(--border);
  border-radius: $radius-md;
  background: var(--surface-2);

  &__btn {
    padding: 4px 14px;
    border: 0;
    border-radius: $radius-md - 3;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    @include focus-ring;

    &--on {
      background: var(--surface);
      color: var(--text);
      font-weight: 600;
      box-shadow: var(--shadow);
    }
  }
}

.day {
  @include stack($space-2);

  &__label {
    @include eyebrow;
    margin-top: $space-2;
  }
}

.runs {
  @include stack($space-2);
  margin: 0;
  padding: 0;
  list-style: none;

  &__row {
    display: flex;
    align-items: center;
    padding-right: $space-2;
  }

  &__link {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: $space-3;
    padding: $space-3 $space-4;
    color: inherit;
    text-decoration: none;
  }

  &__icon {
    @include icon-tile(30px);
    flex: none;
    border-radius: $radius-md;
    background: var(--accent-soft);
    color: var(--accent);
  }

  &__main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  &__title {
    font-weight: 600;
    @include truncate;
  }

  &__result {
    font-size: $font-size-sm;
  }

  &__when {
    font-size: $font-size-sm;
    white-space: nowrap;
  }
}
</style>
