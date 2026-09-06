import { git, gitAsync } from './exec.js'
import { pMap } from './pMap.js'

const PREVIEW_LIMIT = 5

// Summarizes what changed on the local default branch since the last `v*`
// tag (or the last few commits if there's no tag yet), so the bump
// checklist can show whether a package actually has anything worth
// releasing. Reflects local repo state — run `polyrepo switch-master`
// first if it might be stale. Run through pMap across many repos at once
// (see describeRecentChangesForAll) — this builds the bump checkbox's
// preview, and waiting on 3 sequential git calls per repo, 17 times over,
// added up to a real pause before the prompt even appeared.
async function describeRecentChangesAsync(repo) {
  const branch = repo.defaultBranch
  const tagResult = await gitAsync(repo.path, ['describe', '--tags', '--abbrev=0', '--match', 'v*', branch])
  const sinceTag = tagResult.ok ? tagResult.stdout : null
  const range = sinceTag ? `${sinceTag}..${branch}` : branch

  const [countResult, logResult] = await Promise.all([
    gitAsync(repo.path, ['rev-list', '--count', range]),
    gitAsync(repo.path, ['log', range, '--oneline', '--no-decorate', '-n', String(PREVIEW_LIMIT)]),
  ])
  const count = countResult.ok ? Number(countResult.stdout) : 0
  const lines = logResult.ok && logResult.stdout ? logResult.stdout.split('\n') : []

  return { sinceTag, count, lines, truncated: count > lines.length }
}

export function describeRecentChangesForAll(repos, concurrency) {
  return pMap(repos, describeRecentChangesAsync, concurrency)
}

// Uncapped commit list from the last `v*` tag to HEAD — used right before
// committing a version bump (see bump.js) to draft a CHANGELOG.md entry, so
// unlike describeRecentChanges (capped for a preview) this needs the whole
// list. Uses HEAD rather than the repo's default branch because it's
// called from exactly where that matters: after checking out the bump
// branch, whose HEAD is the default branch's tip at that point anyway.
export function fullCommitLinesSince(repo) {
  const tagResult = git(repo.path, ['describe', '--tags', '--abbrev=0', '--match', 'v*', 'HEAD'], { quiet: true })
  const sinceTag = tagResult.ok ? tagResult.stdout : null
  const range = sinceTag ? `${sinceTag}..HEAD` : 'HEAD'
  const logResult = git(repo.path, ['log', range, '--oneline', '--no-decorate'], { quiet: true })
  return logResult.ok && logResult.stdout ? logResult.stdout.split('\n').filter(Boolean) : []
}

export function formatRecentChanges({ sinceTag, count, lines, truncated }) {
  const header = sinceTag
    ? `${count} commit${count === 1 ? '' : 's'} since ${sinceTag}`
    : `${count} commit${count === 1 ? '' : 's'} (no tags yet)`
  if (count === 0) return header
  const body = lines.map((l) => `  ${l}`).join('\n')
  return `${header}:\n${body}${truncated ? '\n  …' : ''}`
}
