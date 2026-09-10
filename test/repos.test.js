import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { discoverPackages, readPackageJson } from '../src/repos.js'

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'polyrepo-repos-test-'))
}

function makeRepoRoot(root, dirName) {
  const repoPath = path.join(root, dirName)
  fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true })
  return repoPath
}

function writePkg(dir, data) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(data, null, 2))
}

test('discoverPackages passes a plain (non-workspace) repo through unchanged, same as discoverRepos', () => {
  const root = tmpDir()
  const repoPath = makeRepoRoot(root, 'vue-toast-kit')
  writePkg(repoPath, { name: 'vue-toast-kit', version: '1.0.0' })

  const packages = discoverPackages({ roots: [root], packages: [] })

  assert.equal(packages.length, 1)
  assert.equal(packages[0].dir, 'vue-toast-kit')
  assert.equal(packages[0].path, repoPath)
  assert.equal(packages[0].isWorkspaceMember, false)
})

test('discoverPackages expands a pnpm workspace repo into its members, excluding the private root', () => {
  const root = tmpDir()
  const repoPath = makeRepoRoot(root, 'inview')
  writePkg(repoPath, { name: 'inview', private: true, version: '0.1.0' })
  fs.writeFileSync(path.join(repoPath, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n")
  writePkg(path.join(repoPath, 'packages/core'), { name: '@macrulez/inview-core', version: '0.1.0' })
  writePkg(path.join(repoPath, 'packages/react'), {
    name: '@macrulez/inview-react',
    version: '0.1.0',
    dependencies: { '@macrulez/inview-core': 'workspace:*' },
  })

  const packages = discoverPackages({ roots: [root], packages: [] })

  assert.deepEqual(
    packages.map((p) => p.dir).sort(),
    ['inview/packages/core', 'inview/packages/react'],
  )
  for (const pkg of packages) {
    assert.equal(pkg.isWorkspaceMember, true)
    assert.equal(pkg.repoDir, 'inview')
    assert.equal(pkg.repoPath, repoPath)
  }
})

test('discoverPackages falls back to the repo root when pnpm-workspace.yaml resolves to no members', () => {
  const root = tmpDir()
  const repoPath = makeRepoRoot(root, 'solo')
  writePkg(repoPath, { name: 'solo', version: '2.0.0' })
  fs.writeFileSync(path.join(repoPath, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n")

  const packages = discoverPackages({ roots: [root], packages: [] })

  assert.equal(packages.length, 1)
  assert.equal(packages[0].dir, 'solo')
  assert.equal(packages[0].isWorkspaceMember, false)
})

test('readPackageJson extracts the private flag', () => {
  const dir = tmpDir()
  writePkg(dir, { name: 'a', version: '1.0.0', private: true })
  const pkg = readPackageJson({ pkgPath: path.join(dir, 'package.json'), dir: 'a' })
  assert.equal(pkg.private, true)
})

test('readPackageJson defaults private to false when the field is absent', () => {
  const dir = tmpDir()
  writePkg(dir, { name: 'a', version: '1.0.0' })
  const pkg = readPackageJson({ pkgPath: path.join(dir, 'package.json'), dir: 'a' })
  assert.equal(pkg.private, false)
})
