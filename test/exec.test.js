import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchPlan, run } from '../src/exec.js'

test('real executables are launched directly on Windows so arguments with spaces stay whole', () => {
  assert.deepEqual(launchPlan('git', ['commit', '-m', 'chore: a b'], 'win32'), {
    file: 'git',
    args: ['commit', '-m', 'chore: a b'],
    shell: false,
  })
})

test('a command that needs the shell on Windows gets every argument quoted', () => {
  const plan = launchPlan('npm', ['install', 'plain@1.0.0', 'with space', 'say "hi"', ''], 'win32')
  assert.equal(plan.shell, true)
  assert.deepEqual(plan.args, [])
  assert.equal(plan.file, 'npm install plain@1.0.0 "with space" "say \\"hi\\"" ""')
})

test('nothing changes off Windows', () => {
  assert.deepEqual(launchPlan('npm', ['test'], 'linux'), { file: 'npm', args: ['test'], shell: false })
})

test('a commit message with spaces reaches git as one argument', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polyrepo-exec-test-'))
  const git = (...args) => run(dir, 'git', args, { quiet: true })
  git('init', '-q', '-b', 'master')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x')
  git('add', '.')
  const commit = git('commit', '-m', 'chore: several words in one message')
  assert.equal(commit.ok, true, commit.stderr)
  assert.equal(git('log', '-1', '--format=%s').stdout, 'chore: several words in one message')
})
