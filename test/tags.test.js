import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { tagName, tagFor, createAndPushTag } from '../src/tags.js'

test('tagName defaults to the plain v<version> form', () => {
  assert.equal(tagName('1.2.10'), 'v1.2.10')
})

test('tagName scopes to name@version when given a scopedName', () => {
  assert.equal(tagName('0.1.1', { scopedName: '@macrulez/inview-core' }), '@macrulez/inview-core@0.1.1')
})

test('tagFor uses the plain v<version> form for a standalone package', () => {
  assert.equal(tagFor({ isWorkspaceMember: false, name: 'vue-toast-kit', version: '1.2.10' }), 'v1.2.10')
})

test('tagFor scopes the tag for a pnpm workspace member', () => {
  assert.equal(
    tagFor({ isWorkspaceMember: true, name: '@macrulez/inview-core', version: '0.1.1' }),
    '@macrulez/inview-core@0.1.1',
  )
})

test('tagFor accepts an explicit version override (bump.js names the tag before it exists)', () => {
  assert.equal(
    tagFor({ isWorkspaceMember: true, name: '@macrulez/inview-core', version: '0.1.0' }, '0.2.0'),
    '@macrulez/inview-core@0.2.0',
  )
  assert.equal(tagFor({ isWorkspaceMember: false, name: 'vue-toast-kit', version: '1.2.9' }, '1.3.0'), 'v1.3.0')
})

// createAndPushTag shells out to real git, so these use a real bare "origin"
// repo plus a real working clone instead of mocking — the bug this guards
// against (see tags.js's own comment on localTagExists) only reproduces
// against real git's actual "tag already exists locally" failure mode.
function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'polyrepo-tags-test-'))
}

function sh(cwd, args) {
  execFileSync('git', args, { cwd, stdio: 'pipe' })
}

function makeRepoWithOrigin() {
  const root = tmpDir()
  const originPath = path.join(root, 'origin.git')
  const workPath = path.join(root, 'work')

  fs.mkdirSync(originPath, { recursive: true })
  sh(originPath, ['init', '--bare', '-b', 'main'])

  fs.mkdirSync(workPath, { recursive: true })
  sh(workPath, ['init', '-b', 'main'])
  sh(workPath, ['config', 'user.email', 'test@example.com'])
  sh(workPath, ['config', 'user.name', 'Test'])
  fs.writeFileSync(path.join(workPath, 'file.txt'), 'x')
  sh(workPath, ['add', '.'])
  sh(workPath, ['commit', '-m', 'init'])
  sh(workPath, ['remote', 'add', 'origin', originPath])
  sh(workPath, ['push', 'origin', 'main'])

  return { path: workPath }
}

function remoteHasTag(repoPath, tag) {
  const out = execFileSync('git', ['ls-remote', '--tags', 'origin', tag], { cwd: repoPath, encoding: 'utf8' })
  return out.includes(tag)
}

test('createAndPushTag creates and pushes a tag that does not exist yet', () => {
  const repo = makeRepoWithOrigin()

  const result = createAndPushTag(repo, 'v1.0.0')

  assert.equal(result.ok, true)
  assert.equal(remoteHasTag(repo.path, 'v1.0.0'), true)
})

test('createAndPushTag recovers when the tag exists locally but was never pushed (an interrupted previous run)', () => {
  const repo = makeRepoWithOrigin()
  // Simulate a previous `polyrepo tag` run whose `git tag -a` succeeded but
  // whose `git push origin <tag>` never happened (network blip, killed
  // mid-run, etc.) — origin doesn't have it, so tagExists/tagExistsAsync
  // (which only check origin) would report "not tagged yet" and this would
  // be retried from scratch.
  sh(repo.path, ['tag', '-a', 'v1.0.0', '-m', 'v1.0.0'])
  assert.equal(remoteHasTag(repo.path, 'v1.0.0'), false)

  const result = createAndPushTag(repo, 'v1.0.0')

  assert.equal(result.ok, true, result.message)
  assert.equal(remoteHasTag(repo.path, 'v1.0.0'), true)
})
