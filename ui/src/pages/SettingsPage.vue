<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { api, type ConfigInfo, type PackagesResult } from '../api'
import { loadAuth, loadEnvironment, loadPackages, savePresets, saveSettings, store } from '../store'
import { blend as blendPreview, groupColor, monorepoNames } from '../groupColors'
import FolderPicker from '../components/FolderPicker.vue'
import Icon from '../components/Icon.vue'
import PageHeader from '../components/PageHeader.vue'

type ListKey = 'roots' | 'packages' | 'gitlabHosts'

const config = ref<ConfigInfo>()
const roots = ref<string[]>([])
const packages = ref<string[]>([])
const gitlabHosts = ref<string[]>([])
const saved = ref('')
const error = ref('')
const message = ref('')
const saving = ref(false)
const picking = ref<{ key: 'roots' | 'packages'; index: number } | null>(null)
const preview = ref<PackagesResult>()
const previewError = ref('')
let previewTimer = 0

const snapshot = computed(() =>
  JSON.stringify({ roots: roots.value, packages: packages.value, gitlabHosts: gitlabHosts.value }),
)
const dirty = computed(() => snapshot.value !== saved.value)

function lists(key: ListKey): string[] {
  return key === 'roots' ? roots.value : key === 'packages' ? packages.value : gitlabHosts.value
}

function cleaned(key: ListKey): string[] {
  return lists(key)
    .map((value) => value.trim())
    .filter((value) => value !== '')
}

function body(): Record<ListKey, string[]> {
  return {
    roots: cleaned('roots'),
    packages: cleaned('packages'),
    gitlabHosts: cleaned('gitlabHosts'),
  }
}

async function load(): Promise<void> {
  try {
    const loaded = await api.get<ConfigInfo>('/api/config')
    config.value = loaded
    roots.value = [...loaded.roots]
    packages.value = [...loaded.packages]
    gitlabHosts.value = [...loaded.gitlabHosts]
    saved.value = snapshot.value
    error.value = loaded.error ?? ''
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
}

function add(key: ListKey): void {
  lists(key).push('')
}

function remove(key: ListKey, index: number): void {
  lists(key).splice(index, 1)
}

function onPick(path: string): void {
  if (!picking.value) return
  const target = lists(picking.value.key)
  target[picking.value.index] = path
  picking.value = null
}

function browse(key: 'roots' | 'packages', index: number): void {
  picking.value = { key, index }
}

async function refreshPreview(): Promise<void> {
  try {
    preview.value = await api.post<PackagesResult>('/api/config/preview', body())
    previewError.value = ''
  } catch (caught) {
    preview.value = undefined
    previewError.value = caught instanceof Error ? caught.message : String(caught)
  }
}

watch(snapshot, () => {
  clearTimeout(previewTimer)
  previewTimer = window.setTimeout(refreshPreview, 400)
})

async function save(): Promise<void> {
  saving.value = true
  message.value = ''
  error.value = ''
  try {
    await api.put('/api/config', body())
    await load()
    await loadPackages()
    message.value = 'Saved.'
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  } finally {
    saving.value = false
  }
}

function revert(): void {
  void load()
}

const tools = computed(() => {
  const environment = store.environment
  if (!environment) return []
  return [
    ['Node.js', environment.node],
    ['git', environment.git],
    ['npm', environment.npm],
    ['pnpm', environment.pnpm],
    ['gh', environment.gh],
    ['glab', environment.glab],
  ] as [string, string | null][]
})

const colorFrom = ref(store.settings.groupColors.from)
const colorTo = ref(store.settings.groupColors.to)
const DEFAULT_COLORS = { from: '#4f7bff', to: '#c06be0' }

watch(
  () => store.settings.groupColors,
  (colors) => {
    colorFrom.value = colors.from
    colorTo.value = colors.to
  },
)

const colorsDirty = computed(
  () =>
    colorFrom.value !== store.settings.groupColors.from ||
    colorTo.value !== store.settings.groupColors.to,
)

async function applyColors(from: string, to: string): Promise<void> {
  try {
    await saveSettings({ groupColors: { from, to } })
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
}

const swatches = computed(() => {
  const names = monorepoNames()
  const count = Math.max(names.length, 6)
  return Array.from({ length: count }, (_, index) => ({ name: names[index] ?? '', index, count }))
})

function previewColor(index: number, count: number): string {
  return blendPreview(colorFrom.value, colorTo.value, count > 1 ? index / (count - 1) : 0)
}

const notifications = ref(
  typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
)

async function enableNotifications(): Promise<void> {
  if (typeof Notification === 'undefined') return
  notifications.value = await Notification.requestPermission()
}

async function removeSet(name: string): Promise<void> {
  try {
    await savePresets(store.presets.filter((item) => item.name !== name))
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
}

const accounts = computed(() => {
  const auth = store.auth
  if (!auth) return []
  return [
    { name: 'GitHub (gh)', ok: auth.gh.ok, detail: auth.gh.detail, fix: 'gh auth login' },
    { name: 'GitLab (glab)', ok: auth.glab.ok, detail: auth.glab.detail, fix: 'glab auth login' },
    { name: 'npm', ok: auth.npm.ok, detail: auth.npm.detail, fix: 'npm login' },
  ]
})

onMounted(async () => {
  await load()
  void loadAuth()
  void loadEnvironment()
  void refreshPreview()
})
onBeforeUnmount(() => clearTimeout(previewTimer))
</script>

<template>
  <div class="page">
    <PageHeader title="Settings" :subtitle="config?.path" />

    <p v-if="config && !config.exists" class="notice notice--warn">
      There is no config file yet. Saving creates it.
    </p>
    <p v-if="error" class="notice notice--error">{{ error }}</p>
    <p v-if="message" class="notice">{{ message }}</p>

    <div class="page__cols">
      <div class="page__main">
        <section class="card block">
          <div class="block__head">
            <h2>Roots</h2>
            <button class="btn btn--small" @click="add('roots')">
              <Icon name="plus" :size="14" />
              Add
            </button>
          </div>
          <p class="muted block__help">
            Folders that contain your repos. Every direct subfolder with a package.json is a
            package.
          </p>
          <div v-for="(_, index) in roots" :key="index" class="row">
            <input v-model="roots[index]" class="input row__input" spellcheck="false" />
            <button class="btn btn--small" @click="browse('roots', index)">
              <Icon name="folder" :size="14" />
              Browse
            </button>
            <button class="btn btn--small btn--ghost btn--danger" @click="remove('roots', index)">
              <Icon name="trash" :size="14" />
            </button>
          </div>
          <p v-if="roots.length === 0" class="muted">No roots.</p>
        </section>

        <section class="card block">
          <div class="block__head">
            <h2>Packages</h2>
            <button class="btn btn--small" @click="add('packages')">
              <Icon name="plus" :size="14" />
              Add
            </button>
          </div>
          <p class="muted block__help">
            Single repos or pnpm workspaces outside the roots, one path each.
          </p>
          <div v-for="(_, index) in packages" :key="index" class="row">
            <input v-model="packages[index]" class="input row__input" spellcheck="false" />
            <button class="btn btn--small" @click="browse('packages', index)">
              <Icon name="folder" :size="14" />
              Browse
            </button>
            <button
              class="btn btn--small btn--ghost btn--danger"
              @click="remove('packages', index)"
            >
              <Icon name="trash" :size="14" />
            </button>
          </div>
          <p v-if="packages.length === 0" class="muted">No extra packages.</p>
        </section>

        <section class="card block">
          <div class="block__head">
            <h2>GitLab hosts</h2>
            <button class="btn btn--small" @click="add('gitlabHosts')">
              <Icon name="plus" :size="14" />
              Add
            </button>
          </div>
          <p class="muted block__help">Self-hosted GitLab hostnames. gitlab.com is always known.</p>
          <div v-for="(_, index) in gitlabHosts" :key="index" class="row">
            <input
              v-model="gitlabHosts[index]"
              class="input row__input"
              placeholder="gitlab.example.com"
              spellcheck="false"
            />
            <button
              class="btn btn--small btn--ghost btn--danger"
              @click="remove('gitlabHosts', index)"
            >
              <Icon name="trash" :size="14" />
            </button>
          </div>
          <p v-if="gitlabHosts.length === 0" class="muted">No self-hosted hosts.</p>
        </section>

        <div class="page__actions">
          <button class="btn btn--primary" :disabled="!dirty || saving" @click="save">Save</button>
          <button class="btn" :disabled="!dirty" @click="revert">Revert</button>
          <span v-if="dirty" class="muted">Unsaved changes.</span>
        </div>
      </div>

      <aside class="page__side">
        <section class="card block">
          <div class="block__head">
            <h2>Found packages</h2>
            <span class="muted">{{ preview?.packages.length ?? 0 }}</span>
          </div>
          <p v-if="previewError" class="notice notice--error">{{ previewError }}</p>
          <p v-for="warning in preview?.warnings ?? []" :key="warning" class="notice notice--warn">
            {{ warning }}
          </p>
          <ul class="found found--grid">
            <li
              v-for="pkg in preview?.packages ?? []"
              :key="pkg.path"
              class="found__row"
              :class="{ 'found__row--mono': pkg.dir.includes('/') }"
              :style="
                pkg.dir.includes('/')
                  ? { '--gc': groupColor(pkg.dir.slice(0, pkg.dir.indexOf('/'))) }
                  : undefined
              "
            >
              <span class="found__name">{{ pkg.dir }}</span>
              <span class="muted found__ver">{{ pkg.version ?? '?' }}</span>
            </li>
          </ul>
          <p v-if="preview && preview.packages.length === 0" class="muted">
            Nothing found with these settings.
          </p>
        </section>
      </aside>
    </div>

    <div class="page__more">
      <section class="card block">
        <h2>Monorepo colors</h2>
        <p class="muted block__help">
          Each monorepo gets its own shade from this range, so its packages read as one block.
        </p>
        <div class="hue">
          <label class="hue__pick">
            <input v-model="colorFrom" type="color" aria-label="First color" />
            <span class="muted">from</span>
          </label>
          <label class="hue__pick">
            <input v-model="colorTo" type="color" aria-label="Last color" />
            <span class="muted">to</span>
          </label>
        </div>
        <div class="hue__preview">
          <span
            v-for="swatch in swatches"
            :key="swatch.index"
            class="hue__swatch"
            :style="{ '--gc': previewColor(swatch.index, swatch.count) }"
            :title="swatch.name"
          >
            {{ swatch.name }}
          </span>
        </div>
        <div class="hue__actions">
          <button
            class="btn btn--small btn--primary"
            :disabled="!colorsDirty"
            @click="applyColors(colorFrom, colorTo)"
          >
            Save colors
          </button>
          <button
            class="btn btn--small"
            @click="applyColors(DEFAULT_COLORS.from, DEFAULT_COLORS.to)"
          >
            Reset
          </button>
        </div>
      </section>

      <section class="card block">
        <h2>Signed in</h2>
        <p v-if="!store.auth" class="muted">Checking…</p>
        <ul class="found">
          <li v-for="account in accounts" :key="account.name" class="found__row acc">
            <span class="acc__dot" :class="{ 'acc__dot--off': !account.ok }" />
            <span class="found__name">{{ account.name }}</span>
            <span class="muted acc__detail">{{
              account.ok ? account.detail : `run ${account.fix}`
            }}</span>
          </li>
        </ul>
      </section>

      <section class="card block">
        <h2>Saved sets</h2>
        <p v-if="store.presets.length === 0" class="muted block__help">
          Select packages in any command and press “Save as set” to keep the selection here.
        </p>
        <ul class="found">
          <li v-for="preset in store.presets" :key="preset.name" class="found__row">
            <span class="found__name">{{ preset.name }}</span>
            <span class="muted found__ver">{{ preset.packages.length }}</span>
            <button
              class="btn btn--small btn--ghost btn--danger"
              :aria-label="`Delete ${preset.name}`"
              @click="removeSet(preset.name)"
            >
              <Icon name="trash" :size="13" />
            </button>
          </li>
        </ul>
      </section>

      <section class="card block">
        <h2>Notifications</h2>
        <p class="muted block__help">
          Get a desktop notice when a long run finishes while you are in another window.
        </p>
        <p v-if="notifications === 'granted'" class="muted">Enabled.</p>
        <p v-else-if="notifications === 'denied'" class="muted">
          Blocked in the browser settings for this page.
        </p>
        <p v-else-if="notifications === 'unsupported'" class="muted">
          This browser does not support notifications.
        </p>
        <button v-else class="btn btn--small" @click="enableNotifications">Enable</button>
      </section>

      <section class="card block">
        <h2>Tools</h2>
        <ul class="found">
          <li v-for="[name, version] in tools" :key="name" class="found__row">
            <span class="found__name">{{ name }}</span>
            <span class="found__ver" :class="{ muted: version }">{{ version ?? 'not found' }}</span>
          </li>
        </ul>
      </section>
    </div>

    <FolderPicker
      v-if="picking"
      :start="lists(picking.key)[picking.index]"
      @pick="onPick"
      @close="picking = null"
    />
  </div>
</template>

<style scoped lang="scss">
.page {
  @include stack($space-4);

  &__head {
    @include cluster($space-4);

    h1 {
      font-size: $font-size-xl;
    }
  }

  &__path {
    font-family: $font-mono;
    font-size: $font-size-sm;
    min-width: 0;
    @include truncate;
  }

  &__cols {
    display: grid;
    gap: $space-4;
    grid-template-columns: minmax(0, 1fr);
    align-items: start;
  }

  &__main,
  &__side {
    @include stack($space-4);
  }

  &__more {
    display: grid;
    gap: $space-4;
    grid-template-columns: repeat(
      auto-fit,
      minmax(max(380px, calc((100% - #{$space-4 * 2}) / 3)), 1fr)
    );
    align-items: stretch;
  }

  &__actions {
    @include cluster($space-3);
  }
}

.block {
  @include stack($space-2);
  padding: $space-4;

  &__head {
    display: flex;
    align-items: center;
    gap: $space-3;

    h2 {
      flex: 1;
      font-size: $font-size-md;
    }
  }

  &__help {
    font-size: 13px;
  }

  > h2 {
    font-size: $font-size-md;
  }

  > .btn {
    align-self: flex-start;
  }
}

.row {
  display: flex;
  gap: $space-2;

  &__input {
    flex: 1;
    font-family: $font-mono;
    font-size: 13px;
  }
}

.found {
  @include scroll-area;
  margin: 0;
  padding: 0;
  max-height: 340px;
  list-style: none;

  &__row {
    display: flex;
    gap: $space-3;
    padding: 3px 0;
  }

  &__name {
    flex: 1;
    @include truncate;
  }

  &__ver {
    font-family: $font-mono;
    font-size: $font-size-sm;
  }

  &--grid {
    column-width: 280px;
    column-gap: $space-5;
    max-height: none;
    overflow: visible;
  }

  &--grid &__row {
    break-inside: avoid;
  }

  &__row--mono {
    padding-left: $space-3;
    box-shadow: inset 3px 0 0 var(--gc);
  }
}

.hue {
  display: flex;
  gap: $space-4;

  &__pick {
    display: inline-flex;
    align-items: center;
    gap: $space-2;

    input {
      width: 44px;
      height: 30px;
      padding: 0;
      border: 1px solid var(--border);
      border-radius: $radius-sm;
      background: transparent;
      cursor: pointer;
    }
  }

  &__preview {
    display: flex;
    flex-wrap: wrap;
    gap: $space-2;
  }

  &__swatch {
    min-width: 46px;
    padding: 3px 10px;
    border: 1px solid color-mix(in srgb, var(--gc) 55%, var(--border));
    border-radius: $radius-md;
    background: color-mix(in srgb, var(--gc) 22%, var(--surface));
    color: var(--gc);
    font-size: $font-size-xs;
    font-weight: 700;
    min-height: 24px;
  }

  &__actions {
    @include cluster($space-2);
  }
}

.acc {
  align-items: center;

  &__dot {
    width: 8px;
    height: 8px;
    flex: none;
    border-radius: 50%;
    background: var(--ok);

    &--off {
      background: var(--danger);
    }
  }

  &__detail {
    font-size: $font-size-sm;
    text-align: right;
    @include truncate;
  }
}
</style>
