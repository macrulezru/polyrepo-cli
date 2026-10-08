import { computed, onBeforeUnmount, reactive, ref, shallowRef, watch, type Ref } from 'vue'
import { api, type Question, type RunEntry, type RunEvent, type RunSummary } from '../api'
import { LogBuilder } from '../logModel'
import { loadRuns } from '../store'

export interface PendingPrompt {
  id: number
  question: Question
}

export function useRun(runId: Ref<string>) {
  const summary = ref<RunSummary>()
  const builder = shallowRef(new LogBuilder())
  const tick = ref(0)
  const prompts = reactive(new Map<number, Question>())
  const connected = ref(false)
  const loaded = ref(false)
  const error = ref('')
  const eventCount = ref(0)

  let source: EventSource | undefined
  let lastSeq = 0
  let frame = 0
  let ended = false

  function bump(): void {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      tick.value += 1
    })
  }

  function apply(entry: RunEntry): void {
    if (entry.seq <= lastSeq) return
    lastSeq = entry.seq
    eventCount.value = entry.seq
    const event: RunEvent = entry.event
    if (event.type === 'prompt') {
      prompts.set(event.id, event.question)
      if (summary.value) summary.value = { ...summary.value, status: 'waiting' }
    } else if (event.type === 'answered') {
      prompts.delete(event.id)
      if (summary.value && prompts.size === 0)
        summary.value = { ...summary.value, status: 'running' }
    } else if (event.type === 'done') {
      prompts.clear()
      void loadRuns()
      if (summary.value) {
        summary.value = {
          ...summary.value,
          status: event.status,
          exitCode: event.exitCode,
          error: event.error,
          finishedAt: new Date().toISOString(),
        }
      }
    }
    builder.value.push(event)
    bump()
  }

  async function refreshSummary(): Promise<void> {
    try {
      summary.value = await api.get<RunSummary>(`/api/runs/${runId.value}`)
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : String(caught)
    }
  }

  function close(): void {
    source?.close()
    source = undefined
    connected.value = false
  }

  function open(): void {
    close()
    ended = false
    source = new EventSource(`/api/runs/${runId.value}/events?from=${lastSeq}`)
    source.onopen = () => {
      connected.value = true
    }
    source.onmessage = (message) => {
      try {
        apply(JSON.parse(message.data) as RunEntry)
      } catch {
        return
      }
    }
    source.addEventListener('end', () => {
      ended = true
      loaded.value = true
      close()
      void refreshSummary()
    })
    source.onerror = () => {
      connected.value = false
      if (!ended && source?.readyState === EventSource.CLOSED) {
        loaded.value = true
        close()
      }
    }
  }

  function reset(): void {
    close()
    builder.value = new LogBuilder()
    prompts.clear()
    lastSeq = 0
    eventCount.value = 0
    error.value = ''
    summary.value = undefined
    loaded.value = false
    tick.value += 1
  }

  watch(
    runId,
    async (id) => {
      reset()
      if (!id) {
        loaded.value = true
        return
      }
      await refreshSummary()
      if (summary.value) open()
      else loaded.value = true
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    close()
    if (frame) cancelAnimationFrame(frame)
  })

  const pending = computed<PendingPrompt | undefined>(() => {
    const first = [...prompts.entries()][0]
    return first ? { id: first[0], question: first[1] } : undefined
  })

  const running = computed(
    () => summary.value?.status === 'running' || summary.value?.status === 'waiting',
  )

  async function answer(id: number, value: unknown): Promise<void> {
    try {
      await api.post(`/api/runs/${runId.value}/answer`, { id, answer: value })
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : String(caught)
    }
  }

  async function cancel(): Promise<void> {
    try {
      await api.post(`/api/runs/${runId.value}/cancel`)
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : String(caught)
    }
  }

  return {
    summary,
    builder,
    tick,
    pending,
    running,
    connected,
    loaded,
    error,
    eventCount,
    answer,
    cancel,
  }
}
