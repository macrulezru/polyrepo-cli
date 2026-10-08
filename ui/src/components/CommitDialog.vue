<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { api, type RunSummary } from '../api'
import { navigate } from '../router'
import { askNotificationPermission, loadRuns } from '../store'
import UiModal from '../ui-components/UiModal.vue'
import Icon from './Icon.vue'
import LoadingState from './LoadingState.vue'

interface CommitPlan {
  dir: string
  current: string | null
  defaultBranch: string | null
  onDefault: boolean
  files: string[]
  policy: { level: 'open' | 'pr-required' | 'unknown'; reasons: string[] } | null
  recommended: 'direct' | 'branch' | 'current'
  branchName: string
  requestLabel: string
}

const props = defineProps<{ dir: string; suggested: string }>()
const emit = defineEmits<{ close: [] }>()

const plan = ref<CommitPlan>()
const message = ref(props.suggested)
const route = ref<'direct' | 'branch'>('branch')
const branchName = ref('')
const push = ref(true)
const openRequest = ref(true)
const error = ref('')
const loading = ref(true)
const starting = ref(false)

async function load(): Promise<void> {
  loading.value = true
  try {
    plan.value = await api.get<CommitPlan>(
      `/api/repo/commit-plan?dir=${encodeURIComponent(props.dir)}&message=${encodeURIComponent(message.value)}`,
    )
    route.value = plan.value.recommended === 'direct' ? 'direct' : 'branch'
    branchName.value = plan.value.branchName
    error.value = ''
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  } finally {
    loading.value = false
  }
}

onMounted(load)

watch(message, (value) => {
  if (!plan.value) return
  const stamp = plan.value.branchName.split('-').pop() ?? ''
  const slug = value
    .replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
  if (branchName.value.startsWith('chore/'))
    branchName.value = `chore/${slug || 'changes'}-${stamp}`
})

const policyText = computed(() => {
  const policy = plan.value?.policy
  if (!policy) return ''
  if (policy.level === 'open') return `${plan.value?.defaultBranch} accepts direct commits.`
  const why = policy.reasons.length ? ` (${policy.reasons.join('; ')})` : ''
  return policy.level === 'pr-required'
    ? `${plan.value?.defaultBranch} does not accept direct commits${why}.`
    : `Could not tell whether ${plan.value?.defaultBranch} accepts direct commits${why}.`
})

async function start(): Promise<void> {
  if (!plan.value || starting.value || message.value.trim() === '') return
  starting.value = true
  error.value = ''
  try {
    const options: Record<string, unknown> = {
      packages: [props.dir],
      message: message.value.trim(),
      scope: 'manifest',
      mode: plan.value.onDefault ? route.value : 'auto',
      push: push.value,
      pr: openRequest.value,
    }
    if (plan.value.onDefault && route.value === 'branch')
      options.branchName = branchName.value.trim()
    const run = await api.post<RunSummary>('/api/runs', {
      command: 'commit',
      options,
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
</script>

<template>
  <UiModal title="Commit these changes" width="600px" @close="emit('close')">
    <LoadingState v-if="loading" text="Reading the branch rules…" />
    <div v-else-if="plan" class="cd">
      <label class="field">
        <span>Commit message</span>
        <input v-model="message" class="input" spellcheck="false" />
      </label>

      <div class="cd__where">
        <p class="label">Where it goes</p>

        <template v-if="plan.onDefault">
          <p class="muted cd__policy">{{ policyText }}</p>

          <label class="cd__opt" :class="{ 'cd__opt--on': route === 'branch' }">
            <input v-model="route" type="radio" name="route" value="branch" />
            <span class="cd__main">
              New branch and a {{ plan.requestLabel }}
              <span v-if="plan.recommended === 'branch'" class="cd__rec">recommended</span>
            </span>
            <span class="muted cd__hint">
              The commit goes to a new branch, which is pushed and opened for review.
              {{ plan.defaultBranch }} stays untouched.
            </span>
          </label>

          <label class="cd__opt" :class="{ 'cd__opt--on': route === 'direct' }">
            <input v-model="route" type="radio" name="route" value="direct" />
            <span class="cd__main">
              Directly to {{ plan.defaultBranch }}
              <span v-if="plan.recommended === 'direct'" class="cd__rec">recommended</span>
            </span>
            <span class="muted cd__hint">
              <template v-if="plan.policy?.level === 'open'"
                >Committed and pushed in one go.</template
              >
              <template v-else>
                May be refused by the host. If it is, the commit is moved to a branch for you.
              </template>
            </span>
          </label>

          <label v-if="route === 'branch'" class="field cd__branch">
            <span>Branch name</span>
            <input v-model="branchName" class="input" spellcheck="false" />
          </label>
        </template>
        <p v-else class="cd__policy">
          You are on <code>{{ plan.current ?? 'a detached HEAD' }}</code
          >, not on <code>{{ plan.defaultBranch }}</code
          >, so the commit simply goes there.
        </p>

        <label class="check cd__check">
          <input v-model="push" type="checkbox" />
          <span>Push to origin</span>
        </label>
        <label v-if="plan.onDefault && route === 'branch'" class="check cd__check">
          <input v-model="openRequest" type="checkbox" :disabled="!push" />
          <span>Open a {{ plan.requestLabel }}</span>
        </label>
      </div>

      <p class="muted cd__files">
        Files: <code>{{ plan.files.join(', ') }}</code>
      </p>
      <p v-if="error" class="notice notice--error">{{ error }}</p>
    </div>
    <p v-else-if="error" class="notice notice--error cd__fail">{{ error }}</p>

    <template #footer>
      <span class="cd__spacer" />
      <button class="btn" @click="emit('close')">Cancel</button>
      <button
        class="btn btn--primary"
        :disabled="loading || !plan || starting || message.trim() === ''"
        @click="start"
      >
        <Icon name="check" :size="15" />
        Commit
      </button>
    </template>
  </UiModal>
</template>

<style scoped lang="scss">
.cd {
  @include stack($space-3);
  padding: $space-4;

  &__where {
    @include stack($space-2);
  }

  &__policy {
    font-size: 13px;
  }

  &__opt {
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: $space-3;
    padding: $space-3;
    border: 1px solid var(--border);
    border-radius: $radius-md;
    cursor: pointer;
    transition: border-color $transition-fast;

    input {
      grid-row: span 2;
      align-self: start;
      margin-top: 4px;
    }

    &--on {
      border-color: var(--accent);
      background: var(--accent-soft);
    }
  }

  &__main {
    font-weight: 600;
  }

  &__rec {
    margin-left: $space-2;
    padding: 0 8px;
    border-radius: $radius-pill;
    background: color-mix(in srgb, var(--ok) 18%, transparent);
    color: var(--ok);
    font-size: $font-size-xs;
    font-weight: 600;
  }

  &__hint {
    grid-column: 2;
    font-size: 13px;
  }

  &__branch {
    margin-top: $space-1;
  }

  &__check {
    font-size: 13px;
  }

  &__files {
    font-size: $font-size-sm;
  }

  &__fail {
    margin: $space-4;
  }

  &__spacer {
    flex: 1;
  }
}
</style>
