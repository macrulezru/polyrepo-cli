<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Question } from '../api'
import UiModal from '../ui-components/UiModal.vue'
import AnsiText from './AnsiText.vue'

const props = defineProps<{ question: Question }>()
const emit = defineEmits<{ answer: [value: unknown]; cancel: [] }>()

const text = ref('')
const picked = ref<number[]>([])
const chosen = ref<number | null>(null)

const choices = computed(() =>
  props.question.kind === 'checkbox' || props.question.kind === 'select'
    ? props.question.choices
    : [],
)

const selectable = computed(() =>
  choices.value.filter((choice) => !choice.separator && !choice.disabled),
)

watch(
  () => props.question,
  (question) => {
    text.value = question.kind === 'input' ? question.default : ''
    picked.value =
      question.kind === 'checkbox'
        ? question.choices.filter((c) => c.checked && !c.disabled && !c.separator).map((c) => c.id)
        : []
    chosen.value =
      question.kind === 'select'
        ? (question.choices.find((c) => !c.disabled && !c.separator)?.id ?? null)
        : null
  },
  { immediate: true },
)

function toggle(id: number): void {
  picked.value = picked.value.includes(id)
    ? picked.value.filter((value) => value !== id)
    : [...picked.value, id]
}

function selectAll(): void {
  picked.value = selectable.value.map((choice) => choice.id)
}

function selectNone(): void {
  picked.value = []
}

function submit(): void {
  const question = props.question
  if (question.kind === 'checkbox') emit('answer', picked.value)
  else if (question.kind === 'select') emit('answer', chosen.value)
  else if (question.kind === 'input') emit('answer', text.value)
}
</script>

<template>
  <UiModal title="The command is asking" width="640px" @close="emit('cancel')">
    <div class="prompt">
      <p class="prompt__message"><AnsiText :text="question.message" /></p>

      <input
        v-if="question.kind === 'input'"
        v-model="text"
        class="input"
        autofocus
        @keydown.enter="submit"
      />

      <div v-else-if="question.kind === 'checkbox'" class="prompt__tools">
        <button class="btn btn--small" @click="selectAll">Select all</button>
        <button class="btn btn--small" @click="selectNone">None</button>
        <span class="muted">{{ picked.length }} of {{ selectable.length }}</span>
      </div>

      <ul v-if="question.kind === 'checkbox' || question.kind === 'select'" class="prompt__list">
        <li v-for="choice in choices" :key="choice.id">
          <hr v-if="choice.separator" class="prompt__sep" />
          <label v-else class="prompt__choice" :class="{ 'prompt__choice--off': choice.disabled }">
            <input
              v-if="question.kind === 'checkbox'"
              type="checkbox"
              :checked="picked.includes(choice.id)"
              :disabled="!!choice.disabled"
              @change="toggle(choice.id)"
            />
            <input
              v-else
              v-model="chosen"
              type="radio"
              name="choice"
              :value="choice.id"
              :disabled="!!choice.disabled"
            />
            <span class="prompt__name"><AnsiText :text="choice.name" /></span>
            <span v-if="choice.disabled" class="muted">{{
              typeof choice.disabled === 'string' ? choice.disabled : 'unavailable'
            }}</span>
          </label>
        </li>
      </ul>
    </div>
    <template #footer>
      <span class="prompt__spacer" />
      <template v-if="question.kind === 'confirm'">
        <button class="btn" @click="emit('answer', false)">No</button>
        <button class="btn btn--primary" @click="emit('answer', true)">Yes</button>
      </template>
      <template v-else>
        <button class="btn" @click="emit('cancel')">Cancel the run</button>
        <button class="btn btn--primary" @click="submit">Continue</button>
      </template>
    </template>
  </UiModal>
</template>

<style scoped lang="scss">
.prompt {
  @include stack;
  padding: $space-4;
  min-height: 0;

  &__message {
    font-weight: 600;
  }

  &__tools {
    @include cluster;
  }

  &__list {
    @include scroll-area;
    margin: 0;
    padding: 0;
    max-height: 380px;
    list-style: none;
  }

  &__choice {
    display: flex;
    align-items: center;
    gap: $space-2;
    padding: 5px $space-2;
    border-radius: $radius-sm;
    cursor: pointer;
    @include hover-fill;

    &--off {
      opacity: 0.55;
      cursor: not-allowed;
    }
  }

  &__name {
    flex: 1;
    min-width: 0;
    @include truncate;
  }

  &__sep {
    border: 0;
    border-top: 1px solid var(--border);
  }

  &__spacer {
    flex: 1;
  }
}
</style>
