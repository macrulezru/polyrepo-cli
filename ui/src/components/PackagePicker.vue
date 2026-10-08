<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PackageInfo } from '../api'
import { savePresets, store } from '../store'
import { groupColor } from '../groupColors'
import Icon from './Icon.vue'
import StatusChip from './StatusChip.vue'

defineProps<{ hint?: string | undefined }>()
const picked = defineModel<string[]>({ required: true })

interface Group {
  name: string
  mono: boolean
  items: PackageInfo[]
}

const search = ref('')
const onlyDirty = ref(false)
const hidePrivate = ref(false)
const collapsed = ref<string[]>([])
const saving = ref(false)
const setName = ref('')
const setError = ref('')

function applySet(name: string): void {
  const preset = store.presets.find((item) => item.name === name)
  if (!preset) return
  picked.value = preset.packages.filter((dir) => store.packages.some((pkg) => pkg.dir === dir))
}

async function saveSet(): Promise<void> {
  const name = setName.value.trim()
  if (name === '' || picked.value.length === 0) return
  try {
    const others = store.presets.filter((item) => item.name !== name)
    await savePresets([...others, { name, packages: [...picked.value] }])
    saving.value = false
    setName.value = ''
    setError.value = ''
  } catch (caught) {
    setError.value = caught instanceof Error ? caught.message : String(caught)
  }
}

const shown = computed(() => {
  const needle = search.value.trim().toLowerCase()
  return store.packages.filter(
    (pkg) =>
      (needle === '' ||
        pkg.dir.toLowerCase().includes(needle) ||
        pkg.name.toLowerCase().includes(needle)) &&
      (!onlyDirty.value || pkg.dirty === true) &&
      (!hidePrivate.value || !pkg.private),
  )
})

const groups = computed<Group[]>(() => {
  const single: PackageInfo[] = []
  const byName = new Map<string, Group>()
  for (const pkg of shown.value) {
    const slash = pkg.dir.indexOf('/')
    if (slash <= 0) {
      single.push(pkg)
      continue
    }
    const name = pkg.dir.slice(0, slash)
    let group = byName.get(name)
    if (!group) {
      group = { name, mono: true, items: [] }
      byName.set(name, group)
    }
    group.items.push(pkg)
  }
  const monos = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
  return [...(single.length ? [{ name: '', mono: false, items: single }] : []), ...monos]
})

const dirtyCount = computed(() => store.packages.filter((pkg) => pkg.dirty === true).length)

function memberName(pkg: PackageInfo): string {
  return pkg.dir.slice(pkg.dir.indexOf('/') + 1)
}

function toggle(dir: string): void {
  picked.value = picked.value.includes(dir)
    ? picked.value.filter((name) => name !== dir)
    : [...picked.value, dir]
}

function groupState(group: Group): 'all' | 'some' | 'none' {
  const count = group.items.filter((pkg) => picked.value.includes(pkg.dir)).length
  return count === 0 ? 'none' : count === group.items.length ? 'all' : 'some'
}

function toggleGroup(group: Group): void {
  const dirs = group.items.map((pkg) => pkg.dir)
  picked.value =
    groupState(group) === 'all'
      ? picked.value.filter((dir) => !dirs.includes(dir))
      : [...new Set([...picked.value, ...dirs])]
}

function toggleFold(name: string): void {
  collapsed.value = collapsed.value.includes(name)
    ? collapsed.value.filter((value) => value !== name)
    : [...collapsed.value, name]
}

function selectAll(): void {
  picked.value = [...new Set([...picked.value, ...shown.value.map((pkg) => pkg.dir)])]
}

function offBranch(pkg: PackageInfo): boolean {
  return pkg.branch !== null && pkg.branch !== 'master' && pkg.branch !== 'main'
}
</script>

<template>
  <section class="pick card">
    <div class="pick__bar">
      <span class="label">Packages</span>
      <span class="muted pick__count">{{ picked.length }} of {{ store.packages.length }}</span>
      <span class="pick__spacer" />
      <div class="pick__sets">
        <select
          v-if="store.presets.length"
          class="select pick__select"
          aria-label="Saved sets"
          @change="applySet(($event.target as HTMLSelectElement).value)"
        >
          <option value="">Saved sets…</option>
          <option v-for="preset in store.presets" :key="preset.name" :value="preset.name">
            {{ preset.name }} ({{ preset.packages.length }})
          </option>
        </select>
        <button
          v-if="!saving"
          class="btn btn--small"
          :disabled="picked.length === 0"
          title="Remember the current selection"
          @click="saving = true"
        >
          <Icon name="star" :size="13" />
          Save as set
        </button>
        <form v-else class="pick__save" @submit.prevent="saveSet">
          <input
            v-model="setName"
            class="input pick__name-input"
            placeholder="Set name"
            autofocus
          />
          <button class="btn btn--small btn--primary" :disabled="setName.trim() === ''">
            Save
          </button>
          <button type="button" class="btn btn--small" @click="saving = false">Cancel</button>
        </form>
        <span v-if="setError" class="pick__seterr">{{ setError }}</span>
      </div>
    </div>
    <input v-model="search" class="input" placeholder="Filter packages" />
    <div class="pick__filters">
      <label class="check pick__filter">
        <input v-model="onlyDirty" type="checkbox" :disabled="dirtyCount === 0" />
        <span>Only with local changes ({{ dirtyCount }})</span>
      </label>
      <label class="check pick__filter">
        <input v-model="hidePrivate" type="checkbox" />
        <span>Hide private</span>
      </label>
      <span class="pick__divider" aria-hidden="true" />
      <div class="pick__select-all" role="group" aria-label="Selection">
        <button class="btn btn--small" @click="selectAll">Select all</button>
        <button class="btn btn--small" :disabled="!picked.length" @click="picked = []">
          Unselect
        </button>
      </div>
    </div>
    <p v-if="hint" class="muted pick__hint">{{ hint }}</p>

    <div class="pick__list">
      <p v-if="store.packages.length === 0" class="muted pick__none">
        No packages found. <a href="#/settings">Add a folder in Settings</a>.
      </p>
      <p v-else-if="groups.length === 0" class="muted pick__none">No packages match.</p>
      <div v-else class="pick__head g">
        <span />
        <span>Package</span>
        <span>Branch</span>
        <span>Git</span>
        <span>Version</span>
      </div>
      <section
        v-for="group in groups"
        :key="group.name || '(single)'"
        class="blk"
        :class="{ 'blk--mono': group.mono }"
        :style="group.mono ? { '--gc': groupColor(group.name) } : undefined"
      >
        <div v-if="group.mono" class="g g--title">
          <span class="g__pick">
            <input
              type="checkbox"
              :checked="groupState(group) === 'all'"
              :indeterminate="groupState(group) === 'some'"
              :aria-label="`Select all of ${group.name}`"
              @change="toggleGroup(group)"
            />
          </span>
          <button
            class="blk__fold"
            :aria-expanded="!collapsed.includes(group.name)"
            @click="toggleFold(group.name)"
          >
            <Icon :name="collapsed.includes(group.name) ? 'right' : 'chevdown'" :size="14" />
            <span class="blk__name">{{ group.name }}</span>
            <span class="blk__count">{{ group.items.length }} packages</span>
            <span class="blk__tag">monorepo</span>
          </button>
        </div>
        <div v-else-if="groups.length > 1" class="blk__single-title">
          Single packages <span class="blk__count">{{ group.items.length }}</span>
        </div>
        <template v-if="!group.mono || !collapsed.includes(group.name)">
          <label
            v-for="pkg in group.items"
            :key="pkg.dir"
            class="g g--row"
            :class="{ 'g--on': picked.includes(pkg.dir) }"
          >
            <span class="g__pick">
              <input
                type="checkbox"
                :checked="picked.includes(pkg.dir)"
                @change="toggle(pkg.dir)"
              />
            </span>
            <span class="g__name" :class="{ 'g__name--member': group.mono }" :title="pkg.dir">
              {{ group.mono ? memberName(pkg) : pkg.dir }}
              <StatusChip v-if="pkg.private" tone="muted">private</StatusChip>
            </span>
            <span class="g__cell">
              <StatusChip
                v-if="pkg.branch"
                :tone="offBranch(pkg) ? 'warn' : 'muted'"
                :title="offBranch(pkg) ? 'Not on the main branch' : 'Current branch'"
                >{{ pkg.branch }}</StatusChip
              >
            </span>
            <span class="g__cell">
              <StatusChip v-if="pkg.dirty !== null" :tone="pkg.dirty ? 'danger' : 'ok'">{{
                pkg.dirty ? 'dirty' : 'clean'
              }}</StatusChip>
            </span>
            <span class="g__cell g__ver">{{ pkg.version ?? '?' }}</span>
          </label>
        </template>
      </section>
    </div>
  </section>
</template>

<style scoped lang="scss">
.pick {
  @include stack($space-3);
  padding: $space-4;

  &__bar,
  &__filters {
    @include cluster;
  }

  &__filters {
    gap: $space-4;
  }

  &__filter {
    font-size: 13px;
  }

  &__spacer {
    flex: 1;
  }

  &__divider {
    width: 1px;
    height: 22px;
    background: var(--border);
  }

  &__select-all {
    @include cluster($space-2);
  }

  &__sets,
  &__save {
    @include cluster($space-2);
  }

  &__select {
    height: $control-height-sm + 2;
    font-size: 13px;
  }

  &__name-input {
    height: $control-height-sm;
    width: 160px;
  }

  &__seterr {
    color: var(--danger);
    font-size: $font-size-sm;
  }

  &__count,
  &__hint {
    font-size: $font-size-sm;
  }

  &__list {
    @include stack($space-3);
  }

  &__none {
    padding: $space-3;
  }

  &__head {
    @include eyebrow;
    padding-top: 0;
    margin-bottom: -$space-1;
    font-size: $font-size-xs;
  }
}

.g {
  display: grid;
  grid-template-columns: 34px minmax(190px, 360px) 112px 84px 84px;
  justify-content: start;
  align-items: center;
  column-gap: 12px;
  padding: 0 $space-3;
  font-size: 13px;

  &--row {
    min-height: 34px;
    border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
    cursor: pointer;
    transition: background $transition-fast;

    &:hover {
      background: var(--surface-2);
    }
  }

  &--on {
    background: var(--accent-soft) !important;
  }

  &--title {
    min-height: 40px;
  }

  &__pick {
    display: flex;
    align-items: center;

    + .blk__fold {
      grid-column: 2 / -1;
    }
  }

  &__name {
    display: flex;
    align-items: center;
    gap: $space-2;
    min-width: 0;
    @include truncate;

    &--member {
      padding-left: $space-4;
    }
  }

  &__cell {
    min-width: 0;
  }

  &__ver {
    font-family: $font-mono;
    font-size: $font-size-sm;
    color: var(--muted);
  }
}

.blk {
  @include surface($radius-lg);
  box-shadow: none;
  overflow: hidden;
  flex: none;

  &--mono {
    --gc: var(--accent);
    background: color-mix(in srgb, var(--gc) 7%, var(--surface));
    border-color: color-mix(in srgb, var(--gc) 45%, var(--border));
    box-shadow: inset 4px 0 0 var(--gc);

    .g--title {
      background: color-mix(in srgb, var(--gc) 20%, var(--surface));
    }

    .g--row {
      border-top-color: color-mix(in srgb, var(--gc) 18%, transparent);

      &:hover {
        background: color-mix(in srgb, var(--gc) 14%, var(--surface));
      }
    }
  }

  &__fold {
    grid-column: 1 / -1;
    display: inline-flex;
    align-items: center;
    gap: $space-2;
    padding: 8px 0;
    border: 0;
    background: transparent;
    cursor: pointer;
    text-align: left;
    font-family: $font-sans;
    @include focus-ring;
  }

  &__name {
    font-size: $font-size-md;
    font-weight: 700;
    color: var(--gc);
  }

  &__count {
    color: var(--muted);
    font-size: $font-size-sm;
  }

  &__tag {
    padding: 0 8px;
    border-radius: $radius-pill;
    background: color-mix(in srgb, var(--gc) 22%, transparent);
    color: var(--gc);
    font-size: $font-size-xs;
  }

  &__single-title {
    display: flex;
    gap: $space-2;
    align-items: baseline;
    padding: 8px $space-3;
    background: var(--surface-2);
    font-weight: 600;
  }
}
</style>
