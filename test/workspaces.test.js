import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pnpmWorkspaceGlobs, resolveWorkspaceMembers } from '../src/workspaces.js'

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'polyrepo-workspaces-test-'))
}

function writeWorkspaceFile(repoPath, text) {
  fs.writeFileSync(path.join(repoPath, 'pnpm-workspace.yaml'), text)
}

function makePackage(repoPath, relDir, name, version, extra) {
  const dir = path.join(repoPath, relDir)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version, ...extra }, null, 2))
}

test('pnpmWorkspaceGlobs returns null when there is no pnpm-workspace.yaml', () => {
  const repoPath = tmpDir()
  assert.equal(pnpmWorkspaceGlobs(repoPath), null)
})

test('pnpmWorkspaceGlobs parses the block-list form', () => {
  const repoPath = tmpDir()
  writeWorkspaceFile(repoPath, "packages:\n  - 'packages/*'\n  - 'playground'\n")
  assert.deepEqual(pnpmWorkspaceGlobs(repoPath), ['packages/*', 'playground'])
})

test('pnpmWorkspaceGlobs parses the inline-array form', () => {
  const repoPath = tmpDir()
  writeWorkspaceFile(repoPath, "packages: ['packages/*', 'apps/*']\n")
  assert.deepEqual(pnpmWorkspaceGlobs(repoPath), ['packages/*', 'apps/*'])
})

test('pnpmWorkspaceGlobs returns an empty list when the file has no packages key', () => {
  const repoPath = tmpDir()
  writeWorkspaceFile(repoPath, 'catalog:\n  foo: 1.0.0\n')
  assert.deepEqual(pnpmWorkspaceGlobs(repoPath), [])
})

test('pnpmWorkspaceGlobs strips inline comments and quotes', () => {
  const repoPath = tmpDir()
  writeWorkspaceFile(repoPath, "packages:\n  - 'packages/*' # publishable packages\n  - playground\n")
  assert.deepEqual(pnpmWorkspaceGlobs(repoPath), ['packages/*', 'playground'])
})

test('resolveWorkspaceMembers expands a "*" wildcard to real directories with a package.json', () => {
  const repoPath = tmpDir()
  makePackage(repoPath, 'packages/core', '@scope/core', '0.1.0')
  makePackage(repoPath, 'packages/react', '@scope/react', '0.1.0')
  fs.mkdirSync(path.join(repoPath, 'packages/no-package-json'), { recursive: true })

  const members = resolveWorkspaceMembers(repoPath, ['packages/*'])

  assert.deepEqual(
    members.map((m) => m.relDir),
    ['packages/core', 'packages/react'],
  )
})

test('resolveWorkspaceMembers includes a literal (non-wildcard) path', () => {
  const repoPath = tmpDir()
  makePackage(repoPath, 'packages/core', '@scope/core', '0.1.0')
  makePackage(repoPath, 'playground', 'playground', '0.0.0', { private: true })

  const members = resolveWorkspaceMembers(repoPath, ['packages/*', 'playground'])

  assert.deepEqual(
    members.map((m) => m.relDir).sort(),
    ['packages/core', 'playground'],
  )
})

test('resolveWorkspaceMembers applies a "!" negation pattern', () => {
  const repoPath = tmpDir()
  makePackage(repoPath, 'packages/core', '@scope/core', '0.1.0')
  makePackage(repoPath, 'packages/internal-tools', '@scope/internal-tools', '0.1.0')

  const members = resolveWorkspaceMembers(repoPath, ['packages/*', '!packages/internal-tools'])

  assert.deepEqual(
    members.map((m) => m.relDir),
    ['packages/core'],
  )
})

test('resolveWorkspaceMembers returns nothing for an empty or missing glob list', () => {
  const repoPath = tmpDir()
  assert.deepEqual(resolveWorkspaceMembers(repoPath, []), [])
  assert.deepEqual(resolveWorkspaceMembers(repoPath, null), [])
})

test('resolveWorkspaceMembers ignores a matched folder that has no package.json', () => {
  const repoPath = tmpDir()
  fs.mkdirSync(path.join(repoPath, 'packages/docs-only'), { recursive: true })
  fs.writeFileSync(path.join(repoPath, 'packages/docs-only/README.md'), '# docs')

  assert.deepEqual(resolveWorkspaceMembers(repoPath, ['packages/*']), [])
})
