import { git } from '../exec.js'

// Used by both providers' detectBumpState: a branch pushed to origin with
// no PR/MR open yet is still a real "previous attempt got this far" state
// worth resuming from, not starting over.
export function remoteBranchExists(repo, branch) {
  const result = git(repo.path, ['ls-remote', '--exit-code', '--heads', 'origin', branch], { quiet: true })
  return result.ok
}
