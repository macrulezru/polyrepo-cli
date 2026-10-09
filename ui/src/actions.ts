import { api, type RunSummary } from './api'
import { askNotificationPermission, loadRuns, store } from './store'
import { navigate } from './router'
import type { NextStep, StepContext } from './nextSteps'

export async function startExec(dir: string, cmd: string, title?: string): Promise<void> {
  const run = await api.post<RunSummary>('/api/runs', {
    command: 'exec',
    title,
    options: { cmd, packages: [dir] },
    confirmed: true,
  })
  askNotificationPermission()
  await loadRuns()
  navigate('runs', run.id)
}

export function requestExec(
  dir: string,
  cmd: string,
  options: { title?: string; note?: string; danger?: boolean } = {},
): void {
  store.pendingExec = {
    dir,
    cmd,
    title: options.title ?? cmd,
    note: options.note ?? '',
    danger: options.danger ?? false,
  }
}

const CHANGING = [
  /\bnpm\s+(install|i|update|up|uninstall|rm|dedupe|ci)\b/,
  /\bnpm\s+audit\s+fix\b/,
  /\bpnpm\s+(add|install|i|update|up|remove|rm)\b/,
  /\byarn\s+(add|install|upgrade|remove)\b/,
]

export function changesDependencies(commands: string[]): boolean {
  return commands.some((line) => CHANGING.some((pattern) => pattern.test(line)))
}

const MAX_TERMINALS = 5

interface TerminalResult {
  opened: boolean
  reason?: string
  command: string
}

async function openPublishTerminals(
  dirs: string[],
  options: Record<string, unknown>,
): Promise<string | undefined> {
  if (dirs.length === 0) return undefined
  const distTag = typeof options.distTag === 'string' ? options.distTag : ''
  const results: TerminalResult[] = []
  for (const dir of dirs.slice(0, MAX_TERMINALS)) {
    results.push(await api.post<TerminalResult>('/api/terminal/publish', { dir, distTag }))
  }
  const failed = results.filter((result) => !result.opened)
  const skipped = dirs.length - results.length
  const notes: string[] = []
  if (failed.length === 0) {
    notes.push(
      `Opened ${results.length === 1 ? 'a terminal' : `${results.length} terminals`} with npm publish. Finish the sign-in there, then check the result with “Run again” or in Publish to npm.`,
    )
  } else {
    const text = failed.map((result) => result.command).join(String.fromCharCode(10))
    await navigator.clipboard.writeText(text).catch(() => undefined)
    notes.push(
      `No terminal could be opened (${failed[0]?.reason ?? 'unknown reason'}). The command is copied: run it in a terminal yourself.`,
    )
  }
  if (skipped > 0) {
    notes.push(`Only the first ${MAX_TERMINALS} packages were opened; ${skipped} more are left.`)
  }
  return notes.join(' ')
}

export interface StepHooks {
  log: () => void
  changes: () => void
}

export async function performStep(
  step: NextStep,
  ctx: StepContext,
  hooks: StepHooks,
): Promise<string | undefined> {
  const action = step.action
  const dir = ctx.dirs[0] ?? ''
  switch (action.type) {
    case 'exec':
      await startExec(dir, action.cmd, action.title)
      return
    case 'confirm':
      requestExec(dir, action.cmd, {
        note: action.note,
        danger: action.danger ?? false,
      })
      return
    case 'form':
      navigate('commands', action.command, action.query)
      return
    case 'link':
      window.location.hash = action.hash
      return
    case 'open':
      window.open(action.url, '_blank', 'noopener,noreferrer')
      return
    case 'copy':
      await navigator.clipboard.writeText(action.text)
      return
    case 'terminal-publish':
      return openPublishTerminals(ctx.dirs, ctx.options)
    case 'changes':
      hooks.changes()
      return
    case 'rerun':
      navigate('commands', ctx.command, { from: ctx.runId })
      return
    case 'log':
      hooks.log()
  }
}
