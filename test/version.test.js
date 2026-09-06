import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bumpPatch, replaceVersionInText } from '../src/version.js'

test('bumpPatch increments the patch number', () => {
  assert.equal(bumpPatch('1.2.9'), '1.2.10')
  assert.equal(bumpPatch('0.0.0'), '0.0.1')
  assert.equal(bumpPatch('10.20.9'), '10.20.10')
})

test('bumpPatch preserves a pre-release/build suffix', () => {
  assert.equal(bumpPatch('0.2.7-beta.1'), '0.2.8-beta.1')
  assert.equal(bumpPatch('1.0.0+build.5'), '1.0.1+build.5')
})

test('bumpPatch rejects a version it cannot parse', () => {
  assert.throws(() => bumpPatch('not-a-version'), /Cannot parse version/)
  assert.throws(() => bumpPatch('1.2'), /Cannot parse version/)
})

test('replaceVersionInText replaces only the first "version" field', () => {
  const text = [
    '{',
    '  "name": "x",',
    '  "version": "1.2.9",',
    '  "nested": { "version": "9.9.9" }',
    '}',
    '',
  ].join('\n')

  const updated = replaceVersionInText(text, '1.2.10')

  assert.match(updated, /"version": "1\.2\.10"/)
  // The nested, unrelated "version" field must survive untouched.
  assert.match(updated, /"version": "9\.9\.9"/)
  // Nothing else about the file's formatting should move.
  assert.equal(updated.split('\n').length, text.split('\n').length)
})

test('replaceVersionInText throws when there is no "version" field at all', () => {
  assert.throws(() => replaceVersionInText('{ "name": "x" }', '1.0.0'), /No "version" field/)
})
