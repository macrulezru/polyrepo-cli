import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bumpBranchName, isBumpBranchName, sanitizeBranchSegment, branchFor } from '../src/config.js'

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

test('sanitizeBranchSegment flattens a scoped package name into one plain segment', () => {
  assert.equal(sanitizeBranchSegment('@macrulez/inview-core'), 'macrulez-inview-core')
  assert.equal(sanitizeBranchSegment('vue-toast-kit'), 'vue-toast-kit')
})

test('bumpBranchName with scopedName produces a name-prefixed branch', () => {
  assert.equal(bumpBranchName('0.1.1', { scopedName: 'macrulez-inview-core' }), 'macrulez-inview-core-0.1.1-version-bump')
})

test('branchFor scopes the branch for a workspace member but not for a standalone package', () => {
  assert.equal(
    branchFor({ isWorkspaceMember: true, name: '@macrulez/inview-core' }, '0.1.1'),
    'macrulez-inview-core-0.1.1-version-bump',
  )
  assert.equal(branchFor({ isWorkspaceMember: false, name: 'vue-toast-kit' }, '1.2.10'), '1.2.10-version-bump')
})

test('isBumpBranchName recognizes the scoped form branchFor produces', () => {
  assert.equal(isBumpBranchName(branchFor({ isWorkspaceMember: true, name: '@macrulez/inview-core' }, '0.1.1')), true)
  assert.equal(isBumpBranchName(branchFor({ isWorkspaceMember: true, name: '@macrulez/inview-react' }, '2.0.0-beta.1')), true)
})
