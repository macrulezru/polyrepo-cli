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

export interface StepHooks {
  log: () => void
  changes: () => void
}

export async function performStep(
  step: NextStep,
  ctx: StepContext,
  hooks: StepHooks,
): Promise<void> {
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
