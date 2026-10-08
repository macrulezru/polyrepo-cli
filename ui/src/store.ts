import { reactive } from 'vue'
import { stripAnsi } from './ansi'
import {
  api,
  type AuthState,
  type CommandInfo,
  type EnvironmentInfo,
  type PackageInfo,
  type PackagesResult,
  type Preset,
  type RunEntry,
  type RunSummary,
  type StatusInfo,
  type TableCell,
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
  offline: false,
  paletteOpen: false,
  patches: {} as Record<string, { columns: string[]; cells: TableCell[]; at: number }>,
  reportCache: undefined as
    | {
        id: string
        table: { kind: 'table'; columns: string[]; rows: { gap: boolean; cells: TableCell[] }[] }
      }
    | undefined,
  refreshing: [] as string[],
  reportStale: false,
  pendingExec: undefined as
    { dir: string; cmd: string; title: string; note: string; danger: boolean } | undefined,
})

const known = new Map<string, string>()
let primed = false
let primedAt = 0
let failures = 0
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
      const finishedAfterStart =
        before === undefined && !!run.finishedAt && new Date(run.finishedAt).getTime() >= primedAt
      if (
        primed &&
        ((before !== undefined && before !== run.status) || finishedAfterStart) &&
        !active
      ) {
        notify(run)
        void afterRun(run)
      }
      known.set(run.id, run.status)
    }
    if (!primed) primedAt = Date.now()
    primed = true
    failures = 0
    store.offline = false
    store.runs = runs
    updateTitle()
  } catch {
    failures += 1
    if (failures >= 2) store.offline = true
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFinished(id: string): Promise<void> {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const run = await api.get<RunSummary>(`/api/runs/${id}`)
    if (run.status !== 'running' && run.status !== 'waiting') return
    await sleep(800)
  }
}

export async function refreshPackages(dirs: string[]): Promise<void> {
  const unique = [...new Set(dirs)].filter((dir) => store.packages.some((pkg) => pkg.dir === dir))
  if (unique.length === 0) {
    await loadPackages()
    return
  }
  store.refreshing = [...new Set([...store.refreshing, ...unique])]
  try {
    await loadPackages()
    const run = await api.post<RunSummary>('/api/runs', {
      command: 'list',
      hidden: true,
      options: { packages: unique },
    })
    await waitFinished(run.id)
    const log = await api.get<RunEntry[]>(`/api/runs/${run.id}/log`)
    for (const entry of log) {
      if (entry.event.type !== 'table') continue
      for (const row of entry.event.rows) {
        const key = stripAnsi(row.cells[0]?.text ?? '')
        store.patches[key] = { columns: entry.event.columns, cells: row.cells, at: Date.now() }
      }
    }
  } catch {
    store.reportStale = true
  } finally {
    store.refreshing = store.refreshing.filter((dir) => !unique.includes(dir))
  }
}

export function resolvePackageDirs(label: string): string[] {
  const clean = stripAnsi(label)
  const bare = clean
    .replace(/\s*\d[\d.]*(?:-[\w.]+)?\s*→.*$/, '')
    .replace(/@[^@/\s]+$/, '')
    .trim()
  const found = new Set<string>()
  for (const pkg of store.packages) {
    if (pkg.dir === clean || pkg.dir === bare || pkg.name === bare || pkg.repoDir === bare) {
      found.add(pkg.dir)
    }
  }
  return [...found]
}

async function dirsFromLog(id: string): Promise<string[]> {
  try {
    const log = await api.get<RunEntry[]>(`/api/runs/${id}/log`)
    const found = new Set<string>()
    for (const entry of log) {
      if (entry.event.type !== 'step') continue
      for (const dir of resolvePackageDirs(entry.event.label)) found.add(dir)
    }
    return [...found]
  } catch {
    return []
  }
}

export async function afterRun(run: RunSummary): Promise<void> {
  const command = commandById(run.command)
  const changes =
    !!command?.mutating ||
    run.options.cleanBranches === true ||
    run.options.cleanRemoteBranches === true
  if (!changes || run.options.dryRun === true) return
  if (run.command === 'clone') {
    await loadPackages()
    store.reportStale = true
    return
  }
  let dirs = Array.isArray(run.options.packages) ? run.options.packages.map(String) : []
  if (dirs.length === 0) dirs = await dirsFromLog(run.id)
  if (dirs.length === 0) {
    await loadPackages()
    store.reportStale = true
    return
  }
  await refreshPackages(dirs)
}
