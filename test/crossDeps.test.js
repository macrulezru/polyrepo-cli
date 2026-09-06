import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { findStaleLocalDeps } from '../src/crossDeps.js'

function makeRepo(name, version, dependencies) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vpc-crossdeps-test-'))
  const pkgPath = path.join(dir, 'package.json')
  fs.writeFileSync(pkgPath, JSON.stringify({ name, version, dependencies }, null, 2))
  return { path: dir, pkgPath, name, version }
}

test('findStaleLocalDeps flags a dependency range that no longer matches', () => {
  const dep = makeRepo('color-value-tools', '1.1.12')
  const dependent = makeRepo('css-magic-gradient', '1.2.14', { 'color-value-tools': '^1.2.0' })

  const issues = findStaleLocalDeps([dep, dependent])

  assert.equal(issues.length, 1)
  assert.equal(issues[0].repo.dir ?? issues[0].repo.name, dependent.name)
  assert.equal(issues[0].depName, 'color-value-tools')
  assert.equal(issues[0].localVersion, '1.1.12')
})

test('findStaleLocalDeps does not flag a range that still matches', () => {
  const dep = makeRepo('color-value-tools', '1.1.12')
  const dependent = makeRepo('css-magic-gradient', '1.2.14', { 'color-value-tools': '^1.1.6' })

  assert.deepEqual(findStaleLocalDeps([dep, dependent]), [])
})

test('findStaleLocalDeps ignores dependencies on packages outside the given set', () => {
  const dependent = makeRepo('a', '1.0.0', { vue: '^3.0.0', 'not-a-local-package': '^1.0.0' })
  assert.deepEqual(findStaleLocalDeps([dependent]), [])
})

test('findStaleLocalDeps ignores non-semver ranges instead of throwing', () => {
  const dep = makeRepo('a', '1.0.0')
  const dependent = makeRepo('b', '1.0.0', { a: 'workspace:*' })
  assert.deepEqual(findStaleLocalDeps([dep, dependent]), [])
})

test('findStaleLocalDeps does not flag a package against its own version field', () => {
  // A package can't meaningfully depend on itself; readPackageDependencies
  // would only ever see this via a name collision, but the repo === repo
  // check should short-circuit before it matters either way.
  const repo = makeRepo('a', '1.0.0', { a: '^2.0.0' })
  assert.deepEqual(findStaleLocalDeps([repo]), [])
})
