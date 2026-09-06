import { gh, git } from './exec.js'

// Looks up an existing PR for `branch` in the given state, quietly (no
// command echo — this runs before we know whether there's anything
// interesting to report, so the caller decides what to print).
function findPr(repo, branch, state) {
  const result = gh(repo.path, ['pr', 'list', '--head', branch, '--state', state, '--json', 'number,url'], {
    quiet: true,
  })
  if (!result.ok || !result.stdout) return null
  try {
    const list = JSON.parse(result.stdout)
    return list[0] ?? null
  } catch {
    return null
  }
}

// Figures out where a previous (possibly interrupted) bump attempt for this
// exact branch left off, so a re-run resumes instead of failing on
// "branch already exists" or opening a duplicate PR:
//   - 'merged'   — the PR already landed; only a local default-branch sync is left.
//   - 'open'     — a PR exists and just needs merging.
//   - 'branch'   — the branch was pushed but no PR was ever opened.
//   - 'fresh'    — nothing exists yet, do the full flow.
export function detectBumpState(repo, branch) {
  const merged = findPr(repo, branch, 'merged')
  if (merged) return { status: 'merged', pr: merged }

  const open = findPr(repo, branch, 'open')
  if (open) return { status: 'open', pr: open }

  if (remoteBranchExists(repo, branch)) return { status: 'branch' }

  return { status: 'fresh' }
}

function remoteBranchExists(repo, branch) {
  const result = git(repo.path, ['ls-remote', '--exit-code', '--heads', 'origin', branch], { quiet: true })
  return result.ok
}

export function createPr(repo, { base, branch, title, body, dryRun }) {
  const result = gh(
    repo.path,
    ['pr', 'create', '--base', base, '--head', branch, '--title', title, '--body', body],
    { mutating: true, dryRun },
  )
  if (!result.ok) return { ok: false }
  const match = result.stdout.match(/\/pull\/(\d+)/)
  if (!match) return { ok: false, message: `Could not parse PR number from: ${result.stdout}` }
  return { ok: true, number: match[1] }
}

export function mergePr(repo, number, { dryRun } = {}) {
  return gh(repo.path, ['pr', 'merge', number, '--merge', '--delete-branch=false'], { mutating: true, dryRun })
}
