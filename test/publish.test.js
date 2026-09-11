import { test } from 'node:test'
import assert from 'node:assert/strict'
import { distTagFor } from '../src/commands/publish.js'

test('distTagFor defaults a stable version to no explicit tag (npm\'s own "latest")', () => {
  assert.equal(distTagFor('1.2.10'), undefined)
})

test('distTagFor defaults a prerelease version to "next"', () => {
  assert.equal(distTagFor('2.0.0-beta.1'), 'next')
  assert.equal(distTagFor('1.2.10-alpha.0'), 'next')
})

test('distTagFor lets an explicit override win, for a stable or prerelease version', () => {
  assert.equal(distTagFor('1.2.10', 'lts'), 'lts')
  assert.equal(distTagFor('2.0.0-beta.1', 'canary'), 'canary')
})
