<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api, type FolderListing } from '../api'
import UiModal from '../ui-components/UiModal.vue'
import Icon from './Icon.vue'

const props = defineProps<{ start?: string | undefined; title?: string | undefined }>()
const emit = defineEmits<{ pick: [path: string]; close: [] }>()

const listing = ref<FolderListing>()
const error = ref('')
const typed = ref('')

async function load(target: string): Promise<void> {
  try {
    listing.value = await api.get<FolderListing>(`/api/fs/list?path=${encodeURIComponent(target)}`)
    typed.value = listing.value.path
    error.value = ''
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
}

function child(name: string): string {
  const base = listing.value?.path ?? ''
  const separator = base.includes('\\') ? '\\' : '/'
  return base.endsWith(separator) ? `${base}${name}` : `${base}${separator}${name}`
}

onMounted(() => load(props.start ?? ''))
</script>

<template>
  <UiModal :title="title ?? 'Choose a folder'" width="640px" fixed-height @close="emit('close')">
    <div class="picker">
      <form class="picker__bar" @submit.prevent="load(typed)">
        <button
          type="button"
          class="btn btn--small"
          :disabled="!listing?.parent"
          title="Parent folder"
          @click="listing?.parent && load(listing.parent)"
        >
          <Icon name="up" :size="14" />
        </button>
        <button
          type="button"
          class="btn btn--small"
          title="Home folder"
          @click="listing && load(listing.home)"
        >
          <Icon name="home" :size="14" />
        </button>
        <input v-model="typed" class="input picker__path" spellcheck="false" />
        <button class="btn btn--small">Go</button>
      </form>
      <p v-if="error" class="notice notice--error">{{ error }}</p>
      <ul v-if="listing" class="picker__list">
        <li v-if="listing.folders.length === 0" class="muted picker__none">No subfolders.</li>
        <li v-for="folder in listing.folders" :key="folder.name">
          <button class="picker__row" @click="load(child(folder.name))">
            <Icon name="folder" :size="16" />
            <span class="picker__name">{{ folder.name }}</span>
            <span v-if="folder.repo" class="picker__repo">repo</span>
          </button>
        </li>
      </ul>
    </div>
    <template #footer>
      <span class="muted picker__current">{{ listing?.path }}</span>
      <button class="btn" @click="emit('close')">Cancel</button>
      <button
        class="btn btn--primary"
        :disabled="!listing"
        @click="listing && emit('pick', listing.path)"
      >
        Choose this folder
      </button>
    </template>
  </UiModal>
</template>

<style scoped lang="scss">
.picker {
  @include stack($space-2);
  padding: $space-3 $space-4;
  min-height: 0;
  flex: 1;

  &__bar {
    display: flex;
    gap: $space-2;
  }

  &__path {
    flex: 1;
    height: $control-height-sm;
    font-family: $font-mono;
    font-size: 13px;
  }

  &__list {
    @include scroll-area;
    flex: 1;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  &__none {
    padding: $space-3;
  }

  &__row {
    display: flex;
    align-items: center;
    gap: $space-2;
    width: 100%;
    padding: 6px $space-2;
    border: 0;
    border-radius: $radius-sm;
    background: transparent;
    text-align: left;
    cursor: pointer;
    @include hover-fill;
    @include focus-ring;
  }

  &__name {
    flex: 1;
    @include truncate;
  }

  &__repo {
    padding: 0 8px;
    border-radius: $radius-pill;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: $font-size-xs;
  }

  &__current {
    flex: 1;
    font-family: $font-mono;
    font-size: $font-size-sm;
    @include truncate;
  }
}
</style>
