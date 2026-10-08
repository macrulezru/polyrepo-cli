<script setup lang="ts">
import { ref } from 'vue'
import { startExec } from '../actions'
import { store } from '../store'
import UiModal from '../ui-components/UiModal.vue'
import Icon from './Icon.vue'

const error = ref('')
const busy = ref(false)

async function run(): Promise<void> {
  const pending = store.pendingExec
  if (!pending || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await startExec(pending.dir, pending.cmd, pending.title)
    store.pendingExec = undefined
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  } finally {
    busy.value = false
  }
}

function close(): void {
  store.pendingExec = undefined
  error.value = ''
}
</script>

<template>
  <UiModal v-if="store.pendingExec" title="Run this command?" width="520px" @close="close">
    <div class="cx">
      <p>
        In <strong>{{ store.pendingExec.dir }}</strong
        >:
      </p>
      <pre class="cx__cmd">$ {{ store.pendingExec.cmd }}</pre>
      <p v-if="store.pendingExec.note" class="muted cx__note">{{ store.pendingExec.note }}</p>
      <p v-if="store.pendingExec.danger" class="notice notice--error">
        This can change dependencies in ways that break the package. Nothing is committed, so you
        can review the changes and discard them afterwards.
      </p>
      <p v-if="error" class="notice notice--error">{{ error }}</p>
    </div>
    <template #footer>
      <span class="cx__spacer" />
      <button class="btn" @click="close">Cancel</button>
      <button
        class="btn"
        :class="store.pendingExec.danger ? 'btn--critical' : 'btn--primary'"
        :disabled="busy"
        @click="run"
      >
        <Icon :name="store.pendingExec.danger ? 'bolt' : 'play'" :size="15" />
        Run it
      </button>
    </template>
  </UiModal>
</template>

<style scoped lang="scss">
.cx {
  @include stack($space-3);
  padding: $space-4;

  &__cmd {
    margin: 0;
    padding: $space-3;
    border-radius: $radius-md;
    background: var(--surface-2);
    font-size: 13px;
    white-space: pre-wrap;
    word-break: break-all;
  }

  &__note {
    font-size: 13px;
  }

  &__spacer {
    flex: 1;
  }
}
</style>
