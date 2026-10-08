import { test } from 'node:test'
import assert from 'node:assert/strict'
import { githubPushPolicy, gitlabPushPolicy } from '../src/providers/pushPolicy.js'

function fake(table) {
  return async (args) => {
    const key = args.join(' ')
    for (const [needle, reply] of Object.entries(table)) {
      if (key.includes(needle)) return { ok: reply.ok ?? true, stdout: reply.stdout ?? '', stderr: reply.stderr ?? '' }
    }
    return { ok: false, stdout: '', stderr: 'HTTP 404' }
  }
}

test('github: a repository rule that requires a pull request means direct pushes will be refused', async () => {
  const policy = await githubPushPolicy(
    'master',
    fake({ 'rules/branches': { stdout: JSON.stringify([{ type: 'deletion' }, { type: 'pull_request' }]) } }),
  )
  assert.equal(policy.level, 'pr-required')
  assert.match(policy.reasons[0], /pull request is required/)
})

test('github: classic branch protection with required reviews also requires a pull request', async () => {
  const policy = await githubPushPolicy(
    'master',
    fake({
      'rules/branches': { stdout: '[]' },
      '/protection': { stdout: JSON.stringify({ required_pull_request_reviews: { required_approving_review_count: 1 } }) },
    }),
  )
  assert.equal(policy.level, 'pr-required')
})

test('github: a protected branch whose rules cannot be read is treated as unknown, never as open', async () => {
  const policy = await githubPushPolicy(
    'master',
    fake({
      'rules/branches': { stdout: '[]' },
      '/protection': { ok: false, stderr: 'HTTP 403' },
      '.protected': { stdout: 'true' },
    }),
  )
  assert.equal(policy.level, 'unknown')
})

test('github: no rules and no protection means direct pushes are fine', async () => {
  const policy = await githubPushPolicy(
    'master',
    fake({ 'rules/branches': { stdout: '[]' }, '.protected': { stdout: 'false' } }),
  )
  assert.equal(policy.level, 'open')
})

test('github: when nothing can be read the answer is unknown', async () => {
  const policy = await githubPushPolicy('master', fake({}))
  assert.equal(policy.level, 'unknown')
})

test('gitlab: a branch that is not protected can be pushed to', async () => {
  const policy = await gitlabPushPolicy('master', fake({ 'protected_branches': { ok: false, stderr: '404 Not found' } }))
  assert.equal(policy.level, 'open')
})

test('gitlab: when only maintainers may push, a developer needs a merge request', async () => {
  const policy = await gitlabPushPolicy(
    'master',
    fake({
      protected_branches: { stdout: JSON.stringify({ push_access_levels: [{ access_level: 40 }] }) },
      'projects/:fullpath': { stdout: JSON.stringify({ permissions: { project_access: { access_level: 30 } } }) },
    }),
  )
  assert.equal(policy.level, 'pr-required')
  assert.match(policy.reasons[0], /Maintainers/)
})

test('gitlab: a maintainer may push to a branch protected for maintainers', async () => {
  const policy = await gitlabPushPolicy(
    'master',
    fake({
      protected_branches: { stdout: JSON.stringify({ push_access_levels: [{ access_level: 40 }] }) },
      'projects/:fullpath': { stdout: JSON.stringify({ permissions: { project_access: { access_level: 40 } } }) },
    }),
  )
  assert.equal(policy.level, 'open')
})

test('gitlab: nobody may push means a merge request', async () => {
  const policy = await gitlabPushPolicy(
    'master',
    fake({ protected_branches: { stdout: JSON.stringify({ push_access_levels: [{ access_level: 0 }] }) } }),
  )
  assert.equal(policy.level, 'pr-required')
})
