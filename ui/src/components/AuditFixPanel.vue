<script setup lang="ts">
import { ref } from 'vue'
import type { AuditReport } from '../auditParse'
import { requestExec, startExec } from '../actions'
import Icon from './Icon.vue'
import StatusChip, { type ChipTone } from './StatusChip.vue'

const props = defineProps<{ audit: AuditReport; dir: string }>()

const error = ref('')
const busy = ref(false)

function tone(severity: string): ChipTone {
  if (severity === 'critical' || severity === 'high') return 'danger'
  if (severity === 'moderate') return 'warn'
  return 'muted'
}

function installOne(target: string): void {
  requestExec(props.dir, `npm install ${target}`, {
    note: 'Installs just this version and updates package.json and the lock file.',
  })
}

async function run(cmd: string, title: string): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await startExec(props.dir, cmd, title)
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="afx">
    <header class="afx__head">
      <h3 class="afx__title">What is left</h3>
      <span class="afx__counts">
        <StatusChip v-for="item in audit.counts" :key="item.severity" :tone="tone(item.severity)"
          >{{ item.count }} {{ item.severity }}</StatusChip
        >
      </span>
    </header>
    <p class="muted afx__note">
      These need an update that npm marks as a breaking change, so it did not apply them. Pick what
      to do about each one, or preview first.
    </p>

    <div v-for="group in audit.groups" :key="group.target || 'none'" class="afx__group">
      <div class="afx__ghead">
        <span class="afx__gtitle">
          <template v-if="group.target"
            >Update to <code>{{ group.target }}</code></template
          >
          <template v-else>No automatic fix</template>
        </span>
        <StatusChip v-if="group.breaking" tone="warn">breaking change</StatusChip>
        <button
          v-if="group.target"
          class="btn btn--small afx__one"
          title="Install just this update"
          @click="installOne(group.target)"
        >
          <Icon name="package" :size="14" />
          Update only this…
        </button>
      </div>
      <ul class="afx__list">
        <li v-for="entry in group.entries" :key="entry.name" class="afx__row">
          <span class="afx__name">{{ entry.name }}</span>
          <StatusChip v-if="entry.severity" :tone="tone(entry.severity)">{{
            entry.severity
          }}</StatusChip>
          <span class="muted afx__range">{{ entry.range }}</span>
          <span class="afx__links">
            <a
              v-for="advisory in entry.advisories"
              :key="advisory.url"
              :href="advisory.url"
              target="_blank"
              rel="noopener noreferrer"
              :title="advisory.title"
              >{{ advisory.url.split('/').pop() }}</a
            >
          </span>
        </li>
      </ul>
    </div>

    <div class="afx__actions">
      <button
        class="btn btn--small"
        :disabled="busy"
        title="Shows what --force would change, without changing anything"
        @click="run('npm audit fix --force --dry-run', 'Preview: audit fix --force')"
      >
        <Icon name="eye" :size="14" />
        Preview <code>--force</code>
      </button>
      <button
        class="btn btn--small"
        :disabled="busy"
        title="Only the dependencies that ship to users"
        @click="run('npm audit --omit=dev', 'Audit: production only')"
      >
        <Icon name="audit" :size="14" />
        Production only
      </button>
      <button
        class="btn btn--small btn--danger"
        title="Applies every breaking update. Review the changes afterwards."
        @click="
          requestExec(dir, 'npm audit fix --force', {
            danger: true,
            note: 'Applies every update npm marks as a breaking change. Review the changes and run the tests afterwards.',
          })
        "
      >
        <Icon name="bolt" :size="14" />
        Apply <code>--force</code>…
      </button>
    </div>
    <p v-if="error" class="notice notice--error">{{ error }}</p>
  </section>
</template>

<style scoped lang="scss">
.afx {
  @include stack($space-3);
  margin-top: $space-2;
  padding-top: $space-3;
  border-top: 1px dashed var(--border);

  &__head {
    @include cluster($space-3);
  }

  &__title {
    font-size: $font-size-md;
  }

  &__counts {
    @include cluster($space-2);
  }

  &__note {
    font-size: 13px;
  }

  &__group {
    @include surface($radius-md);
    box-shadow: none;
    overflow: hidden;
  }

  &__ghead {
    @include cluster($space-3);
    padding: 6px $space-3;
    background: var(--surface-2);
  }

  &__gtitle {
    font-weight: 600;
  }

  &__one {
    margin-left: auto;
  }

  &__list {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  &__row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: $space-3;
    padding: 6px $space-3;
    border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  }

  &__name {
    min-width: 150px;
    font-family: $font-mono;
    font-weight: 600;
  }

  &__range {
    font-family: $font-mono;
    font-size: $font-size-sm;
  }

  &__links {
    @include cluster($space-2);
    margin-left: auto;
    font-size: $font-size-sm;
  }

  &__actions {
    @include cluster($space-2);
  }
}
</style>
