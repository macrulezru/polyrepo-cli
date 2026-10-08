<script setup lang="ts">
import { computed } from 'vue'
import { hrefFor } from '../router'
import { store } from '../store'
import type { CommandInfo } from '../api'
import { COMMAND_ICONS } from '../commandIcons'
import Icon from '../components/Icon.vue'
import PageHeader from '../components/PageHeader.vue'

const GROUPS: { id: CommandInfo['group']; title: string; hint: string }[] = [
  { id: 'inspect', title: 'Inspect', hint: 'Read-only reports. Nothing is changed.' },
  { id: 'sync', title: 'Sync', hint: 'Bring the local repos in line with the hosts.' },
  { id: 'release', title: 'Release', hint: 'Bump, tag, publish and release.' },
]

const grouped = computed(() =>
  GROUPS.map((group) => ({
    ...group,
    commands: store.commands.filter((command) => command.group === group.id),
  })).filter((group) => group.commands.length > 0),
)
</script>

<template>
  <div class="page">
    <PageHeader
      title="Commands"
      subtitle="Everything the polyrepo CLI can do, with the same options."
    >
      <template #actions>
        <a class="btn" href="#/release">
          <Icon name="rocket" :size="14" />
          Release wizard
        </a>
      </template>
    </PageHeader>
    <section v-for="group in grouped" :key="group.id" class="group" :class="`group--${group.id}`">
      <div class="group__head">
        <h2>{{ group.title }}</h2>
        <span class="muted">{{ group.hint }}</span>
      </div>
      <div class="group__grid">
        <a
          v-for="command in group.commands"
          :key="command.id"
          class="card cmd"
          :href="hrefFor('commands', command.id)"
        >
          <div class="cmd__top">
            <span class="cmd__icon"
              ><Icon :name="COMMAND_ICONS[command.id] ?? 'play'" :size="20"
            /></span>
            <span class="cmd__title">{{ command.title }}</span>
            <span v-if="command.mutating" class="cmd__tag">changes things</span>
            <Icon name="right" :size="14" />
          </div>
          <p class="muted cmd__summary">{{ command.summary }}</p>
          <code class="cmd__id">polyrepo {{ command.id }}</code>
        </a>
      </div>
    </section>
  </div>
</template>

<style scoped lang="scss">
.page {
  @include stack($space-5);

  &__head h1 {
    font-size: $font-size-xl;
  }
}

.group {
  @include stack($space-3);
  --tone: var(--accent);

  &--sync {
    --tone: #1d97ad;
  }

  &--release {
    --tone: #b052d6;
  }

  &__head {
    display: flex;
    align-items: baseline;
    gap: $space-3;

    h2 {
      font-size: $font-size-md;
      color: var(--tone);
    }
  }

  &__grid {
    display: grid;
    gap: $space-3;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  }
}

.cmd {
  @include stack($space-2);
  padding: $space-4;
  color: inherit;
  text-decoration: none;
  transition: border-color $transition-fast;

  background: color-mix(in srgb, var(--tone) 5%, var(--surface));
  border-color: color-mix(in srgb, var(--tone) 28%, var(--border));

  &:hover {
    border-color: var(--tone);
  }

  &__icon {
    @include icon-tile(34px);
    flex: none;
    border-radius: $radius-md;
    background: color-mix(in srgb, var(--tone) 18%, transparent);
    color: var(--tone);
  }

  &__top {
    display: flex;
    align-items: center;
    gap: $space-2;
  }

  &__title {
    flex: 1;
    font-weight: 600;
  }

  &__tag {
    padding: 0 8px;
    border-radius: $radius-pill;
    background: var(--warn-soft);
    color: var(--warn);
    font-size: $font-size-xs;
  }

  &__summary {
    flex: 1;
    font-size: 13px;
  }

  &__id {
    color: var(--tone);
    opacity: 0.85;
    font-size: $font-size-sm;
  }
}
</style>
