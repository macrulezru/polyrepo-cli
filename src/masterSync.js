import { MASTER_BRANCH } from './config.js'
import { git } from './exec.js'

// fetch → checkout master → fast-forward-only merge. Always run for real
// (never skipped under --dry-run) since it's read-only/reversible and
// downstream logic needs an accurate picture of where master actually is.
export function syncMaster(repo) {
  if (!git(repo.path, ['fetch', 'origin']).ok) {
    return { ok: false, message: 'git fetch origin failed.' }
  }
  if (!git(repo.path, ['checkout', MASTER_BRANCH]).ok) {
    return { ok: false, message: `git checkout ${MASTER_BRANCH} failed.` }
  }
  if (!git(repo.path, ['merge', '--ff-only', `origin/${MASTER_BRANCH}`]).ok) {
    return { ok: false, message: `Local ${MASTER_BRANCH} has diverged from origin — resolve manually.` }
  }
  return { ok: true }
}
