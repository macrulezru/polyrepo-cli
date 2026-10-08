<script setup lang="ts">
defineProps<{ title: string; subtitle?: string | undefined }>()
</script>

<template>
  <header class="ph">
    <div v-if="$slots.lead" class="ph__lead"><slot name="lead" /></div>
    <div class="ph__text">
      <div class="ph__line">
        <h1 class="ph__title">{{ title }}</h1>
        <slot name="badges" />
      </div>
      <p v-if="subtitle" class="muted ph__sub">{{ subtitle }}</p>
    </div>
    <div v-if="$slots.actions" class="ph__actions"><slot name="actions" /></div>
  </header>
</template>

<style scoped lang="scss">
.ph {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: $space-3;
  min-height: 44px;

  &__lead {
    @include cluster($space-2);
  }

  &__text {
    flex: 1;
    min-width: 0;
  }

  &__line {
    @include cluster($space-3);
  }

  &__title {
    font-size: $font-size-xl;
  }

  &__sub {
    font-size: 13px;
  }

  &__actions {
    @include cluster($space-2);
    margin-left: auto;
  }
}
</style>
