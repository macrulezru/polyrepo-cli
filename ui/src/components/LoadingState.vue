<script setup lang="ts">
defineProps<{ text: string }>()
</script>

<template>
  <div class="load" role="status" aria-live="polite">
    <span class="load__spinner" aria-hidden="true" />
    <p class="muted load__text">{{ text }}</p>
  </div>
</template>

<style scoped lang="scss">
.load {
  @include stack($space-3);
  align-items: center;
  justify-content: center;
  min-height: calc(100vh - 260px);
  text-align: center;

  &__spinner {
    width: 44px;
    height: 44px;
    border: 4px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.9s linear infinite;
  }

  &__text {
    font-size: $font-size-md;
  }
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
