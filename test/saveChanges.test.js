import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { changedFiles, planSave, saveChanges, slugify, suggestBranchName } from '../src/saveChanges.js'
import { createRuntime, runWithRuntime } from '../src/runtime.js'

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

function setup({ rejectMaster = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'polyrepo-save-test-'))
  const origin = path.join(root, 'origin.git')
  const work = path.join(root, 'work')
  git(root, 'init', '-q', '--bare', '-b', 'master', origin)
  git(root, 'clone', '-q', origin, work)
  git(work, 'config', 'user.email', 'test@example.com')
  git(work, 'config', 'user.name', 'Test')
  git(work, 'checkout', '-q', '-b', 'master')
  fs.writeFileSync(path.join(work, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }, null, 2))
  fs.writeFileSync(path.join(work, 'notes.txt'), 'notes')
  git(work, 'add', '.')
  git(work, 'commit', '-q', '-m', 'init')
  git(work, 'push', '-q', '-u', 'origin', 'master')
  if (rejectMaster) {
    const hook = path.join(origin, 'hooks', 'pre-receive')
    fs.writeFileSync(
      hook,
      '#!/bin/sh\nwhile read old new ref; do\n  if [ "$ref" = "refs/heads/master" ]; then\n    echo "protected branch hook declined" >&2\n    exit 1\n  fi\ndone\n',
    )
    fs.chmodSync(hook, 0o755)
  }
  fs.writeFileSync(
    path.join(work, 'package.json'),
    JSON.stringify({ name: 'demo', version: '1.0.0', devDependencies: { left: '^1.0.0' } }, null, 2),
  )
  const repo = { dir: 'demo', path: work, repoPath: work, defaultBranch: 'master' }
  return { root, origin, work, repo }
}

function fakeProvider(level, calls = []) {
  return {
    name: 'github',
    requestLabel: 'PR',
    getPushPolicyAsync: async () => ({ level, reasons: level === 'open' ? [] : ['a pull request is required'], protected: level !== 'open' }),
    createPr: (repo, args) => {
      calls.push(args)
      return { ok: true, number: '7', url: 'https://example.com/pull/7' }
    },
  }
}

const quiet = () => createRuntime({ reporter: { ...Object.fromEntries(['blank', 'line', 'heading', 'step', 'ok', 'fail', 'warn', 'command', 'output', 'table'].map((name) => [name, () => undefined])), progress: () => ({ stop() {} }) } })

function save(repo, options, provider) {
  return runWithRuntime(quiet(), () => saveChanges(repo, {}, options, { provider }))
}

test('slug and branch name are built from the message', () => {
  assert.equal(slugify('chore: npm audit fix'), 'npm-audit-fix')
  assert.equal(suggestBranchName('chore: npm audit fix', new Date('2026-10-08T10:00:00Z')), 'chore/npm-audit-fix-20261008')
})

test('only the manifest and lock files count by default', () => {
  const { repo, work } = setup()
  fs.writeFileSync(path.join(work, 'notes.txt'), 'changed')
  assert.deepEqual(changedFiles(repo), ['package.json'])
  assert.deepEqual(changedFiles(repo, 'all').sort(), ['notes.txt', 'package.json'])
})

test('the plan prefers a branch and a pull request when the default branch refuses direct commits', async () => {
  const { repo } = setup()
  const plan = await planSave(repo, {}, { message: 'chore: update deps' }, { provider: fakeProvider('pr-required') })
  assert.equal(plan.onDefault, true)
  assert.equal(plan.mode, 'branch')
  assert.equal(plan.recommended, 'branch')
  assert.deepEqual(plan.files, ['package.json'])
})

test('the plan commits directly when the default branch allows it, and does not decide when it cannot tell', async () => {
  const { repo } = setup()
  assert.equal((await planSave(repo, {}, {}, { provider: fakeProvider('open') })).mode, 'direct')
  assert.equal((await planSave(repo, {}, {}, { provider: fakeProvider('unknown') })).mode, 'branch')
})

test('a commit on a feature branch stays on that branch', async () => {
  const { repo, work } = setup()
  git(work, 'checkout', '-q', '-b', 'feature/x')
  const result = await save(repo, { message: 'chore: x', push: false }, fakeProvider('pr-required'))
  assert.equal(result.ok, true)
  assert.equal(result.mode, 'current')
  assert.equal(git(work, 'log', '-1', '--format=%s'), 'chore: x')
  assert.equal(git(work, 'rev-parse', '--abbrev-ref', 'HEAD'), 'feature/x')
})

test('when direct commits are allowed the commit lands on the default branch and is pushed', async () => {
  const { repo, work, origin } = setup()
  const result = await save(repo, { message: 'chore: update dependencies' }, fakeProvider('open'))
  assert.equal(result.ok, true)
  assert.equal(result.mode, 'direct')
  assert.equal(git(origin, 'log', '-1', '--format=%s', 'master'), 'chore: update dependencies')
  assert.equal(git(work, 'status', '--porcelain'), '')
})

test('when direct commits are refused a branch is pushed, a pull request is opened and the default branch is untouched', async () => {
  const { repo, work, origin } = setup()
  const calls = []
  const result = await save(repo, { message: 'chore: update dependencies' }, fakeProvider('pr-required', calls))
  assert.equal(result.ok, true)
  assert.equal(result.mode, 'branch')
  assert.match(result.branch, /^chore\/update-dependencies-\d{8}$/)
  assert.equal(result.url, 'https://example.com/pull/7')
  assert.equal(calls[0].base, 'master')
  assert.equal(calls[0].branch, result.branch)
  assert.equal(git(origin, 'log', '-1', '--format=%s', result.branch), 'chore: update dependencies')
  assert.equal(git(origin, 'log', '-1', '--format=%s', 'master'), 'init')
  assert.equal(git(work, 'rev-parse', '--abbrev-ref', 'HEAD'), 'master')
  assert.equal(git(work, 'log', '-1', '--format=%s'), 'init')
})

test('a push that the host rejects moves the commit to a branch and restores the default branch', async () => {
  const { repo, work, origin } = setup({ rejectMaster: true })
  const calls = []
  const result = await save(repo, { message: 'chore: update dependencies', mode: 'direct' }, fakeProvider('open', calls))
  assert.equal(result.ok, true)
  assert.equal(result.mode, 'branch')
  assert.equal(git(work, 'log', '-1', '--format=%s', 'master'), 'init')
  assert.equal(git(origin, 'log', '-1', '--format=%s', result.branch), 'chore: update dependencies')
  assert.equal(calls.length, 1)
})

test('without a message or without changes nothing is committed', async () => {
  const { repo, work } = setup()
  assert.equal((await save(repo, { message: '  ' }, fakeProvider('open'))).ok, false)
  git(work, 'checkout', '--', 'package.json')
  assert.equal((await save(repo, { message: 'chore: x' }, fakeProvider('open'))).ok, false)
})

test('a dry run commits and pushes nothing', async () => {
  const { repo, work, origin } = setup()
  const result = await save(repo, { message: 'chore: x', dryRun: true }, fakeProvider('pr-required'))
  assert.equal(result.ok, true)
  assert.equal(git(work, 'log', '-1', '--format=%s'), 'init')
  assert.equal(git(origin, 'branch', '--list').includes('chore/'), false)
})
