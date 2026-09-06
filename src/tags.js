import { git, gitAsync } from './exec.js'

export function tagName(version) {
  return `v${version}`
}

export function tagExists(repo, tag) {
  // Checks the remote, not just the local repo — the source of truth for
  // "was this version already released" is origin, and a fresh clone
  // wouldn't have any tags fetched locally yet.
  const result = git(repo.path, ['ls-remote', '--exit-code', '--tags', 'origin', tag], { quiet: true })
  return result.ok
}

// Same check, used where many repos are checked at once (see pMap) —
// `vpc tag`'s package list, for one.
export async function tagExistsAsync(repo, tag) {
  const result = await gitAsync(repo.path, ['ls-remote', '--exit-code', '--tags', 'origin', tag])
  return result.ok
}

export function createAndPushTag(repo, tag, { dryRun } = {}) {
  if (!git(repo.path, ['tag', '-a', tag, '-m', tag], { mutating: true, dryRun }).ok) {
    return { ok: false, message: `git tag ${tag} failed.` }
  }
  if (!git(repo.path, ['push', 'origin', tag], { mutating: true, dryRun }).ok) {
    return { ok: false, message: `git push origin ${tag} failed.` }
  }
  return { ok: true }
}
