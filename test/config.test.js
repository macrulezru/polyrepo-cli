import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bumpBranchName, isBumpBranchName } from '../src/config.js'

test('isBumpBranchName recognizes what bumpBranchName produces', () => {
  assert.equal(isBumpBranchName(bumpBranchName('1.2.10')), true)
  assert.equal(isBumpBranchName(bumpBranchName('0.0.1')), true)
  assert.equal(isBumpBranchName(bumpBranchName('10.20.30')), true)
})

test('isBumpBranchName recognizes a pre-release/build suffix', () => {
  assert.equal(isBumpBranchName('1.2.10-beta.1-version-bump'), true)
  assert.equal(isBumpBranchName('1.2.10+build.5-version-bump'), true)
})

test('isBumpBranchName rejects unrelated branch names', () => {
  assert.equal(isBumpBranchName('main'), false)
  assert.equal(isBumpBranchName('feature/add-thing'), false)
  assert.equal(isBumpBranchName('1.2.10-version-bump-extra'), false)
  assert.equal(isBumpBranchName('version-bump'), false)
  assert.equal(isBumpBranchName('v1.2.10-version-bump'), false)
})
