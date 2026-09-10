import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tagName, tagFor } from '../src/tags.js'

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
