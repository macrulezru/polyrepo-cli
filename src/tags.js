import { git, gitAsync } from './exec.js'

export function tagName(version, { scopedName } = {}) {
  return scopedName ? `${scopedName}@${version}` : `v${version}`
}

// Convenience wrapper for the common case — this package's own tag, scoped
// automatically when it's a pnpm workspace member (see repos.js's
// discoverPackages) so two packages in the same repo bumped to the same
// version number never collide on one `v<version>` tag, unscoped (the
// original form, unchanged for every non-monorepo package) otherwise.
// `version` defaults to the package's current version, but bump.js passes
// the *new* version explicitly since it's naming the tag before it exists.
export function tagFor(repo, version = repo.version) {
  return tagName(version, { scopedName: repo.isWorkspaceMember ? repo.name : undefined })
}

export function tagExists(repo, tag) {
  // Checks the remote, not just the local repo — the source of truth for
  // "was this version already released" is origin, and a fresh clone
  // wouldn't have any tags fetched locally yet.
  const result = git(repo.path, ['ls-remote', '--exit-code', '--tags', 'origin', tag], { quiet: true })
  return result.ok
}

// Same check, used where many repos are checked at once (see pMap) —
// `polyrepo tag`'s package list, for one.
export async function tagExistsAsync(repo, tag) {
  const result = await gitAsync(repo.path, ['ls-remote', '--exit-code', '--tags', 'origin', tag])
  return result.ok
}

// `tagExists`/`tagExistsAsync` above only check origin (deliberately — see
// their own comment), so a tag that was created locally by a previous
// `polyrepo tag` run but never made it to origin (interrupted, a failed
// `git push`, no network at the time) reads as "not tagged yet" and gets
// tried again — and `git tag -a` fails outright when a tag with that name
// already exists locally, aborting the whole run. Checked here, right
// before creating, so that exact half-finished state self-heals: skip
// re-creating the tag and just push the one that's already sitting there.
function localTagExists(repo, tag) {
  const result = git(repo.path, ['tag', '-l', tag], { quiet: true })
  return result.ok && result.stdout === tag
}

export function createAndPushTag(repo, tag, { dryRun } = {}) {
  if (!localTagExists(repo, tag)) {
    if (!git(repo.path, ['tag', '-a', tag, '-m', tag], { mutating: true, dryRun }).ok) {
      return { ok: false, message: `git tag ${tag} failed.` }
    }
  }
  if (!git(repo.path, ['push', 'origin', tag], { mutating: true, dryRun }).ok) {
    return { ok: false, message: `git push origin ${tag} failed.` }
  }
  return { ok: true }
}
