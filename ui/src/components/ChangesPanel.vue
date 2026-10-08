<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../api'
import { startExec } from '../actions'
import UiModal from '../ui-components/UiModal.vue'
import CommitDialog from './CommitDialog.vue'
import DiffView from './DiffView.vue'
import Icon from './Icon.vue'

interface RepoChanges {
  dir: string
  files: { file: string; added: number; removed: number }[]
  diff: string
}

const props = defineProps<{ dir: string; suggested: string; explainEmpty?: boolean }>()

const changes = ref<RepoChanges>()
const error = ref('')
const note = ref('')
const confirming = ref<'discard' | 'commit' | ''>('')
const busy = ref(false)

async function load(): Promise<void> {
  try {
    changes.value = await api.get<RepoChanges>(
      `/api/repo/changes?dir=${encodeURIComponent(props.dir)}`,
    )
  } catch (caught) {
    changes.value = undefined
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
}

async function discard(): Promise<void> {
  if (!changes.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const files = changes.value.files.map((entry) => entry.file)
    await api.post('/api/repo/revert', { dir: props.dir, files })
    note.value = 'The changes were discarded. Run npm ci if you want node_modules to match again.'
    confirming.value = ''
    await load()
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
    confirming.value = ''
  } finally {
    busy.value = false
  }
}

async function runTests(): Promise<void> {
  try {
    await startExec(props.dir, 'npm test', 'Tests')
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
}

onMounted(load)
</script>

<template>
  <section v-if="changes && (changes.files.length || note || explainEmpty)" class="chg">
    <header class="chg__head">
      <h3 class="chg__title">
        {{ changes.files.length || note ? 'Changes this run made' : 'Uncommitted changes' }}
      </h3>
      <span v-if="changes.files.length" class="muted chg__sub">not committed yet</span>
    </header>

    <p v-if="explainEmpty && !changes.files.length && !note" class="notice chg__note">
      The changes are not in package.json or the lock files, so they cannot be committed from here.
      Use “Show what changed”, or set everything aside with “Stash everything…”.
    </p>

    <ul v-if="changes.files.length" class="chg__files">
      <li v-for="entry in changes.files" :key="entry.file" class="chg__file">
        <span class="chg__name">{{ entry.file }}</span>
        <span class="chg__add">+{{ entry.added }}</span>
        <span class="chg__del">−{{ entry.removed }}</span>
      </li>
    </ul>

    <details v-if="changes.diff" class="chg__diff" open>
      <summary>The change to package.json</summary>
      <DiffView :diff="changes.diff" />
    </details>

    <div v-if="changes.files.length" class="chg__actions">
      <button class="btn btn--small" @click="confirming = 'commit'">
        <Icon name="check" :size="14" />
        Commit…
      </button>
      <button class="btn btn--small btn--danger" @click="confirming = 'discard'">
        <Icon name="trash" :size="14" />
        Discard…
      </button>
      <button class="btn btn--small" @click="runTests">
        <Icon name="flask" :size="14" />
        Run tests
      </button>
    </div>

    <p v-if="note" class="notice chg__note">{{ note }}</p>
    <p v-if="error" class="notice notice--error">{{ error }}</p>

    <UiModal
      v-if="confirming === 'discard' && changes"
      title="Discard these changes?"
      width="480px"
      @close="confirming = ''"
    >
      <div class="chg__confirm">
        <p>
          {{ changes.files.map((entry) => entry.file).join(', ') }} will go back to the last commit.
          This cannot be undone.
        </p>
        <p class="muted">
          The installed packages in node_modules are not touched; run npm ci afterwards to match the
          restored files.
        </p>
      </div>
      <template #footer>
        <span class="chg__spacer" />
        <button class="btn" @click="confirming = ''">Back</button>
        <button class="btn btn--critical" :disabled="busy" @click="discard">
          <Icon name="trash" :size="15" />
          Discard
        </button>
      </template>
    </UiModal>

    <CommitDialog
      v-if="confirming === 'commit'"
      :dir="dir"
      :suggested="suggested"
      @close="confirming = ''"
    />
  </section>
</template>

<style scoped lang="scss">
.chg {
  @include stack($space-2);
  margin-top: $space-2;
  padding-top: $space-3;
  border-top: 1px dashed var(--border);

  &__head {
    @include cluster($space-3);
  }

  &__title {
    font-size: $font-size-md;
  }

  &__sub {
    font-size: $font-size-sm;
  }

  &__files {
    @include stack(2px);
    margin: 0;
    padding: 0;
    list-style: none;
    font-family: $font-mono;
    font-size: 13px;
  }

  &__file {
    display: flex;
    gap: $space-3;
  }

  &__name {
    flex: 1;
    @include truncate;
  }

  &__add {
    color: var(--ok);
  }

  &__del {
    color: var(--danger);
  }

  &__diff {
    font-size: 13px;

    summary {
      cursor: pointer;
      color: var(--muted);
    }

    :deep(.diff) {
      margin-top: $space-2;
    }
  }

  &__actions {
    @include cluster($space-2);
  }

  &__note {
    font-size: 13px;
  }

  &__confirm {
    @include stack($space-3);
    padding: $space-4;
  }

  &__spacer {
    flex: 1;
  }
}
</style>
