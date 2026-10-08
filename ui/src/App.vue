<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { hrefFor, useRoute } from './router'
import {
  commandById,
  loadBase,
  loadEnvironment,
  loadPackages,
  loadPresets,
  loadSettings,
  loadRuns,
  store,
} from './store'
import CommandPalette from './components/CommandPalette.vue'
import ConfirmExecModal from './components/ConfirmExecModal.vue'
import Icon from './components/Icon.vue'
import CommandForm from './pages/CommandForm.vue'
import CommandsPage from './pages/CommandsPage.vue'
import PackagesPage from './pages/PackagesPage.vue'
import ReleaseWizard from './pages/ReleaseWizard.vue'
import RunPage from './pages/RunPage.vue'
import RunsPage from './pages/RunsPage.vue'
import SettingsPage from './pages/SettingsPage.vue'

const route = useRoute()

const NAV = [
  { page: 'packages', label: 'Packages', icon: 'layers' },
  { page: 'commands', label: 'Commands', icon: 'play' },
  { page: 'release', label: 'Release', icon: 'rocket' },
  { page: 'runs', label: 'Runs', icon: 'outdated' },
  { page: 'settings', label: 'Settings', icon: 'folder' },
]

const active = computed(() => route.value.page)
const activeRuns = computed(
  () => store.runs.filter((run) => run.status === 'running' || run.status === 'waiting').length,
)
const command = computed(() => commandById(route.value.param))

const tools = computed(() => {
  const environment = store.environment
  if (!environment) return []
  return [
    { name: 'git', ok: !!environment.git },
    { name: 'npm', ok: !!environment.npm },
    { name: 'gh', ok: !!environment.gh },
  ]
})

const configName = computed(() => (store.status?.configPath ?? '').split(/[\\/]/).pop() ?? '')

let timer = 0

function reload(): void {
  window.location.reload()
}

function onKey(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    store.paletteOpen = !store.paletteOpen
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onKey)
  await loadBase()
  void loadPackages()
  void loadRuns()
  void loadEnvironment()
  void loadPresets()
  void loadSettings()
  timer = window.setInterval(loadRuns, 5000)
})
onBeforeUnmount(() => {
  clearInterval(timer)
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div class="shell">
    <aside class="shell__side">
      <a class="brand" :href="hrefFor('packages')">
        <span class="brand__mark">pr</span>
        <span class="brand__name">polyrepo</span>
        <span v-if="store.status" class="muted brand__ver">{{ store.status.version }}</span>
      </a>
      <button class="find" title="Command palette" @click="store.paletteOpen = true">
        <Icon name="search" :size="15" />
        <span class="find__label">Search</span>
        <kbd class="find__kbd">Ctrl K</kbd>
      </button>
      <nav class="nav">
        <a
          v-for="item in NAV"
          :key="item.page"
          class="nav__item"
          :class="{ 'nav__item--on': active === item.page }"
          :href="hrefFor(item.page)"
        >
          <Icon :name="item.icon" :size="17" />
          <span class="nav__label">{{ item.label }}</span>
          <span v-if="item.page === 'runs' && activeRuns" class="nav__count">{{ activeRuns }}</span>
        </a>
      </nav>
      <div class="shell__foot">
        <a
          v-if="tools.length"
          class="env"
          :href="hrefFor('settings')"
          title="Tools found on this machine"
        >
          <span v-for="tool in tools" :key="tool.name" class="env__tool">
            <span class="env__dot" :class="{ 'env__dot--off': !tool.ok }" />{{ tool.name }}
          </span>
        </a>
        <a
          v-if="store.status"
          class="muted shell__config"
          :href="hrefFor('settings')"
          :title="store.status.configPath"
        >
          <Icon name="folder" :size="13" />
          <span>{{ configName }}</span>
        </a>
      </div>
    </aside>

    <main class="shell__main">
      <p v-if="store.offline" class="notice notice--error app__offline">
        <span
          >Lost the connection to polyrepo ui. It was probably stopped: start it again with
          <code>polyrepo ui</code> and reload this page. Your runs and settings are kept.</span
        >
        <button class="btn btn--small" @click="reload">Reload</button>
      </p>
      <p v-if="store.loadError" class="notice notice--error">{{ store.loadError }}</p>
      <PackagesPage v-if="active === 'packages'" />
      <template v-else-if="active === 'commands'">
        <CommandForm v-if="command" :command="command" />
        <CommandsPage v-else />
      </template>
      <ReleaseWizard v-else-if="active === 'release'" />
      <RunPage v-else-if="active === 'runs' && route.param" :id="route.param" />
      <RunsPage v-else-if="active === 'runs'" />
      <SettingsPage v-else-if="active === 'settings'" />
      <PackagesPage v-else />
    </main>

    <CommandPalette v-if="store.paletteOpen" @close="store.paletteOpen = false" />
    <ConfirmExecModal />
  </div>
</template>

<style scoped lang="scss">
.shell {
  display: grid;
  grid-template-columns: $sidebar-width minmax(0, 1fr);
  height: 100%;

  @include respond-below(md) {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
  }

  &__side {
    @include stack($space-4);
    padding: $space-4 $space-3;
    border-right: 1px solid var(--border);
    background: var(--surface);
    min-width: 0;

    @include respond-below(md) {
      flex-direction: row;
      align-items: center;
      border-right: 0;
      border-bottom: 1px solid var(--border);
      overflow-x: auto;
    }
  }

  &__main {
    @include scroll-area;
    padding: $space-6;
    min-width: 0;

    @include respond-below(md) {
      padding: $space-4;
    }
  }

  &__foot {
    @include stack($space-2);
    margin-top: auto;

    @include respond-below(md) {
      display: none;
    }
  }

  &__config {
    display: flex;
    align-items: center;
    gap: $space-2;
    padding: 0 $space-2;
    font-family: $font-mono;
    font-size: $font-size-xs;
    color: var(--muted);
    text-decoration: none;
    @include truncate;
  }
}

.app__offline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $space-3;
  margin-bottom: $space-3;
}

.brand {
  display: flex;
  align-items: center;
  gap: $space-2;
  padding: 0 $space-2;
  color: inherit;
  text-decoration: none;

  &__mark {
    @include icon-tile(28px);
    border-radius: $radius-md;
    background: var(--accent);
    color: var(--accent-ink);
    font-weight: 700;
    font-size: $font-size-sm;
  }

  &__name {
    font-weight: 700;
    font-size: $font-size-md;

    @include respond-below(sm) {
      display: none;
    }
  }

  &__ver {
    font-size: $font-size-xs;

    @include respond-below(sm) {
      display: none;
    }
  }
}

.find {
  display: flex;
  align-items: center;
  gap: $space-2;
  padding: 6px $space-3;
  border: 1px solid var(--border);
  border-radius: $radius-md;
  background: var(--surface-2);
  color: var(--muted);
  cursor: pointer;
  @include focus-ring;

  @include respond-below(md) {
    padding: 6px;
  }

  &__label {
    flex: 1;
    text-align: left;

    @include respond-below(md) {
      display: none;
    }
  }

  &__kbd {
    padding: 0 6px;
    border: 1px solid var(--border);
    border-radius: $radius-sm;
    font-size: $font-size-xs;

    @include respond-below(md) {
      display: none;
    }
  }
}

.nav {
  @include stack(2px);

  @include respond-below(md) {
    flex-direction: row;
  }

  &__item {
    display: flex;
    align-items: center;
    gap: $space-2;
    padding: 7px $space-3;
    border-radius: $radius-md;
    color: inherit;
    text-decoration: none;
    @include hover-fill;
    @include focus-ring;

    &--on {
      background: var(--accent-soft);
      color: var(--accent);
      font-weight: 600;
    }
  }

  &__label {
    @include respond-below(sm) {
      display: none;
    }
  }

  &__count {
    margin-left: auto;
    padding: 0 7px;
    border-radius: $radius-pill;
    background: var(--accent);
    color: var(--accent-ink);
    font-size: $font-size-xs;
    font-weight: 700;
  }
}

.env {
  display: flex;
  gap: $space-3;
  padding: 0 $space-2;
  color: var(--muted);
  font-size: $font-size-sm;
  text-decoration: none;

  &__tool {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  &__dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--ok);

    &--off {
      background: var(--danger);
    }
  }
}
</style>
