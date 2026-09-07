import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRemoteHost, providerNameForUrl } from '../src/providers/detect.js'

test('parseRemoteHost reads the host out of an https:// remote URL', () => {
  assert.equal(parseRemoteHost('https://github.com/owner/repo.git'), 'github.com')
  assert.equal(parseRemoteHost('https://gitlab.company.com/group/sub/repo.git'), 'gitlab.company.com')
  assert.equal(parseRemoteHost('https://gitlab.com/owner/repo'), 'gitlab.com')
})

test('parseRemoteHost reads the host out of an authenticated https:// remote URL', () => {
  assert.equal(parseRemoteHost('https://oauth2:token@gitlab.company.com/owner/repo.git'), 'gitlab.company.com')
})

test('parseRemoteHost reads the host out of an SSH shorthand remote URL', () => {
  assert.equal(parseRemoteHost('git@github.com:owner/repo.git'), 'github.com')
  assert.equal(parseRemoteHost('git@gitlab.company.com:group/sub/repo.git'), 'gitlab.company.com')
})

test('parseRemoteHost lowercases the host', () => {
  assert.equal(parseRemoteHost('https://GitHub.com/owner/repo.git'), 'github.com')
})

test('parseRemoteHost returns null for empty or unparseable input', () => {
  assert.equal(parseRemoteHost(''), null)
  assert.equal(parseRemoteHost(null), null)
  assert.equal(parseRemoteHost('not a url'), null)
})

test('providerNameForUrl recognizes gitlab.com automatically', () => {
  assert.equal(providerNameForUrl('https://gitlab.com/owner/repo.git'), 'gitlab')
  assert.equal(providerNameForUrl('git@gitlab.com:owner/repo.git'), 'gitlab')
})

test('providerNameForUrl recognizes a self-hosted GitLab host only when listed', () => {
  const url = 'https://gitlab.company.com/group/repo.git'
  assert.equal(providerNameForUrl(url), 'github') // not listed — defaults to github
  assert.equal(providerNameForUrl(url, { gitlabHosts: ['gitlab.company.com'] }), 'gitlab')
})

test('providerNameForUrl defaults an unrecognized host to github', () => {
  assert.equal(providerNameForUrl('https://github.com/owner/repo.git'), 'github')
  assert.equal(providerNameForUrl('https://some-other-git-server.internal/owner/repo.git'), 'github')
})

test('providerNameForUrl returns null when there is no URL to parse', () => {
  assert.equal(providerNameForUrl(''), null)
  assert.equal(providerNameForUrl(null), null)
})
