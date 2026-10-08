<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { COMMAND_ICONS } from '../commandIcons'
import { navigate } from '../router'
import { store } from '../store'
import Icon from './Icon.vue'

interface Item {
  key: string
  group: string
  label: string
  hint: string
  icon: string
  go: () => void
}

const emit = defineEmits<{ close: [] }>()
const query = ref('')
const active = ref(0)
const input = ref<HTMLInputElement>()
const list = ref<HTMLElement>()

const items = computed<Item[]>(() => {
  const pages: Item[] = [
    {
      key: 'p-packages',
      label: 'Packages',
      hint: 'Overview of every package',
      icon: 'layers',
      go: () => navigate('packages'),
    },
    {
      key: 'p-commands',
      label: 'Commands',
      hint: 'All commands',
      icon: 'play',
      go: () => navigate('commands'),
    },
    {
      key: 'p-release',
      label: 'Release wizard',
      hint: 'Bump, tag, publish step by step',
      icon: 'rocket',
      go: () => navigate('release'),
    },
    {
      key: 'p-runs',
      label: 'Runs',
      hint: 'History of runs',
      icon: 'outdated',
      go: () => navigate('runs'),
    },
    {
      key: 'p-settings',
      label: 'Settings',
      hint: 'Roots, packages, GitLab hosts',
      icon: 'folder',
      go: () => navigate('settings'),
    },
  ].map((item) => ({ ...item, group: 'Go to' }))
  const commands: Item[] = store.commands.map((command) => ({
    key: `c-${command.id}`,
    group: 'Commands',
    label: command.title,
    hint: `polyrepo ${command.id}`,
    icon: COMMAND_ICONS[command.id] ?? 'play',
    go: () => navigate('commands', command.id),
  }))
  const runs: Item[] = store.runs.slice(0, 5).map((run) => ({
    key: `r-${run.id}`,
    group: 'Recent runs',
    label: run.title,
    hint: run.status,
    icon: 'outdated',
    go: () => navigate('runs', run.id),
  }))
  const packages: Item[] = store.packages.map((pkg) => ({
    key: `k-${pkg.dir}`,
    group: 'Packages',
    label: pkg.dir,
    hint: pkg.version ?? '',
    icon: 'package',
    go: () => navigate('packages', '', { filter: pkg.dir }),
  }))
  return [...pages, ...commands, ...runs, ...packages]
})

const shown = computed(() => {
  const words = query.value.toLowerCase().split(/\s+/).filter(Boolean)
  const found = items.value.filter((item) =>
    words.every((word) => `${item.label} ${item.hint}`.toLowerCase().includes(word)),
  )
  return found.slice(0, 40)
})

watch(shown, () => {
  active.value = 0
})

function run(item: Item | undefined): void {
  if (!item) return
  emit('close')
  item.go()
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
  else if (event.key === 'ArrowDown') {
    event.preventDefault()
    active.value = Math.min(shown.value.length - 1, active.value + 1)
    void scrollToActive()
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    active.value = Math.max(0, active.value - 1)
    void scrollToActive()
  } else if (event.key === 'Enter') {
    event.preventDefault()
    run(shown.value[active.value])
  }
}

async function scrollToActive(): Promise<void> {
  await nextTick()
  list.value?.querySelector('.pal__row--on')?.scrollIntoView({ block: 'nearest' })
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
  input.value?.focus()
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="pal" @mousedown.self="emit('close')">
    <div class="pal__box" role="dialog" aria-modal="true" aria-label="Command palette">
      <label class="pal__search">
        <Icon name="search" :size="16" />
        <input
          ref="input"
          v-model="query"
          class="pal__input"
          placeholder="Go to a page, run a command, find a package…"
          spellcheck="false"
        />
        <kbd class="pal__kbd">Esc</kbd>
      </label>
      <ul ref="list" class="pal__list">
        <li v-if="shown.length === 0" class="muted pal__none">Nothing matches.</li>
        <template v-for="(item, index) in shown" :key="item.key">
          <li v-if="index === 0 || shown[index - 1]?.group !== item.group" class="pal__group">
            {{ item.group }}
          </li>
          <li>
            <button
              class="pal__row"
              :class="{ 'pal__row--on': index === active }"
              @mousemove="active = index"
              @click="run(item)"
            >
              <Icon :name="item.icon" :size="16" />
              <span class="pal__label">{{ item.label }}</span>
              <span class="muted pal__hint">{{ item.hint }}</span>
            </button>
          </li>
        </template>
      </ul>
    </div>
  </div>
</template>

<style scoped lang="scss">
.pal {
  position: fixed;
  inset: 0;
  z-index: $z-overlay + 5;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 12vh $space-4 $space-4;
  background: var(--backdrop);

  &__box {
    @include surface;
    box-shadow: var(--shadow-lg);
    width: min(620px, 100%);
    display: flex;
    flex-direction: column;
    max-height: 70vh;
  }

  &__search {
    display: flex;
    align-items: center;
    gap: $space-3;
    padding: $space-3 $space-4;
    border-bottom: 1px solid var(--border);
    color: var(--muted);
  }

  &__input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--text);
    font-size: $font-size-md;
  }

  &__kbd {
    padding: 1px 6px;
    border: 1px solid var(--border);
    border-radius: $radius-sm;
    font-size: $font-size-xs;
  }

  &__list {
    @include scroll-area;
    margin: 0;
    padding: $space-2;
    list-style: none;
  }

  &__none {
    padding: $space-3;
  }

  &__group {
    @include eyebrow;
    padding: $space-2 $space-2 4px;
  }

  &__row {
    display: flex;
    align-items: center;
    gap: $space-3;
    width: 100%;
    padding: 7px $space-3;
    border: 0;
    border-radius: $radius-md;
    background: transparent;
    text-align: left;
    cursor: pointer;

    &--on {
      background: var(--accent-soft);
    }
  }

  &__label {
    flex: 1;
    min-width: 0;
    @include truncate;
  }

  &__hint {
    font-size: $font-size-sm;
    white-space: nowrap;
  }
}
</style>
