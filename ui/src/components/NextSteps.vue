<script setup lang="ts">
import { ref } from 'vue'
import { performStep } from '../actions'
import type { NextStep, StepContext } from '../nextSteps'
import ChangesPanel from './ChangesPanel.vue'
import Icon from './Icon.vue'

const props = defineProps<{ steps: NextStep[]; ctx: StepContext }>()
const emit = defineEmits<{ log: [] }>()

const ICONS: Record<string, string> = {
  exec: 'terminal',
  confirm: 'play',
  form: 'right',
  link: 'external',
  open: 'external',
  copy: 'copy',
  'terminal-publish': 'terminal',
  changes: 'check',
  rerun: 'sync',
  log: 'search',
}

function iconFor(step: NextStep): string {
  return step.icon ?? ICONS[step.action.type] ?? 'play'
}

function critical(step: NextStep): boolean {
  return step.action.type === 'confirm' && step.action.danger === true
}

const copied = ref('')
const showChanges = ref(false)
const error = ref('')
const info = ref('')

async function go(step: NextStep): Promise<void> {
  error.value = ''
  info.value = ''
  try {
    info.value =
      (await performStep(step, props.ctx, {
        log: () => emit('log'),
        changes: () => {
          showChanges.value = !showChanges.value
        },
      })) ?? ''
    if (step.action.type === 'copy') {
      copied.value = step.id
      setTimeout(() => {
        if (copied.value === step.id) copied.value = ''
      }, 1500)
    }
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
}
</script>

<template>
  <div v-if="steps.length" class="ns">
    <div class="ns__btns">
      <button
        v-for="step in steps"
        :key="step.id"
        class="btn btn--small"
        :class="{ ns__primary: step.primary, 'btn--danger': critical(step) }"
        :title="step.hint"
        @click="go(step)"
      >
        <Icon :name="copied === step.id ? 'check' : iconFor(step)" :size="14" />
        {{ copied === step.id ? 'Copied' : step.label }}
      </button>
    </div>
    <p v-if="info" class="notice">{{ info }}</p>
    <p v-if="error" class="notice notice--error">{{ error }}</p>
    <ChangesPanel
      v-if="showChanges && ctx.dirs[0]"
      :dir="ctx.dirs[0]"
      suggested="chore: update dependencies"
      explain-empty
    />
  </div>
</template>

<style scoped lang="scss">
.ns {
  @include stack($space-2);
  flex-basis: 100%;
  margin-top: 2px;

  &__btns {
    @include cluster($space-2);
  }

  &__primary {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 600;
  }
}
</style>
