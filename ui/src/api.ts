export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  let data: Record<string, unknown> = {}
  try {
    data = text === '' ? {} : (JSON.parse(text) as Record<string, unknown>)
  } catch {
    data = { error: text }
  }
  if (!response.ok) {
    const message =
      typeof data.error === 'string' ? data.error : `The request failed (${response.status})`
    throw new ApiError(response.status, message)
  }
  return data as T
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body: unknown = {}) => request<T>('POST', url, body),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
}

export interface StatusInfo {
  version: string
  configPath: string
  configExists: boolean
  home: string
  platform: string
  cwd: string
}

export interface EnvironmentInfo {
  node: string
  git: string | null
  gh: string | null
  glab: string | null
  npm: string | null
  pnpm: string | null
}

export interface ConfigInfo {
  path: string
  exists: boolean
  roots: string[]
  packages: string[]
  gitlabHosts: string[]
  error: string | null
}

export interface PackageInfo {
  dir: string
  name: string
  version: string | null
  private: boolean
  path: string
  repoDir: string
  isWorkspaceMember: boolean
  branch?: string | null
  dirty?: boolean | null
}

export interface PackagesResult {
  packages: PackageInfo[]
  warnings: string[]
}

export interface CommandOption {
  key: string
  type: 'boolean' | 'select' | 'text'
  label: string
  help: string
  default: boolean | string
  choices?: string[]
  required?: boolean
  danger?: boolean
  writes?: boolean
  requires?: string
  showWhen?: { key: string; in: string[] }
}

export interface CommandInfo {
  id: string
  title: string
  group: 'inspect' | 'sync' | 'release'
  summary: string
  mutating: boolean
  packages: 'none' | 'filter' | 'select'
  options: CommandOption[]
}

export interface FolderListing {
  path: string
  parent: string | null
  home: string
  isRepo: boolean
  folders: { name: string; repo: boolean }[]
}

export type RunStatus = 'running' | 'waiting' | 'done' | 'failed' | 'cancelled'

export interface RunSummary {
  id: string
  command: string
  title: string
  options: Record<string, unknown>
  startedAt: string
  finishedAt: string | null
  status: RunStatus
  exitCode: number | null
  error: string | null
  events: number
  stats?: { ok: number; warn: number; fail: number; steps: number }
}

export interface PromptChoice {
  id: number
  name: string
  description: string | null
  checked: boolean
  disabled: false | string
  separator: boolean
}

export type Question =
  | { kind: 'confirm'; message: string; default: boolean }
  | { kind: 'input'; message: string; default: string }
  | { kind: 'checkbox' | 'select'; message: string; choices: PromptChoice[] }

export interface TableCell {
  text: string
  styled: string
}

export type RunEvent =
  | { type: 'blank' }
  | { type: 'line'; text: string }
  | { type: 'heading'; text: string }
  | { type: 'step'; index: number; total: number; label: string }
  | { type: 'ok' | 'fail' | 'warn'; text: string }
  | { type: 'command'; cmd: string; args: string[]; mutating: boolean; dryRun: boolean }
  | { type: 'output'; text: string }
  | { type: 'table'; columns: string[]; rows: { gap: boolean; cells: TableCell[] }[] }
  | { type: 'progress'; id: number; message: string; state: 'running' | 'done' }
  | { type: 'raw'; stream: 'stdout' | 'stderr'; text: string }
  | { type: 'prompt'; id: number; question: Question }
  | { type: 'answered'; id: number }
  | { type: 'done'; status: RunStatus; exitCode: number | null; error: string | null }

export interface RunEntry {
  seq: number
  event: RunEvent
}

export function formatDuration(from: string, to: string | null): string {
  const start = new Date(from).getTime()
  const end = to ? new Date(to).getTime() : Date.now()
  const seconds = Math.max(0, Math.round((end - start) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
}

export function formatWhen(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export interface Preset {
  name: string
  packages: string[]
}

export interface UiSettings {
  groupColors: { from: string; to: string }
}

export interface AuthProbe {
  ok: boolean
  detail: string
}

export interface AuthState {
  gh: AuthProbe
  glab: AuthProbe
  npm: AuthProbe
}

export function ago(value: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.round(hours / 24)} d ago`
}

export function dayLabel(value: string): string {
  const date = new Date(value)
  const today = new Date()
  const yesterday = new Date(today.getTime() - 86400000)
  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
}
