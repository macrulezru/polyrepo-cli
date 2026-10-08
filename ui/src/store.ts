import { reactive } from 'vue'
import {
  api,
  type AuthState,
  type CommandInfo,
  type EnvironmentInfo,
  type PackageInfo,
  type PackagesResult,
  type Preset,
  type RunSummary,
  type StatusInfo,
  type UiSettings,
} from './api'

export const store = reactive({
  status: undefined as StatusInfo | undefined,
  environment: undefined as EnvironmentInfo | undefined,
  auth: undefined as AuthState | undefined,
  commands: [] as CommandInfo[],
  packages: [] as PackageInfo[],
  packagesLoaded: false,
  warnings: [] as string[],
  runs: [] as RunSummary[],
  presets: [] as Preset[],
  settings: { groupColors: { from: '#4f7bff', to: '#c06be0' } } as UiSettings,
  loadError: '',
  paletteOpen: false,
})

const known = new Map<string, string>()
let primed = false
const baseTitle = document.title

function notify(run: RunSummary): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  if (document.visibilityState === 'visible' && window.location.hash.includes(run.id)) return
  const verdict =
    run.status === 'done' ? 'finished' : run.status === 'cancelled' ? 'was cancelled' : 'failed'
  try {
    const note = new Notification(`polyrepo: ${run.title} ${verdict}`, {
      body: run.stats
        ? `${run.stats.ok} passed, ${run.stats.warn} warnings, ${run.stats.fail} failures`
        : '',
    })
    note.onclick = () => {
      window.focus()
      window.location.hash = `#/runs/${run.id}`
    }
  } catch {
    return
  }
}

function updateTitle(): void {
  const waiting = store.runs.filter((run) => run.status === 'waiting').length
  const running = store.runs.filter((run) => run.status === 'running').length
  if (waiting > 0) document.title = `(${waiting}) Waiting for you · ${baseTitle}`
  else if (running > 0) document.title = `Running · ${baseTitle}`
  else document.title = baseTitle
}

export function askNotificationPermission(): void {
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    void Notification.requestPermission()
  }
}

export async function loadBase(): Promise<void> {
  try {
    const [status, commands] = await Promise.all([
      api.get<StatusInfo>('/api/status'),
      api.get<CommandInfo[]>('/api/commands'),
    ])
    store.status = status
    store.commands = commands
    store.loadError = ''
  } catch (caught) {
    store.loadError = caught instanceof Error ? caught.message : String(caught)
  }
}

export async function loadEnvironment(): Promise<void> {
  try {
    store.environment = await api.get<EnvironmentInfo>('/api/environment')
  } catch {
    store.environment = undefined
  }
}

export async function loadAuth(): Promise<void> {
  try {
    store.auth = await api.get<AuthState>('/api/auth')
  } catch {
    store.auth = undefined
  }
}

export async function loadPackages(): Promise<void> {
  try {
    const result = await api.get<PackagesResult>('/api/packages')
    store.packages = result.packages
    store.warnings = result.warnings
  } catch (caught) {
    store.packages = []
    store.warnings = [caught instanceof Error ? caught.message : String(caught)]
  } finally {
    store.packagesLoaded = true
  }
}

export async function loadRuns(): Promise<void> {
  try {
    const runs = await api.get<RunSummary[]>('/api/runs')
    for (const run of runs) {
      const before = known.get(run.id)
      const active = run.status === 'running' || run.status === 'waiting'
      if (primed && before !== undefined && before !== run.status && !active) notify(run)
      known.set(run.id, run.status)
    }
    primed = true
    store.runs = runs
    updateTitle()
  } catch {
    return
  }
}

export async function loadPresets(): Promise<void> {
  try {
    store.presets = await api.get<Preset[]>('/api/presets')
  } catch {
    store.presets = []
  }
}

export async function loadSettings(): Promise<void> {
  try {
    store.settings = await api.get<UiSettings>('/api/settings')
  } catch {
    return
  }
}

export async function saveSettings(settings: UiSettings): Promise<void> {
  store.settings = await api.put<UiSettings>('/api/settings', settings)
}

export async function savePresets(presets: Preset[]): Promise<void> {
  store.presets = await api.put<Preset[]>('/api/presets', presets)
}

export function commandById(id: string): CommandInfo | undefined {
  return store.commands.find((command) => command.id === id)
}
