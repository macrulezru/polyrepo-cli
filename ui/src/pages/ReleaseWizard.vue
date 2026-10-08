<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { api, type RunSummary } from '../api'
import { navigate, useRoute } from '../router'
import { askNotificationPermission, loadPackages, loadRuns, store } from '../store'
import Icon from '../components/Icon.vue'
import PackagePicker from '../components/PackagePicker.vue'
import PageHeader from '../components/PageHeader.vue'

const route = useRoute()
const step = ref(1)
const picked = ref<string[]>([])
const starting = ref(false)
const error = ref('')
const form = reactive({
  bumpType: 'patch',
  preid: '',
  customVersion: '',
  waitChecks: false,
  publish: false,
  otp: '',
})

const STEPS = ['Packages', 'Version', 'Options', 'Review']
const KINDS = [
  { id: 'patch', label: 'Patch', hint: 'Bug fixes: 1.2.3 → 1.2.4' },
  { id: 'minor', label: 'Minor', hint: 'New features: 1.2.3 → 1.3.0' },
  { id: 'major', label: 'Major', hint: 'Breaking changes: 1.2.3 → 2.0.0' },
  { id: 'prerelease', label: 'Prerelease', hint: 'Next candidate: 1.2.3-alpha.0 → 1.2.3-alpha.1' },
  { id: 'custom', label: 'Exact version', hint: 'Type the version yourself (one package)' },
]

const selected = computed(() => store.packages.filter((pkg) => picked.value.includes(pkg.dir)))

const problem = computed(() => {
  if (step.value === 1 && picked.value.length === 0) return 'Pick at least one package.'
  if (step.value === 2 && form.bumpType === 'custom') {
    if (picked.value.length !== 1)
      return 'An exact version works for exactly one package. Go back and pick one.'
    if (form.customVersion.trim() === '') return 'Enter the exact version.'
  }
  return ''
})

function next(): void {
  if (problem.value) {
    error.value = problem.value
    return
  }
  error.value = ''
  step.value = Math.min(4, step.value + 1)
}

function back(): void {
  error.value = ''
  step.value = Math.max(1, step.value - 1)
}

function options(preview: boolean): Record<string, unknown> {
  const options: Record<string, unknown> = {
    packages: picked.value,
    bumpType: form.bumpType,
    waitChecks: form.waitChecks,
    publish: form.publish,
    dryRun: preview,
  }
  if (form.bumpType === 'prerelease' && form.preid.trim()) options.preid = form.preid.trim()
  if (form.bumpType === 'custom') options.customVersion = form.customVersion.trim()
  if (form.publish && form.otp.trim()) options.otp = form.otp.trim()
  return options
}

async function start(preview: boolean): Promise<void> {
  if (starting.value) return
  starting.value = true
  error.value = ''
  try {
    const run = await api.post<RunSummary>('/api/runs', {
      command: 'bump',
      title: preview ? 'Release preview' : 'Release',
      options: options(preview),
      confirmed: true,
    })
    askNotificationPermission()
    await loadRuns()
    navigate('runs', run.id)
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  } finally {
    starting.value = false
  }
}

onMounted(async () => {
  if (store.packages.length === 0) await loadPackages()
  const names = (route.value.query.get('packages') ?? '').split(',').filter(Boolean)
  picked.value = names.filter((name) => store.packages.some((pkg) => pkg.dir === name))
  if (picked.value.length > 0) step.value = 2
})
</script>

<template>
  <div class="wiz" :class="{ 'wiz--narrow': step > 1 }">
    <PageHeader
      title="Release"
      subtitle="Bump versions through a branch and a pull request, tag them, and optionally publish."
    />

    <ol class="wiz__steps">
      <li
        v-for="(label, index) in STEPS"
        :key="label"
        class="wiz__step"
        :class="{ 'wiz__step--on': step === index + 1, 'wiz__step--done': step > index + 1 }"
      >
        <button class="wiz__dot" :disabled="step <= index + 1" @click="step = index + 1">
          {{ step > index + 1 ? '✓' : index + 1 }}
        </button>
        <span>{{ label }}</span>
      </li>
    </ol>

    <section v-if="step === 1" class="wiz__body">
      <p class="muted">Which packages are you releasing?</p>
      <PackagePicker v-model="picked" />
    </section>

    <section v-else-if="step === 2" class="wiz__body">
      <p class="muted">How should the version move?</p>
      <div class="kinds">
        <label
          v-for="kind in KINDS"
          :key="kind.id"
          class="card kinds__card"
          :class="{ 'kinds__card--on': form.bumpType === kind.id }"
        >
          <input v-model="form.bumpType" type="radio" name="kind" :value="kind.id" />
          <span class="kinds__label">{{ kind.label }}</span>
          <span class="muted kinds__hint">{{ kind.hint }}</span>
        </label>
      </div>
      <label v-if="form.bumpType === 'prerelease'" class="field wiz__field">
        <span>Prerelease id</span>
        <input v-model="form.preid" class="input" placeholder="alpha, beta, rc…" />
      </label>
      <label v-if="form.bumpType === 'custom'" class="field wiz__field">
        <span>Exact version *</span>
        <input v-model="form.customVersion" class="input" placeholder="2.0.0-rc.1" />
      </label>
    </section>

    <section v-else-if="step === 3" class="wiz__body">
      <label class="check">
        <input v-model="form.waitChecks" type="checkbox" />
        <span>Wait for CI checks before merging each pull request</span>
      </label>
      <label class="check">
        <input v-model="form.publish" type="checkbox" />
        <span>Publish to npm right after tagging</span>
      </label>
      <label v-if="form.publish" class="field wiz__field">
        <span>One-time password (if your npm account uses 2FA)</span>
        <input v-model="form.otp" class="input" placeholder="123456" inputmode="numeric" />
        <small class="muted"
          >The code lives about 30 seconds, so enter it right before you start.</small
        >
      </label>
    </section>

    <section v-else class="wiz__body">
      <div class="card wiz__review">
        <h2>Ready to release</h2>
        <dl>
          <dt>Packages</dt>
          <dd>
            <span v-for="pkg in selected" :key="pkg.dir" class="wiz__chip">
              {{ pkg.dir }} <span class="muted">{{ pkg.version }}</span>
            </span>
          </dd>
          <dt>Version</dt>
          <dd>
            {{ KINDS.find((kind) => kind.id === form.bumpType)?.label }}
            <template v-if="form.bumpType === 'custom'"> → {{ form.customVersion }}</template>
            <template v-if="form.bumpType === 'prerelease' && form.preid">
              ({{ form.preid }})</template
            >
          </dd>
          <dt>Options</dt>
          <dd>
            {{ form.waitChecks ? 'Wait for CI' : 'Do not wait for CI' }} ·
            {{ form.publish ? 'publish to npm' : 'do not publish' }}
          </dd>
        </dl>
        <p class="notice">
          Preview runs every step without pushing, merging or tagging anything. It is the safest way
          to see what will happen.
        </p>
      </div>
    </section>

    <p v-if="error" class="notice notice--error">{{ error }}</p>

    <div class="wiz__nav">
      <button v-if="step > 1" class="btn" @click="back">
        <Icon name="left" :size="14" />
        Back
      </button>
      <span class="wiz__spacer" />
      <button v-if="step < 4" class="btn btn--primary" @click="next">
        Next
        <Icon name="right" :size="14" />
      </button>
      <template v-else>
        <button class="btn" :disabled="starting" @click="start(true)">Preview (dry run)</button>
        <button class="btn btn--primary" :disabled="starting" @click="start(false)">
          <Icon name="rocket" :size="14" />
          Release
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped lang="scss">
.wiz {
  @include stack($space-4);

  &--narrow {
    max-width: 820px;
  }

  &__steps {
    display: flex;
    gap: $space-5;
    margin: 0;
    padding: 0;
    list-style: none;
    flex-wrap: wrap;
  }

  &__step {
    display: flex;
    align-items: center;
    gap: $space-2;
    color: var(--muted);

    &--on {
      color: var(--text);
      font-weight: 600;
    }
  }

  &__dot {
    @include icon-tile(26px);
    border: 1px solid var(--border);
    border-radius: 50%;
    background: var(--surface);
    color: inherit;
    cursor: pointer;
    font-size: 13px;

    &:disabled {
      cursor: default;
    }
  }

  &__step--on &__dot {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-ink);
  }

  &__step--done &__dot {
    border-color: var(--ok);
    color: var(--ok);
  }

  &__body {
    @include stack($space-3);
  }

  &__field {
    max-width: 360px;
  }

  &__nav {
    @include cluster($space-2);
  }

  &__spacer {
    flex: 1;
  }

  &__review {
    @include stack($space-3);
    padding: $space-4;

    dl {
      display: grid;
      grid-template-columns: 110px 1fr;
      gap: $space-2 $space-3;
      margin: 0;
    }

    dt {
      @include eyebrow;
      padding-top: 2px;
    }

    dd {
      margin: 0;
      @include cluster($space-2);
    }
  }

  &__chip {
    padding: 1px 10px;
    border: 1px solid var(--border);
    border-radius: $radius-pill;
    background: var(--surface-2);
    font-size: 13px;
  }
}

.kinds {
  display: grid;
  gap: $space-3;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));

  &__card {
    @include stack(2px);
    position: relative;
    padding: $space-3 $space-4;
    cursor: pointer;

    input {
      position: absolute;
      opacity: 0;
    }

    &--on {
      border-color: var(--accent);
      background: var(--accent-soft);
    }
  }

  &__label {
    font-weight: 600;
  }

  &__hint {
    font-size: $font-size-sm;
  }
}
</style>
