<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api, type ConfigInfo } from '../api'
import { loadAuth, loadEnvironment, loadPackages, store } from '../store'
import EmptyState from './EmptyState.vue'
import FolderPicker from './FolderPicker.vue'
import Icon from './Icon.vue'

const picking = ref(false)
const error = ref('')
const busy = ref(false)

async function choose(path: string): Promise<void> {
  picking.value = false
  busy.value = true
  error.value = ''
  try {
    const config = await api.get<ConfigInfo>('/api/config')
    const roots = [...new Set([...config.roots, path])]
    await api.put('/api/config', {
      roots,
      packages: config.packages,
      gitlabHosts: config.gitlabHosts,
    })
    await loadPackages()
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  void loadEnvironment()
  void loadAuth()
})
</script>

<template>
  <div class="onb">
    <EmptyState
      icon="layers"
      title="Let’s find your packages"
      text="Choose the folder that holds your package repositories. Every subfolder with a package.json becomes a package. You can add more folders later in Settings."
    >
      <button class="btn btn--primary" :disabled="busy" @click="picking = true">
        <Icon name="folder" :size="15" />
        Choose a folder
      </button>
      <a class="btn" href="#/settings">Open Settings</a>
    </EmptyState>
    <p v-if="error" class="notice notice--error">{{ error }}</p>
    <p v-if="store.warnings.length" class="notice notice--warn">{{ store.warnings[0] }}</p>

    <section v-if="store.environment" class="card onb__env">
      <h2>What polyrepo found on this machine</h2>
      <ul>
        <li>
          <span class="dot" :class="{ 'dot--off': !store.environment.git }" />
          git <span class="muted">{{ store.environment.git ?? 'not found — required' }}</span>
        </li>
        <li>
          <span class="dot" :class="{ 'dot--off': !store.environment.npm }" />
          npm <span class="muted">{{ store.environment.npm ?? 'not found' }}</span>
          <span v-if="store.auth" class="muted">
            ·
            {{
              store.auth.npm.ok
                ? `signed in as ${store.auth.npm.detail}`
                : 'not signed in (needed to publish)'
            }}
          </span>
        </li>
        <li>
          <span class="dot" :class="{ 'dot--off': !store.environment.gh }" />
          gh
          <span class="muted">{{
            store.environment.gh ?? 'not found — needed for GitHub repos'
          }}</span>
          <span v-if="store.auth && store.environment.gh" class="muted">
            · {{ store.auth.gh.ok ? 'signed in' : 'not signed in — run gh auth login' }}
          </span>
        </li>
      </ul>
    </section>

    <FolderPicker
      v-if="picking"
      title="Where are your repositories?"
      @pick="choose"
      @close="picking = false"
    />
  </div>
</template>

<style scoped lang="scss">
.onb {
  @include stack($space-4);

  &__env {
    @include stack($space-2);
    max-width: 560px;
    margin: 0 auto;
    padding: $space-4;

    h2 {
      font-size: $font-size-md;
    }

    ul {
      @include stack(4px);
      margin: 0;
      padding: 0;
      list-style: none;
    }

    li {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: $space-2;
    }
  }
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ok);

  &--off {
    background: var(--danger);
  }
}
</style>
