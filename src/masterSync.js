import { git } from './exec.js'

// fetch → checkout the repo's default branch → fast-forward-only merge.
// Always run for real (never skipped under --dry-run) since it's
// read-only/reversible and downstream logic needs an accurate picture of
// where the default branch actually is. Uses `repo.defaultBranch`
// (detected per repo — see repos.js's detectDefaultBranchAsync) rather
// than assuming "master", since that isn't universal.
//
// `force: true` (only `switch-master --force` sets this) trades the safe
// fast-forward-only merge for `checkout -f` + `reset --hard` — it discards
// any uncommitted changes to tracked files and any local commits the
// default branch has that origin doesn't, unconditionally. Untracked
// files are left alone (this isn't `git clean`). Callers that don't pass
// it keep the original safe behavior — bump/tag rely on that, they never
// force.
export function syncMaster(repo, { force = false } = {}) {
  const branch = repo.defaultBranch
  if (!git(repo.path, ['fetch', 'origin']).ok) {
    return { ok: false, message: 'git fetch origin failed.' }
  }
  if (!git(repo.path, ['checkout', ...(force ? ['-f'] : []), branch]).ok) {
    return { ok: false, message: `git checkout ${branch} failed.` }
  }
  if (force) {
    if (!git(repo.path, ['reset', '--hard', `origin/${branch}`]).ok) {
      return { ok: false, message: `git reset --hard origin/${branch} failed.` }
    }
    return { ok: true }
  }
  if (!git(repo.path, ['merge', '--ff-only', `origin/${branch}`]).ok) {
    return { ok: false, message: `Local ${branch} has diverged from origin — resolve manually.` }
  }
  return { ok: true }
}
