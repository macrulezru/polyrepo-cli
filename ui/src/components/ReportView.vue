<script setup lang="ts">
import { computed } from 'vue'
import type { LogBuilder, LogItem } from '../logModel'
import { itemText } from '../logModel'
import { buildReport, type Problem, type ReportGroup } from '../reportModel'
import { stripAnsi } from '../ansi'
import { resolvePackageDirs, store } from '../store'
import { changesDependencies, requestExec } from '../actions'
import { stepsAfter, stepsForProblem, type StepContext } from '../nextSteps'
import type { RunSummary } from '../api'
import NextSteps from './NextSteps.vue'
import LoadingState from './LoadingState.vue'
import AnsiText from './AnsiText.vue'
import AuditFixPanel from './AuditFixPanel.vue'
import ChangesPanel from './ChangesPanel.vue'
import ReportTable from './ReportTable.vue'

const props = defineProps<{
  builder: LogBuilder
  tick: number
  running: boolean
  command?: string | undefined
  run?: RunSummary | undefined
  previous?: string[] | null | undefined
}>()
const emit = defineEmits<{ showLog: [text?: string] }>()

const report = computed(() => {
  void props.tick
  return buildReport(props.builder)
})

function problemKey(problem: Problem): string {
  return stripAnsi(`${problem.where}|${problem.text}`)
}

const newKeys = computed(() => {
  if (!props.previous) return new Set<string>()
  const before = new Set(props.previous)
  return new Set(report.value.problems.map(problemKey).filter((key) => !before.has(key)))
})

const resolved = computed(() => {
  if (!props.previous || props.running) return 0
  const now = new Set(report.value.problems.map(problemKey))
  return props.previous.filter((key) => !now.has(key)).length
})

function packagesIn(text: string): string[] {
  const words = new Set(stripAnsi(text).split(/[\s,:()]+/))
  return store.packages.map((pkg) => pkg.dir).filter((dir) => words.has(dir))
}

const tableAction = computed(() =>
  props.command === 'outdated'
    ? 'Update dependencies…'
    : props.command === 'audit'
      ? 'Fix vulnerabilities…'
      : undefined,
)

function onTableAction(key: string): void {
  const cmd = props.command === 'audit' ? 'npm audit fix' : 'npm update'
  requestExec(key, cmd, {
    note:
      props.command === 'audit'
        ? 'Applies the fixes npm can make without breaking changes.'
        : 'Updates the dependencies within the ranges in package.json.',
  })
}

const empty = computed(() => report.value.blocks.length === 0)
const hasCounts = computed(
  () => report.value.ok + report.value.warn + report.value.fail + report.value.steps > 0,
)

function mark(level: string): string {
  return level === 'ok' ? '✓' : level === 'fail' ? '✗' : level === 'warn' ? '!' : '·'
}

function outputText(items: LogItem[]): string {
  return items.map(itemText).join('\n')
}

function ctxFor(problem: Problem): StepContext {
  const dirs = [...new Set([...resolvePackageDirs(problem.where), ...packagesIn(problem.text)])]
  return {
    command: props.command ?? '',
    dirs,
    runId: props.run?.id ?? '',
    options: props.run?.options ?? {},
  }
}

const recovery = computed(() => {
  const run = props.run
  if (!run || props.running) return []
  const unfinished =
    run.status === 'cancelled' ||
    !!run.error ||
    (run.status === 'failed' && report.value.problems.length === 0)
  if (!unfinished) return []
  return [
    { id: 'again', label: 'Run again', primary: true, action: { type: 'rerun' as const } },
    { id: 'log', label: 'Read the log', action: { type: 'log' as const } },
    {
      id: 'doctor',
      label: 'Check your setup (doctor)',
      hint: 'Looks for a missing tool, a sign-in or a config problem',
      action: { type: 'form' as const, command: 'doctor', query: {} },
    },
  ]
})

const nextSteps = computed(() => {
  const run = props.run
  if (!run || props.running || report.value.fail > 0 || report.value.ok === 0) return []
  if (run.status === 'cancelled') return []
  const dirs = report.value.blocks.flatMap((block) =>
    block.kind === 'steps' ? block.cards.flatMap((card) => resolvePackageDirs(card.title)) : [],
  )
  const fromOptions = Array.isArray(run.options.packages) ? run.options.packages.map(String) : []
  const texts = report.value.blocks.flatMap((block) =>
    block.kind === 'steps'
      ? block.cards.flatMap((card) =>
          card.statuses.map((item) => (item.kind === 'status' ? stripAnsi(item.text) : '')),
        )
      : [],
  )
  const opened = texts.find((text) => /Opened (PR|MR) #/.test(text))
  const url = opened ? (/https?:\/\/\S+/.exec(opened)?.[0] ?? '') : ''
  return stepsAfter(run, [...new Set(dirs.length ? dirs : fromOptions)], url)
})

function knownDir(dir: string): boolean {
  return store.packages.some((pkg) => pkg.dir === dir)
}

function suggestion(card: ReportGroup): string {
  return card.commands.some((line) => /\baudit\s+fix\b/.test(line))
    ? 'chore: npm audit fix'
    : 'chore: update dependencies'
}

function summaryText(group: ReportGroup): string {
  const parts: string[] = []
  if (group.fail) parts.push(`${group.fail} failed`)
  if (group.warn) parts.push(`${group.warn} warning${group.warn === 1 ? '' : 's'}`)
  if (group.ok) parts.push(`${group.ok} passed`)
  return parts.join(' · ')
}
</script>

<template>
  <div class="rep">
    <LoadingState v-if="empty && running" text="Waiting for results…" />
    <p v-else-if="empty" class="muted">This run produced nothing to report.</p>

    <div v-if="hasCounts" class="rep__tiles">
      <div class="tile tile--ok">
        <span class="tile__n">{{ report.ok }}</span>
        <span class="tile__l">passed</span>
      </div>
      <div class="tile tile--warn" :class="{ 'tile--zero': !report.warn }">
        <span class="tile__n">{{ report.warn }}</span>
        <span class="tile__l">warnings</span>
      </div>
      <div class="tile tile--fail" :class="{ 'tile--zero': !report.fail }">
        <span class="tile__n">{{ report.fail }}</span>
        <span class="tile__l">failures</span>
      </div>
      <div v-if="report.steps" class="tile">
        <span class="tile__n">{{ report.steps }}</span>
        <span class="tile__l">packages</span>
      </div>
    </div>

    <p v-if="previous && resolved > 0" class="notice rep__note">
      {{ resolved }} problem{{ resolved === 1 ? '' : 's' }} from the previous run
      {{ resolved === 1 ? 'is' : 'are' }}
      gone.
    </p>

    <section v-if="report.problems.length" class="card attn">
      <h2 class="attn__title">Needs attention</h2>
      <ul class="attn__list">
        <li
          v-for="(problem, index) in report.problems"
          :key="index"
          class="attn__row"
          :class="`attn__row--${problem.level}`"
        >
          <span class="attn__mark">{{ mark(problem.level) }}</span>
          <span v-if="problem.where" class="attn__where">{{ problem.where }}</span>
          <button
            class="attn__text"
            title="Show in the log"
            @click="emit('showLog', stripAnsi(problem.text))"
          >
            <AnsiText :text="problem.text" />
          </button>
          <span v-if="newKeys.has(problemKey(problem))" class="attn__new">new</span>
          <a
            v-for="dir in packagesIn(problem.text)"
            :key="dir"
            class="attn__pkg"
            :href="`#/packages?filter=${encodeURIComponent(dir)}`"
            >{{ dir }}</a
          >
          <NextSteps
            :steps="stepsForProblem(stripAnsi(problem.text), problem.level, ctxFor(problem))"
            :ctx="ctxFor(problem)"
            @log="emit('showLog', stripAnsi(problem.text))"
          />
        </li>
      </ul>
    </section>

    <section v-if="recovery.length" class="card attn attn--next">
      <h2 class="attn__title">
        {{ run?.status === 'cancelled' ? 'The run was cancelled' : 'The run did not finish' }}
      </h2>
      <p v-if="run?.error" class="muted">{{ run.error }}</p>
      <NextSteps
        :steps="recovery"
        :ctx="{
          command: command ?? '',
          dirs: [],
          runId: run?.id ?? '',
          options: run?.options ?? {},
        }"
        @log="emit('showLog')"
      />
    </section>

    <section v-if="nextSteps.length" class="card attn attn--next">
      <h2 class="attn__title">What next?</h2>
      <NextSteps
        :steps="nextSteps"
        :ctx="{
          command: command ?? '',
          dirs: [],
          runId: run?.id ?? '',
          options: run?.options ?? {},
        }"
      />
    </section>

    <template v-for="(block, blockIndex) in report.blocks" :key="blockIndex">
      <ul v-if="block.kind === 'notes'" class="notes">
        <li v-for="(item, index) in block.items" :key="index">
          <span
            v-if="item.kind === 'status'"
            class="notes__mark"
            :class="`notes__mark--${item.level}`"
            >{{ mark(item.level) }}</span
          >
          <AnsiText :text="item.kind === 'status' || item.kind === 'line' ? item.text : ''" />
        </li>
      </ul>

      <div v-else-if="block.kind === 'table'" class="rep__table">
        <h2 v-if="block.title" class="rep__heading">{{ block.title }}</h2>
        <ReportTable
          :columns="block.table.columns"
          :rows="block.table.rows"
          :action-label="tableAction"
          :action-icon="command === 'audit' ? 'wrench' : 'sync'"
          @action="onTableAction"
        />
      </div>

      <details
        v-else-if="block.kind === 'group'"
        class="card grp"
        :class="`grp--${block.group.health}`"
        :open="block.group.health !== 'ok'"
      >
        <summary class="grp__head">
          <span class="grp__mark">{{ mark(block.group.health) }}</span>
          <span class="grp__title">{{ block.group.title }}</span>
          <span class="muted grp__sum">{{ summaryText(block.group) }}</span>
        </summary>
        <ul class="grp__body">
          <li
            v-for="(item, index) in block.group.statuses"
            :key="index"
            class="row"
            :class="item.kind === 'status' ? `row--${item.level}` : ''"
          >
            <template v-if="item.kind === 'status'">
              <span class="row__mark">{{ mark(item.level) }}</span>
              <AnsiText :text="item.text" />
            </template>
          </li>
          <li v-for="(item, index) in block.group.notes" :key="`n${index}`" class="row row--note">
            <AnsiText :text="item.kind === 'line' ? item.text : ''" />
          </li>
        </ul>
      </details>

      <div v-else-if="block.kind === 'steps'" class="steps">
        <article
          v-for="(card, index) in block.cards"
          :key="index"
          class="card step"
          :class="[
            `step--${card.health}`,
            { 'step--wide': block.cards.length === 1 || card.output.length > 12 },
          ]"
        >
          <header class="step__head">
            <span class="step__mark">{{ mark(card.health) }}</span>
            <span class="step__title">{{ card.title }}</span>
          </header>
          <ul class="step__body">
            <li
              v-for="(item, rowIndex) in card.statuses"
              :key="rowIndex"
              class="row"
              :class="item.kind === 'status' ? `row--${item.level}` : ''"
            >
              <template v-if="item.kind === 'status'">
                <span class="row__mark">{{ mark(item.level) }}</span>
                <AnsiText :text="item.text" />
              </template>
            </li>
            <li v-for="(item, rowIndex) in card.notes" :key="`n${rowIndex}`" class="row row--note">
              <AnsiText :text="item.kind === 'line' ? item.text : ''" />
            </li>
          </ul>
          <div
            v-for="(table, tableIndex) in card.tables"
            :key="`t${tableIndex}`"
            class="step__table"
          >
            <ReportTable
              :columns="table.columns"
              :rows="table.rows"
              :filterable="false"
              :groupable="false"
            />
          </div>
          <AuditFixPanel
            v-if="card.audit && card.audit.total > 0 && knownDir(card.title)"
            :audit="card.audit"
            :dir="card.title"
          />
          <ChangesPanel
            v-if="!running && knownDir(card.title) && changesDependencies(card.commands)"
            :dir="card.title"
            :suggested="suggestion(card)"
          />
          <details
            v-if="card.output.length"
            class="step__out"
            :open="card.output.length <= 12 || card.health === 'fail'"
          >
            <summary>Output</summary>
            <pre>{{ outputText(card.output) }}</pre>
          </details>
        </article>
      </div>
    </template>

    <p v-if="!empty" class="muted rep__foot">
      Need every line?
      <button class="rep__link" @click="emit('showLog')">Open the full log</button>
    </p>
  </div>
</template>

<style scoped lang="scss">
.rep {
  @include stack($space-4);

  &__tiles {
    display: flex;
    flex-wrap: wrap;
    gap: $space-3;
  }

  &__heading {
    margin-bottom: $space-2;
    font-size: $font-size-md;
  }

  &__note {
    font-size: 13px;
  }

  &__foot {
    font-size: 13px;
  }

  &__link {
    border: 0;
    background: transparent;
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline;
    padding: 0;
  }
}

.tile {
  @include surface;
  display: flex;
  flex-direction: column;
  min-width: 120px;
  padding: $space-3 $space-4;

  &__n {
    font-size: $font-size-xl;
    font-weight: 700;
    line-height: 1.1;
  }

  &__l {
    @include eyebrow;
  }

  &--ok &__n {
    color: var(--ok);
  }
  &--warn &__n {
    color: var(--warn);
  }
  &--fail &__n {
    color: var(--danger);
  }
  &--zero {
    opacity: 0.55;
  }
}

.attn {
  @include stack($space-2);
  padding: $space-3 $space-4;
  border-color: color-mix(in srgb, var(--warn) 50%, var(--border));

  &--next {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  }

  &__title {
    font-size: $font-size-md;
  }

  &__list {
    @include stack(4px);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  &__row {
    display: flex;
    flex-wrap: wrap;
    gap: $space-2;

    &--warn {
      color: var(--warn);
    }
    &--fail {
      color: var(--danger);
    }
  }

  &__mark {
    font-weight: 700;
  }

  &__text {
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    padding: 0;
    text-align: left;
    font: inherit;
  }

  &__new {
    padding: 0 8px;
    border-radius: $radius-pill;
    background: var(--danger-soft);
    color: var(--danger);
    font-size: $font-size-xs;
    font-weight: 700;
  }

  &__pkg {
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: $radius-pill;
    color: var(--accent);
    font-size: $font-size-xs;
    text-decoration: none;
  }

  &__where {
    padding: 0 8px;
    border-radius: $radius-pill;
    background: var(--surface-2);
    color: var(--text);
    font-size: $font-size-sm;
  }
}

.notes {
  @include stack(2px);
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--muted);

  &__mark {
    margin-right: $space-2;
    font-weight: 700;

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
}

.grp {
  border-left: 4px solid var(--border);

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
    gap: $space-3;
    padding: $space-3 $space-4;
    cursor: pointer;
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
  }

  &__sum {
    font-size: $font-size-sm;
  }

  &__body {
    @include stack(2px);
    margin: 0;
    padding: 0 $space-4 $space-3 $space-6;
    list-style: none;
  }
}

.row {
  display: flex;
  gap: $space-2;
  padding: 1px $space-2;
  border-radius: $radius-sm;
  word-break: break-word;

  &__mark {
    flex: none;
    font-weight: 700;
  }

  &--ok &__mark {
    color: var(--ok);
  }
  &--warn {
    background: var(--warn-soft);
    color: var(--warn);
  }
  &--fail {
    background: var(--danger-soft);
    color: var(--danger);
  }
  &--note {
    color: var(--muted);
  }
}

.steps {
  display: grid;
  gap: $space-3;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
}

.step {
  @include stack($space-2);
  padding: $space-3 $space-4;
  border-top: 3px solid var(--border);
  min-width: 0;

  &--ok {
    border-top-color: var(--ok);
  }
  &--warn {
    border-top-color: var(--warn);
  }
  &--fail {
    border-top-color: var(--danger);
  }

  &__head {
    display: flex;
    align-items: center;
    gap: $space-2;
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
    font-weight: 600;
    @include truncate;
  }

  &__body {
    @include stack(2px);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  &__table {
    overflow-x: auto;
  }

  &--wide {
    grid-column: 1 / -1;
  }

  &--wide &__out pre {
    max-height: 480px;
  }

  &__out {
    font-size: 13px;

    summary {
      cursor: pointer;
      color: var(--muted);
    }

    pre {
      @include scroll-area;
      margin: $space-2 0 0;
      max-height: 220px;
      padding: $space-2;
      border-radius: $radius-sm;
      background: var(--surface-2);
      white-space: pre-wrap;
      word-break: break-word;
      font-size: $font-size-sm;
    }
  }
}
</style>
