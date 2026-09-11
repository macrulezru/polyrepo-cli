import path from 'node:path'
import { gitAsync } from './exec.js'

// Reads a package's version straight out of its origin's default branch —
// independent of whatever happens to be checked out locally right now (a
// different branch, an uncommitted edit, a repo that's simply behind or
// ahead of origin). Two steps, deliberately kept separate:
//   1. fetchOriginDefaultBranchAsync — a real network round trip, fetching
//      just the tip of that one branch (no merge, no checkout, nothing
//      local changes) so the remote-tracking ref is current.
//   2. readOriginVersionAsync — a local, no-network read of the
//      package.json blob straight out of that commit via `git show`.
// Split this way so list.js can fetch once per physical repo (a pnpm
// workspace's several member packages all share one fetch) and then read
// each member's own version cheaply. Same "origin, not the local working
// tree, is the source of truth" reasoning as tagExists/tagExistsAsync in
// tags.js.
export async function fetchOriginDefaultBranchAsync(repoPath, defaultBranch) {
  if (!defaultBranch) return false
  return (await gitAsync(repoPath, ['fetch', 'origin', defaultBranch])).ok
}

export async function readOriginVersionAsync(repo) {
  if (!repo.defaultBranch) return null
  const repoRoot = repo.repoPath ?? repo.path
  const relPath = path.relative(repoRoot, repo.pkgPath).split(path.sep).join('/')
  const result = await gitAsync(repoRoot, ['show', `origin/${repo.defaultBranch}:${relPath}`])
  if (!result.ok || !result.stdout) return null
  const match = result.stdout.match(/"version"\s*:\s*"([^"]+)"/)
  return match ? match[1] : null
}
