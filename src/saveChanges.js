import path from 'node:path'
import pc from 'picocolors'
import { git } from './exec.js'
import { providerFor } from './providers/index.js'
import { ok, warn, fail } from './ui.js'
import { line } from './runtime.js'

export const MANIFEST_NAMES = ['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock']

const REJECTED = /protected branch|GH006|GH013|repository rule|rule violations|pre-receive hook declined|\[remote rejected\]|not allowed to push|permission to .* denied|denied to/i

function relativeDir(repo) {
  const rel = path.relative(repo.repoPath ?? repo.path, repo.path).split(path.sep).join('/')
  return rel === '' ? '.' : rel
}

export function currentBranch(repo) {
  const result = git(repo.path, ['rev-parse', '--abbrev-ref', 'HEAD'], { quiet: true })
  return result.ok ? result.stdout : null
}

export function changedFiles(repo, scope = 'manifest') {
  const status = git(repo.path, ['status', '--porcelain', '--untracked-files=no'], { quiet: true })
  if (!status.ok) return []
  const rel = relativeDir(repo)
  return status.stdout
    .split('\n')
    .map((entry) => /^\s*[MADRCU?!]{1,2}\s+(.+?)\s*$/.exec(entry)?.[1])
    .filter((file) => file !== undefined)
    .map((file) => file.replace(/^"|"$/g, ''))
    .filter((file) => {
      const dir = path.posix.dirname(file)
      const inside = rel === '.' || dir === rel || dir.startsWith(`${rel}/`)
      if (scope === 'all') return inside
      return MANIFEST_NAMES.includes(path.posix.basename(file)) && (dir === (rel === '.' ? '.' : rel) || dir === '.')
    })
}

export function slugify(text) {
  return text
    .replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
}

export function suggestBranchName(message, now = new Date()) {
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, '')
  const slug = slugify(message) || 'changes'
  return `chore/${slug}-${stamp}`
}

export async function planSave(repo, config, { scope = 'manifest', message = '', mode = 'auto', branchName } = {}, deps = {}) {
  const provider = deps.provider === undefined ? providerFor(repo, config) : deps.provider
  const current = currentBranch(repo)
  const defaultBranch = repo.defaultBranch ?? null
  const onDefault = current !== null && current === defaultBranch
  const files = changedFiles(repo, scope)

  let policy = null
  if (onDefault && provider?.getPushPolicyAsync) {
    policy = await provider.getPushPolicyAsync(repo, defaultBranch)
  } else if (onDefault) {
    policy = { level: 'unknown', reasons: ['the git host could not be determined'], protected: null }
  }

  let resolved = 'current'
  if (onDefault) {
    if (mode === 'direct' || mode === 'branch') resolved = mode
    else resolved = policy?.level === 'open' ? 'direct' : 'branch'
  }

  return {
    dir: repo.dir,
    current,
    defaultBranch,
    onDefault,
    files,
    policy,
    mode: resolved,
    recommended: onDefault ? (policy?.level === 'open' ? 'direct' : 'branch') : 'current',
    branchName: branchName ?? suggestBranchName(message || 'update dependencies'),
    provider: provider?.name ?? null,
    requestLabel: provider?.requestLabel ?? 'PR',
  }
}

function commitFiles(repo, files, message, dryRun) {
  if (!git(repo.path, ['add', '--', ...files], { mutating: true, dryRun }).ok) {
    fail('git add failed.')
    return false
  }
  if (!git(repo.path, ['commit', '-m', message, '--', ...files], { mutating: true, dryRun }).ok) {
    fail('git commit failed.')
    return false
  }
  ok(`Committed ${files.join(', ')}: ${message}`)
  return true
}

function openRequest(repo, provider, { base, branch, message, dryRun }) {
  if (!provider) {
    warn(`Branch ${branch} is pushed, but the git host is unknown — open the pull request yourself.`)
    return {}
  }
  const result = provider.createPr(repo, {
    base,
    branch,
    title: message,
    body: `${message}\n\nOpened by polyrepo.`,
    dryRun,
  })
  if (!result.ok) {
    warn(`Branch ${branch} is pushed, but the ${provider.requestLabel} could not be opened${result.message ? `: ${result.message}` : ''}. Open it yourself from the host.`)
    return {}
  }
  ok(`Opened ${provider.requestLabel} #${result.number}${result.url ? `: ${result.url}` : ''}`)
  if (result.url) line(pc.cyan(`  ${result.url}`))
  return { number: result.number, url: result.url }
}

function moveToBranch(repo, provider, { base, branch, message, push, openPr, dryRun, stay }) {
  if (push) {
    if (!git(repo.path, ['push', '-u', 'origin', branch], { mutating: true, dryRun }).ok) {
      fail(`Could not push ${branch}. The commit is safe on that local branch.`)
      return { ok: false, branch }
    }
    ok(`Pushed ${branch} to origin.`)
  }
  const request = push && openPr ? openRequest(repo, provider, { base, branch, message, dryRun }) : {}
  if (!stay && currentBranch(repo) !== base) {
    if (git(repo.path, ['checkout', base], { mutating: true, dryRun }).ok) ok(`Back on ${base}.`)
  }
  return { ok: true, branch, ...request }
}

export async function saveChanges(repo, config, options, deps = {}) {
  const {
    message,
    scope = 'manifest',
    mode = 'auto',
    push = true,
    openPr = true,
    branchName,
    dryRun = false,
    stay = false,
  } = options
  const provider = deps.provider === undefined ? providerFor(repo, config) : deps.provider
  if (!message || message.trim() === '') {
    fail('Write a commit message.')
    return { ok: false }
  }

  const plan = await planSave(repo, config, { scope, message, mode, branchName }, { provider })
  if (plan.files.length === 0) {
    fail(
      scope === 'manifest'
        ? 'Nothing to commit: package.json and the lock files have no changes. Use the "all changes" scope to include other files.'
        : 'Nothing to commit: there are no changes to tracked files.',
    )
    return { ok: false }
  }

  if (!plan.onDefault) {
    ok(`On ${plan.current ?? 'a detached HEAD'}, not on ${plan.defaultBranch}: committing here.`)
    if (!commitFiles(repo, plan.files, message, dryRun)) return { ok: false }
    if (push && plan.current) {
      if (!git(repo.path, ['push', '-u', 'origin', plan.current], { mutating: true, dryRun }).ok) {
        fail(`git push failed. The commit is on ${plan.current}; push it yourself when ready.`)
        return { ok: false, mode: 'current' }
      }
      ok(`Pushed ${plan.current} to origin.`)
    }
    return { ok: true, mode: 'current', branch: plan.current }
  }

  if (plan.policy) {
    const why = plan.policy.reasons.length > 0 ? ` (${plan.policy.reasons.join('; ')})` : ''
    if (plan.policy.level === 'pr-required') ok(`${plan.defaultBranch} does not take direct commits${why}.`)
    else if (plan.policy.level === 'unknown' && mode === 'auto') {
      warn(`Could not tell whether ${plan.defaultBranch} takes direct commits${why}.`)
    } else if (plan.policy.level === 'unknown') {
      line(pc.dim(`  Could not tell whether ${plan.defaultBranch} takes direct commits${why}.`))
    } else ok(`${plan.defaultBranch} takes direct commits.`)
  }

  if (plan.mode === 'branch') {
    ok(`Using a new branch ${plan.branchName} and a ${plan.requestLabel}.`)
    if (!git(repo.path, ['checkout', '-b', plan.branchName], { mutating: true, dryRun }).ok) {
      fail(`Could not create branch ${plan.branchName}.`)
      return { ok: false }
    }
    if (!commitFiles(repo, plan.files, message, dryRun)) return { ok: false }
    const moved = moveToBranch(repo, provider, {
      base: plan.defaultBranch,
      branch: plan.branchName,
      message,
      push,
      openPr,
      dryRun,
      stay,
    })
    return { ...moved, mode: 'branch' }
  }

  if (!commitFiles(repo, plan.files, message, dryRun)) return { ok: false }
  if (!push) return { ok: true, mode: 'direct', branch: plan.defaultBranch }

  const pushed = git(repo.path, ['push', 'origin', plan.defaultBranch], { mutating: true, dryRun })
  if (pushed.ok) {
    ok(`Pushed to ${plan.defaultBranch}.`)
    return { ok: true, mode: 'direct', branch: plan.defaultBranch }
  }

  if (!REJECTED.test(`${pushed.stderr} ${pushed.stdout}`)) {
    fail(`git push failed. The commit is on local ${plan.defaultBranch}; fix the problem and push it yourself.`)
    return { ok: false, mode: 'direct' }
  }

  warn(`${plan.defaultBranch} refused the push. Moving the commit to a branch instead.`)
  const ahead = git(repo.path, ['rev-list', '--count', `origin/${plan.defaultBranch}..HEAD`], { quiet: true })
  if (!ahead.ok || ahead.stdout !== '1') {
    fail(`${plan.defaultBranch} has more local commits than this one, so nothing was moved. Create a branch and ${plan.requestLabel} yourself.`)
    return { ok: false, mode: 'direct' }
  }
  if (!git(repo.path, ['branch', plan.branchName, 'HEAD'], { mutating: true, dryRun }).ok) {
    fail(`Could not create branch ${plan.branchName}.`)
    return { ok: false, mode: 'direct' }
  }
  if (!git(repo.path, ['reset', '--hard', 'HEAD~1'], { mutating: true, dryRun }).ok) {
    fail(`Could not move ${plan.defaultBranch} back. The commit is safe on ${plan.branchName}.`)
    return { ok: false, mode: 'direct' }
  }
  ok(`${plan.defaultBranch} is back at origin; the commit lives on ${plan.branchName}.`)
  const moved = moveToBranch(repo, provider, {
    base: plan.defaultBranch,
    branch: plan.branchName,
    message,
    push: true,
    openPr,
    dryRun,
    stay: true,
  })
  return { ...moved, mode: 'branch' }
}
