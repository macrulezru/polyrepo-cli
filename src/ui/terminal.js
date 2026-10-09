import { spawn, spawnSync } from 'node:child_process'

const SAFE_TAG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export function publishInvocation(repo, resolvedDistTag) {
  if (resolvedDistTag !== undefined && !SAFE_TAG.test(resolvedDistTag)) {
    throw new Error(`"${resolvedDistTag}" is not a valid dist-tag`)
  }
  const tagArgs = resolvedDistTag ? ['--tag', resolvedDistTag] : []
  return repo.isWorkspaceMember
    ? { cmd: 'pnpm', args: ['publish', '--no-git-checks', ...tagArgs] }
    : { cmd: 'npm', args: ['publish', ...tagArgs] }
}

export function commandText(cwd, invocation, platform = process.platform) {
  const line = [invocation.cmd, ...invocation.args].join(' ')
  return platform === 'win32' ? `cd /d "${cwd}" && ${line}` : `cd ${posixQuote(cwd)} && ${line}`
}

function posixQuote(text) {
  return `'${text.split("'").join("'\\''")}'`
}

function appleScriptQuote(text) {
  return `"${text.split('\\').join('\\\\').split('"').join('\\"')}"`
}

const LINUX_TERMINALS = [
  ['x-terminal-emulator', ['-e']],
  ['gnome-terminal', ['--']],
  ['konsole', ['-e']],
  ['xfce4-terminal', ['-x']],
  ['xterm', ['-e']],
]

function hasCommand(name) {
  return spawnSync('which', [name], { stdio: 'ignore' }).status === 0
}

export function terminalPlan(cwd, invocation, platform = process.platform, exists = hasCommand) {
  const line = [invocation.cmd, ...invocation.args].join(' ')
  if (platform === 'win32') {
    return {
      file: 'cmd.exe',
      args: ['/d', '/c', `start "polyrepo" /D "${cwd}" cmd /k ${line}`],
      options: { windowsVerbatimArguments: true },
    }
  }
  if (platform === 'darwin') {
    const script = `cd ${posixQuote(cwd)} && ${line}`
    return {
      file: 'osascript',
      args: [
        '-e',
        `tell application "Terminal" to do script ${appleScriptQuote(script)}`,
        '-e',
        'tell application "Terminal" to activate',
      ],
      options: {},
    }
  }
  const found = LINUX_TERMINALS.find(([name]) => exists(name))
  if (!found) return null
  const [file, lead] = found
  return {
    file,
    args: [...lead, 'bash', '-c', `cd ${posixQuote(cwd)} && ${line}; exec bash`],
    options: {},
  }
}

export function openTerminal(cwd, invocation, platform = process.platform) {
  const plan = terminalPlan(cwd, invocation, platform)
  if (!plan) return Promise.resolve({ opened: false, reason: 'No terminal program was found.' })
  return new Promise((resolve) => {
    const child = spawn(plan.file, plan.args, {
      ...plan.options,
      detached: true,
      stdio: 'ignore',
      cwd,
    })
    child.once('error', (error) => resolve({ opened: false, reason: error.message }))
    child.once('spawn', () => {
      child.unref()
      resolve({ opened: true })
    })
  })
}
