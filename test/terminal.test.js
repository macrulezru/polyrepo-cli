import test from 'node:test'
import assert from 'node:assert/strict'
import { commandText, publishInvocation, terminalPlan } from '../src/ui/terminal.js'

test('a prerelease-style tag is passed through, a bad one is refused', () => {
  const invocation = publishInvocation({ isWorkspaceMember: false }, 'next')
  assert.deepEqual(invocation, { cmd: 'npm', args: ['publish', '--tag', 'next'] })
  assert.throws(
    () => publishInvocation({ isWorkspaceMember: false }, 'x; rm -rf /'),
    /not a valid dist-tag/,
  )
})

test('a pnpm workspace member publishes through pnpm', () => {
  assert.deepEqual(publishInvocation({ isWorkspaceMember: true }), {
    cmd: 'pnpm',
    args: ['publish', '--no-git-checks'],
  })
})

test('the command text goes to the package folder first', () => {
  const invocation = { cmd: 'npm', args: ['publish'] }
  assert.equal(
    commandText('C:\work\a b', invocation, 'win32'),
    'cd /d "C:\work\a b" && npm publish',
  )
  assert.equal(
    commandText("/work/it's", invocation, 'linux'),
    "cd '/work/it'" + String.fromCharCode(92) + "''s' && npm publish",
  )
})

test('each platform opens its own terminal, and none is a clean refusal', () => {
  const invocation = { cmd: 'npm', args: ['publish', '--tag', 'next'] }
  const win = terminalPlan('C:\work\pkg', invocation, 'win32')
  assert.equal(win.file, 'cmd.exe')
  assert.match(win.args[2], /^start "polyrepo" \/D "C:\work\pkg" cmd \/k npm publish --tag next$/)
  assert.equal(win.options.windowsVerbatimArguments, true)

  const mac = terminalPlan('/work/pkg', invocation, 'darwin')
  assert.equal(mac.file, 'osascript')
  assert.match(mac.args[1], /do script "cd '\/work\/pkg' && npm publish --tag next"/)

  const linux = terminalPlan('/work/pkg', invocation, 'linux', (name) => name === 'konsole')
  assert.equal(linux.file, 'konsole')
  assert.deepEqual(linux.args.slice(0, 3), ['-e', 'bash', '-c'])
  assert.equal(
    terminalPlan('/work/pkg', invocation, 'linux', () => false),
    null,
  )
})
