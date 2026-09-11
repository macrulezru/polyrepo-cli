import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { updatedRange, applyRangeUpdate } from '../src/depRanges.js'

test('updatedRange preserves a caret range', () => {
  assert.equal(updatedRange('^1.1.0', '1.2.0'), '^1.2.0')
})

test('updatedRange preserves a tilde range', () => {
  assert.equal(updatedRange('~1.1.0', '1.2.0'), '~1.2.0')
})

test('updatedRange keeps an exact pin exact', () => {
  assert.equal(updatedRange('1.1.0', '1.2.0'), '1.2.0')
})

test('updatedRange falls back to a caret range for anything else', () => {
  assert.equal(updatedRange('>=1.1.0 <2.0.0', '1.2.0'), '^1.2.0')
  assert.equal(updatedRange('*', '1.2.0'), '^1.2.0')
  assert.equal(updatedRange('1.x', '1.2.0'), '^1.2.0')
})

function writePkg(dir, data) {
  fs.mkdirSync(dir, { recursive: true })
  const pkgPath = path.join(dir, 'package.json')
  fs.writeFileSync(pkgPath, JSON.stringify(data, null, 2) + '\n')
  return pkgPath
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'polyrepo-depranges-test-'))
}

test('applyRangeUpdate rewrites the exact dependency line, leaving the rest untouched', () => {
  const pkgPath = writePkg(tmpDir(), {
    name: 'css-magic-gradient',
    version: '1.2.14',
    dependencies: { 'color-value-tools': '^1.1.0', vue: '^3.0.0' },
  })

  const result = applyRangeUpdate(pkgPath, 'color-value-tools', '^1.1.0', '^1.2.0')

  assert.equal(result.ok, true)
  const updated = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  assert.equal(updated.dependencies['color-value-tools'], '^1.2.0')
  assert.equal(updated.dependencies.vue, '^3.0.0')
})

test('applyRangeUpdate fails cleanly when the old range is no longer there', () => {
  const pkgPath = writePkg(tmpDir(), {
    name: 'a',
    version: '1.0.0',
    dependencies: { b: '^2.0.0' },
  })

  const result = applyRangeUpdate(pkgPath, 'b', '^1.0.0', '^2.0.0')

  assert.equal(result.ok, false)
  assert.match(result.message, /Could not find/)
})
