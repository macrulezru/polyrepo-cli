<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { api, type CommandInfo, type CommandOption, type RunSummary } from '../api'
import { hrefFor, navigate, useRoute } from '../router'
import { askNotificationPermission, loadPackages, loadRuns, store } from '../store'
import { COMMAND_ICONS } from '../commandIcons'
import Icon from '../components/Icon.vue'
import PackagePicker from '../components/PackagePicker.vue'
import PageHeader from '../components/PageHeader.vue'
import UiModal from '../ui-components/UiModal.vue'

const props = defineProps<{ command: CommandInfo }>()
const route = useRoute()

const values = reactive<Record<string, boolean | string>>({})
const picked = ref<string[]>([])
const errors = reactive<Record<string, string>>({})
const error = ref('')
const confirming = ref(false)
const starting = ref(false)
const fromQuery = ref(0)
const fromRun = ref('')
const root = ref<HTMLElement>()

const optionGroups = computed(() => {
  const fields = props.command.options.filter((option) => option.type !== 'boolean')
  const flags = props.command.options.filter((option) => option.type === 'boolean')
  return [
    { id: 'fields', options: fields },
    { id: 'flags', options: flags },
  ].filter((group) => group.options.some((option) => visible(option)))
})

const hasDryRun = computed(() => props.command.options.some((option) => option.key === 'dryRun'))

async function prefill(): Promise<void> {
  const command = props.command
  for (const key of Object.keys(values)) delete values[key]
  for (const key of Object.keys(errors)) delete errors[key]
  for (const option of command.options) values[option.key] = option.default
  picked.value = []
  error.value = ''
  fromQuery.value = 0
  fromRun.value = ''
  if (command.packages !== 'none' && store.packages.length === 0) await loadPackages()

  const query = route.value.query
  const runId = query.get('from')
  if (runId) {
    try {
      const run = await api.get<RunSummary>(`/api/runs/${runId}`)
      if (run.command === command.id) {
        fromRun.value = run.title
        for (const option of command.options) {
          const saved = run.options[option.key]
          const expected = option.type === 'boolean' ? 'boolean' : 'string'
          if (saved !== undefined && typeof saved === expected) {
            values[option.key] = saved as boolean | string
          }
        }
        if (Array.isArray(run.options.packages)) picked.value = run.options.packages.map(String)
      }
    } catch {
      fromRun.value = ''
    }
  }
  for (const option of command.options) {
    const given = query.get(`o_${option.key}`)
    if (given !== null) values[option.key] = option.type === 'boolean' ? given === '1' : given
  }
  if (query.get('real') === '1' && hasDryRun.value) values.dryRun = false
  const names = (query.get('packages') ?? '').split(',').filter((name) => name !== '')
  if (names.length > 0) {
    picked.value = names.filter((name) => store.packages.some((pkg) => pkg.dir === name))
    fromQuery.value = picked.value.length
  }
  picked.value = picked.value.filter((name) => store.packages.some((pkg) => pkg.dir === name))
}

watch(() => [props.command, route.value.query.toString()], prefill, { immediate: true })

function visible(option: CommandOption): boolean {
  if (!option.showWhen) return true
  return option.showWhen.in.includes(String(values[option.showWhen.key]))
}

function disabled(option: CommandOption): boolean {
  return option.requires ? values[option.requires] !== true : false
}

watch(
  () => ({ ...values }),
  () => {
    for (const option of props.command.options) {
      if (option.requires && values[option.requires] !== true && values[option.key] === true) {
        values[option.key] = false
      }
      if (errors[option.key] && String(values[option.key] ?? '').trim() !== '') {
        delete errors[option.key]
      }
    }
  },
)

const writes = computed(
  () =>
    props.command.mutating ||
    props.command.options.some((option) => option.writes && values[option.key] === true),
)

const dryRun = computed(() => values.dryRun === true)

function validate(): boolean {
  for (const key of Object.keys(errors)) delete errors[key]
  for (const option of props.command.options) {
    if (option.required && visible(option) && String(values[option.key] ?? '').trim() === '') {
      errors[option.key] = `${option.label} is required.`
    }
  }
  if (props.command.id === 'bump' && values.bumpType === 'custom') {
    if (String(values.customVersion ?? '').trim() === '') {
      errors.customVersion = 'Enter the exact version.'
    }
    if (picked.value.length !== 1) errors.packages = 'An exact version needs exactly one package.'
  }
  return Object.keys(errors).length === 0
}

function buildOptions(preview: boolean): Record<string, unknown> {
  const options: Record<string, unknown> = {}
  for (const option of props.command.options) {
    if (visible(option)) options[option.key] = values[option.key]
  }
  if (preview) options.dryRun = true
  if (props.command.packages !== 'none' && picked.value.length > 0) options.packages = picked.value
  return options
}

const optionLines = computed(() => {
  const lines: string[] = []
  for (const option of props.command.options) {
    if (!visible(option)) continue
    const value = values[option.key]
    if (value === true) lines.push(option.label)
    else if (typeof value === 'string' && value !== '' && option.key !== 'otp') {
      lines.push(`${option.label}: ${value}`)
    }
  }
  return lines
})

const dangers = computed(() =>
  props.command.options.filter((option) => option.danger && values[option.key] === true),
)

async function start(preview = false): Promise<void> {
  if (starting.value) return
  starting.value = true
  error.value = ''
  try {
    const run = await api.post<RunSummary>('/api/runs', {
      command: props.command.id,
      options: buildOptions(preview),
      confirmed: writes.value ? true : undefined,
    })
    askNotificationPermission()
    await loadRuns()
    navigate('runs', run.id)
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
    confirming.value = false
  } finally {
    starting.value = false
  }
}

async function submit(): Promise<void> {
  if (!validate()) {
    await nextTick()
    const first = root.value?.querySelector<HTMLElement>('.field--error input, .pick--error')
    first?.focus()
    first?.scrollIntoView({ block: 'center' })
    return
  }
  error.value = ''
  if (writes.value && !dryRun.value) confirming.value = true
  else void start()
}

const shownPackages = computed(() => picked.value.slice(0, 12))

function clearPreselected(): void {
  picked.value = []
  fromQuery.value = 0
}
</script>

<template>
  <div ref="root" class="form">
    <PageHeader :title="command.title" :subtitle="command.summary">
      <template #lead>
        <a class="btn btn--small btn--ghost" :href="hrefFor('commands')">
          <Icon name="left" :size="14" />
          Commands
        </a>
        <span class="form__icon"
          ><Icon :name="COMMAND_ICONS[command.id] ?? 'play'" :size="20"
        /></span>
      </template>
      <template #badges>
        <span v-if="command.mutating" class="form__tag">changes things</span>
      </template>
    </PageHeader>

    <p v-if="fromRun" class="notice">
      Settings copied from the earlier run “{{ fromRun }}”. Change anything before starting.
    </p>

    <div class="form__cols">
      <section v-if="command.options.length > 0" class="card form__options">
        <span class="label">Options</span>
        <div
          v-for="group in optionGroups"
          :key="group.id"
          class="form__optgrid"
          :class="`form__optgrid--${group.id}`"
        >
          <template v-for="option in group.options" :key="option.key">
            <div v-if="visible(option)" class="opt" :class="{ 'opt--danger': option.danger }">
              <label v-if="option.type === 'boolean'" class="check opt__check">
                <input v-model="values[option.key]" type="checkbox" :disabled="disabled(option)" />
                <span>{{ option.label }}</span>
              </label>
              <label v-else-if="option.type === 'select'" class="field">
                <span>{{ option.label }}</span>
                <select v-model="values[option.key]" class="select">
                  <option v-for="choice in option.choices" :key="choice" :value="choice">
                    {{ choice }}
                  </option>
                </select>
              </label>
              <label v-else class="field" :class="{ 'field--error': errors[option.key] }">
                <span>{{ option.label }}<template v-if="option.required"> *</template></span>
                <input
                  v-model="values[option.key]"
                  class="input"
                  :class="{ 'input--error': errors[option.key] }"
                  :placeholder="option.help"
                  spellcheck="false"
                  @keydown.enter="submit"
                />
              </label>
              <p v-if="errors[option.key]" class="form__err">{{ errors[option.key] }}</p>
              <p v-if="option.type !== 'text'" class="muted opt__help">{{ option.help }}</p>
              <p
                v-if="option.danger && values[option.key] === true"
                class="notice notice--error opt__warn"
              >
                {{ option.help }} This cannot be undone.
              </p>
            </div>
          </template>
        </div>
      </section>
      <div v-if="command.packages !== 'none'" class="form__left">
        <p v-if="fromQuery > 0" class="notice form__pre">
          <span
            >{{ fromQuery }} package{{ fromQuery === 1 ? '' : 's' }} preselected from the
            table.</span
          >
          <button class="btn btn--small btn--ghost" @click="clearPreselected">Clear</button>
        </p>
        <PackagePicker
          v-model="picked"
          :registry="command.id === 'publish'"
          :class="{ 'pick--error': errors.packages }"
          :hint="
            command.packages === 'filter'
              ? 'Leave empty for every package.'
              : 'Leave empty to choose when the command asks.'
          "
        />
        <p v-if="errors.packages" class="form__err">{{ errors.packages }}</p>
      </div>
    </div>

    <p v-if="error" class="notice notice--error">{{ error }}</p>

    <div class="form__actions">
      <button class="btn btn--primary" :disabled="starting" @click="submit">
        <Icon name="play" :size="14" />
        {{ dryRun ? 'Start dry run' : writes ? 'Review and run' : 'Start' }}
      </button>
      <span v-if="writes && !dryRun" class="muted"
        >You will see a summary before anything changes.</span
      >
    </div>

    <UiModal v-if="confirming" title="Run this command?" width="560px" @close="confirming = false">
      <div class="confirm">
        <p>
          <code>polyrepo {{ command.id }}</code> will make real changes.
        </p>
        <div v-if="command.packages !== 'none'">
          <span class="label">Packages</span>
          <p v-if="picked.length === 0" class="muted">
            You will choose them when the command asks.
          </p>
          <ul v-else class="confirm__list">
            <li v-for="name in shownPackages" :key="name">{{ name }}</li>
            <li v-if="picked.length > shownPackages.length" class="muted">
              and {{ picked.length - shownPackages.length }} more
            </li>
          </ul>
        </div>
        <div v-if="optionLines.length">
          <span class="label">Options</span>
          <ul class="confirm__list">
            <li v-for="line in optionLines" :key="line">{{ line }}</li>
          </ul>
        </div>
        <p v-for="option in dangers" :key="option.key" class="notice notice--error">
          {{ option.label }}: {{ option.help }}
        </p>
        <p v-if="hasDryRun" class="muted confirm__tip">
          Not sure? Preview first: the same run without changing anything.
        </p>
      </div>
      <template #footer>
        <span class="form__spacer" />
        <button class="btn" @click="confirming = false">Back</button>
        <button v-if="hasDryRun" class="btn" :disabled="starting" @click="start(true)">
          Preview (dry run)
        </button>
        <button class="btn btn--primary" :disabled="starting" @click="start()">Run it</button>
      </template>
    </UiModal>
  </div>
</template>

<style scoped lang="scss">
.form {
  @include stack($space-4);

  &__icon {
    @include icon-tile(34px);
    border-radius: $radius-md;
    background: var(--accent-soft);
    color: var(--accent);
  }

  &__tag {
    padding: 0 8px;
    border-radius: $radius-pill;
    background: var(--warn-soft);
    color: var(--warn);
    font-size: $font-size-xs;
  }

  &__cols {
    display: grid;
    gap: $space-4;
    grid-template-columns: minmax(0, 1fr);
    align-items: start;
  }

  &__optgrid {
    display: grid;
    gap: $space-3 $space-5;
    grid-template-columns: repeat(auto-fill, minmax(260px, 380px));
    justify-content: start;
    align-items: start;

    &--flags {
      grid-template-columns: repeat(auto-fill, minmax(260px, 380px));
    }
  }

  &__left {
    @include stack($space-2);
  }

  &__pre {
    display: flex;
    align-items: center;
    gap: $space-3;
    justify-content: space-between;
  }

  &__options {
    @include stack($space-3);
    padding: $space-4;
  }

  &__spacer {
    flex: 1;
  }

  &__err {
    color: var(--danger);
    font-size: $font-size-sm;
  }

  &__actions {
    @include cluster($space-3);
    @include sticky-footer;
  }
}

.input--error {
  border-color: var(--danger);
  box-shadow: 0 0 0 1px var(--danger);
}

.pick--error {
  border-color: var(--danger);
}

.opt {
  @include stack(2px);

  &--danger .opt__check {
    color: var(--danger);
  }

  &__help {
    margin-left: 26px;
    font-size: $font-size-sm;
  }

  &__warn {
    margin-top: $space-2;
    font-size: 13px;
  }
}

.confirm {
  @include stack($space-3);
  padding: $space-4;

  &__list {
    margin: 4px 0 0;
    padding-left: $space-5;
  }

  &__tip {
    font-size: 13px;
  }
}
</style>
