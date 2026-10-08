<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { api, formatDuration, formatWhen, type RunEntry } from '../api'
import { stripAnsi } from '../ansi'
import { LogBuilder } from '../logModel'
import { buildReport } from '../reportModel'
import { useRun } from '../composables/useRun'
import { navigate } from '../router'
import { loadRuns, store } from '../store'
import Icon from '../components/Icon.vue'
import PageHeader from '../components/PageHeader.vue'
import LogView from '../components/LogView.vue'
import ReportView from '../components/ReportView.vue'
import UiSegmented from '../ui-components/UiSegmented.vue'
import PromptModal from '../components/PromptModal.vue'
import StatusBadge from '../components/StatusBadge.vue'

const props = defineProps<{ id: string }>()
const runId = computed(() => props.id)
const { summary, builder, tick, pending, running, error, eventCount, answer, cancel } =
  useRun(runId)

const chosen = ref<'report' | 'log' | ''>('')
const view = computed<'report' | 'log'>(() => chosen.value || (running.value ? 'log' : 'report'))
const views = [
  { value: 'report' as const, label: 'Report' },
  { value: 'log' as const, label: 'Log' },
]
const viewModel = computed({
  get: () => view.value,
  set: (value: 'report' | 'log') => {
    chosen.value = value
  },
})

const logSearch = ref('')
const previous = ref<string[] | null>(null)

function showLog(text?: string): void {
  logSearch.value = text ?? ''
  chosen.value = 'log'
}

watch(
  () => [summary.value?.id, summary.value?.status, store.runs.length] as const,
  async () => {
    const current = summary.value
    if (!current || current.status === 'running' || current.status === 'waiting') return
    const earlier = store.runs.find(
      (run) =>
        run.command === current.command &&
        run.id !== current.id &&
        run.startedAt < current.startedAt &&
        (run.status === 'done' || run.status === 'failed'),
    )
    if (!earlier) {
      previous.value = null
      return
    }
    try {
      const entries = await api.get<RunEntry[]>(`/api/runs/${earlier.id}/log`)
      const old = new LogBuilder()
      for (const entry of entries) old.push(entry.event)
      previous.value = buildReport(old).problems.map((problem) =>
        stripAnsi(`${problem.where}|${problem.text}`),
      )
    } catch {
      previous.value = null
    }
  },
  { immediate: true },
)

const badge = computed(() => {
  void tick.value
  const status = summary.value?.status ?? 'running'
  const report = buildReport(builder.value)
  if (status === 'failed' && report.partial) return 'partial' as const
  if (status === 'done' && report.fail === 0 && report.warn > 0 && report.ok === 0) {
    return 'attention' as const
  }
  return status
})

const isDryRun = computed(() => summary.value?.options.dryRun === true)

function again(real: boolean): void {
  if (!summary.value) return
  navigate('commands', summary.value.command, {
    from: summary.value.id,
    ...(real ? { real: '1' } : {}),
  })
}

const now = ref(Date.now())
const timer = setInterval(() => {
  now.value = Date.now()
}, 1000)
onBeforeUnmount(() => {
  clearInterval(timer)
  void loadRuns()
})

const duration = computed(() => {
  void now.value
  return summary.value ? formatDuration(summary.value.startedAt, summary.value.finishedAt) : ''
})

const optionList = computed(() => {
  const options = summary.value?.options ?? {}
  return Object.entries(options)
    .filter(
      ([key, value]) => key !== 'yes' && value !== false && value !== '' && value !== undefined,
    )
    .map(([key, value]) => {
      if (value === true) return key
      if (Array.isArray(value))
        return `${key}: ${value.length > 3 ? `${value.length} packages` : value.join(', ')}`
      return `${key}: ${String(value)}`
    })
})

function onAnswer(value: unknown): void {
  if (pending.value) void answer(pending.value.id, value)
}
</script>

<template>
  <div class="run">
    <PageHeader :title="summary?.title ?? 'Run'">
      <template #lead>
        <button class="btn btn--small btn--ghost" title="All runs" @click="navigate('runs')">
          <Icon name="left" :size="14" />
          Runs
        </button>
      </template>
      <template #badges>
        <StatusBadge v-if="summary" :status="badge" />
        <span v-if="summary" class="muted run__meta">
          {{ duration }} · {{ formatWhen(summary.startedAt) }}
        </span>
      </template>
      <template #actions>
        <UiSegmented v-model="viewModel" :options="views" label="View" />
        <button v-if="running" class="btn btn--danger" @click="cancel">Cancel run</button>
        <button v-if="summary && !running" class="btn" @click="again(false)">
          <Icon name="play" :size="14" />
          Run again
        </button>
      </template>
    </PageHeader>

    <div v-if="optionList.length" class="run__options">
      <span v-for="option in optionList" :key="option" class="run__chip">{{ option }}</span>
    </div>

    <p v-if="isDryRun && !running" class="notice run__dry">
      <span>This was a dry run: nothing was changed.</span>
      <button class="btn btn--small btn--primary" @click="again(true)">Run for real…</button>
    </p>
    <p v-if="error" class="notice notice--error">{{ error }}</p>
    <p v-if="summary?.error" class="notice notice--error">{{ summary.error }}</p>
    <p v-if="summary?.status === 'waiting' && pending" class="notice">
      The command is waiting for your answer.
    </p>

    <div v-if="view === 'report'" class="run__report">
      <ReportView
        :builder="builder"
        :tick="tick"
        :running="running"
        :command="summary?.command"
        :run="summary"
        :previous="previous"
        @show-log="showLog"
      />
    </div>
    <LogView
      v-else
      :builder="builder"
      :tick="tick"
      :running="running"
      :initial-search="logSearch"
      :file-name="`polyrepo-${summary?.command ?? 'run'}-${props.id}.log`"
    />

    <footer v-if="summary" class="run__foot muted">
      {{ eventCount }} events · run {{ summary.id
      }}<template v-if="summary.exitCode !== null"> · exit code {{ summary.exitCode }}</template>
    </footer>

    <PromptModal
      v-if="pending"
      :key="pending.id"
      :question="pending.question"
      @answer="onAnswer"
      @cancel="cancel"
    />
  </div>
</template>

<style scoped lang="scss">
.run {
  @include stack($space-3);
  height: 100%;
  min-height: 0;

  &__dry {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: $space-3;
  }

  &__meta {
    font-size: $font-size-sm;
  }

  &__report {
    @include scroll-area;
    flex: 1;
    min-height: 0;
    padding-right: $space-1;
  }

  &__options {
    @include cluster($space-2);
  }

  &__chip {
    padding: 1px 10px;
    border-radius: $radius-pill;
    background: var(--surface-2);
    border: 1px solid var(--border);
    font-size: $font-size-sm;
  }

  &__foot {
    font-size: $font-size-sm;
  }
}
</style>
