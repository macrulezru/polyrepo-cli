import { spawnSync, spawn } from 'node:child_process'
import pc from 'picocolors'

// Runs a command, always printing what ran and its output so the caller
// never has to wait for a whole queue to finish before seeing progress —
// each command reports itself the moment it's done.
//
// `mutating: true` marks a command that changes remote/shared state (push,
// commit, gh pr create/merge) — under --dry-run those are printed but never
// actually executed, while read-only commands (fetch, checkout, status)
// still run for real so the printed state stays accurate.
//
// `interactive: true` hands the command the real terminal (stdio: 'inherit')
// instead of capturing it — needed for `npm publish`, which can stop and
// wait on a real TTY for a 2FA/OTP code. Capturing its output would make
// that prompt invisible and leave the process hanging forever.
// On Windows, `npm` (and anything else that resolves to a .cmd/.bat shim
// instead of a real .exe) can't be spawned directly — CreateProcess doesn't
// know what to do with a batch file, so spawnSync silently fails to launch
// it at all (`status` comes back null) unless the shell is involved. `git`
// and `gh` are real executables and don't need this, but turning it on
// unconditionally on Windows is the standard fix and is safe here since
// every arg still goes through spawnSync's own array (each element quoted
// for the shell), not a hand-built command string.
const NEEDS_SHELL = process.platform === 'win32'

export function run(cwd, cmd, args, { quiet = false, mutating = false, dryRun = false, interactive = false } = {}) {
  const prefix = mutating && dryRun ? pc.magenta('  [dry-run] $ ') : pc.dim('  $ ')
  if (!quiet) console.log(`${prefix}${cmd} ${args.join(' ')}`)
  if (mutating && dryRun) return { ok: true, stdout: '', stderr: '', status: 0, skipped: true }

  if (interactive) {
    const result = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: NEEDS_SHELL })
    return { ok: result.status === 0, stdout: '', stderr: '', status: result.status }
  }

  const result = spawnSync(cmd, args, { cwd, encoding: 'utf8', shell: NEEDS_SHELL })
  const stdout = (result.stdout || '').trim()
  // If the process couldn't even be spawned (bad cwd, command not found),
  // result.error is set and stdout/stderr never got produced — surface that
  // instead of silently reporting an empty failure.
  const stderr = (result.stderr || '').trim() || (result.error ? result.error.message : '')
  if (!quiet) {
    if (stdout) console.log(indent(stdout))
    if (stderr) console.log(indent(stderr))
  }
  const ok = result.status === 0
  return { ok, stdout, stderr, status: result.status }
}

const ASYNC_TIMEOUT_MS = 30_000

// Async counterpart to `run()`, used only for read-only lookups that get
// fanned out across many repos at once (see pMap.js) — a registry check or
// `git log` for one repo doesn't need to wait for the same call on the
// other sixteen. Always quiet: interleaved "$ git ..." lines from several
// repos at once would be noise, not progress — callers report their own
// summary once the whole batch settles. Never used for mutating commands;
// those stay on the synchronous, one-at-a-time `run()` above so their
// progress prints in the order things actually happen.
//
// Guarded with a hard timeout: under real concurrency (several of these in
// flight at once — that's the whole point of using this over `run()`) a
// spawned process has occasionally been observed to just never emit
// 'close' at all (seen with `git ls-remote` specifically, intermittently,
// only when several ran concurrently — never reproduced running the exact
// same call alone, so this reads as a spawn/network edge case rather than
// anything wrong with the git invocation itself). Without a limit here,
// one wedged child process would hang the whole pMap batch — and every
// command built on it — forever, with the terminal just sitting there
// giving no indication why.
export function runAsync(cwd, cmd, args) {
  return new Promise((resolve) => {
    let settled = false
    const child = spawn(cmd, args, { cwd, shell: NEEDS_SHELL })
    let stdout = ''
    let stderr = ''

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      resolve({ ok: false, stdout: '', stderr: `timed out after ${ASYNC_TIMEOUT_MS / 1000}s`, status: null })
    }, ASYNC_TIMEOUT_MS)

    child.stdout?.on('data', (d) => (stdout += d))
    child.stderr?.on('data', (d) => (stderr += d))
    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok: false, stdout: '', stderr: err.message, status: null })
    })
    child.on('close', (status) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok: status === 0, stdout: stdout.trim(), stderr: stderr.trim(), status })
    })
  })
}

export function gitAsync(cwd, args) {
  return runAsync(cwd, 'git', args)
}

export function ghAsync(cwd, args) {
  return runAsync(cwd, 'gh', args)
}

export function glabAsync(cwd, args) {
  return runAsync(cwd, 'glab', args)
}

export function npmAsync(cwd, args) {
  return runAsync(cwd, 'npm', args)
}

function indent(text) {
  return text
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n')
}

export function git(cwd, args, opts) {
  return run(cwd, 'git', args, opts)
}

export function gh(cwd, args, opts) {
  return run(cwd, 'gh', args, opts)
}

export function glab(cwd, args, opts) {
  return run(cwd, 'glab', args, opts)
}

export function npm(cwd, args, opts) {
  return run(cwd, 'npm', args, opts)
}
