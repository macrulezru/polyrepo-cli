<script setup lang="ts">
import Icon from './Icon.vue'

defineProps<{ icon: string; title: string; text?: string | undefined }>()
</script>

<template>
  <div class="empty">
    <span class="empty__icon"><Icon :name="icon" :size="26" /></span>
    <h2 class="empty__title">{{ title }}</h2>
    <p v-if="text" class="muted empty__text">{{ text }}</p>
    <div v-if="$slots.default" class="empty__actions"><slot /></div>
  </div>
</template>

<style scoped lang="scss">
.empty {
  @include stack($space-2);
  align-items: center;
  max-width: 460px;
  margin: $space-7 auto;
  text-align: center;

  &__icon {
    @include icon-tile(56px);
    border-radius: $radius-lg;
    background: var(--accent-soft);
    color: var(--accent);
  }

  &__title {
    font-size: $font-size-lg;
  }

  &__actions {
    @include cluster($space-2);
    justify-content: center;
    margin-top: $space-2;
  }
}
</style>
