import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run, gh, ghAsync } from '../exec.js'
import { remoteBranchExists } from './shared.js'

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
// exact branch left off, so a re-run resumes instead of failing on "branch
// already exists" or opening a duplicate PR:
//   - 'merged'   — the PR already landed; only a local default-branch sync is left.
//   - 'open'     — a PR exists and just needs merging.
//   - 'branch'   — the branch was pushed but no PR was ever opened.
//   - 'fresh'    — nothing exists yet, do the full flow.
function detectBumpState(repo, branch) {
  const merged = findPr(repo, branch, 'merged')
  if (merged) return { status: 'merged', pr: merged }

  const open = findPr(repo, branch, 'open')
  if (open) return { status: 'open', pr: open }

  if (remoteBranchExists(repo, branch)) return { status: 'branch' }

  return { status: 'fresh' }
}

function createPr(repo, { base, branch, title, body, dryRun }) {
  const result = gh(repo.path, ['pr', 'create', '--base', base, '--head', branch, '--title', title, '--body', body], {
    mutating: true,
    dryRun,
  })
  if (!result.ok) return { ok: false }
  const match = result.stdout.match(/\/pull\/(\d+)/)
  if (!match) return { ok: false, message: `Could not parse PR number from: ${result.stdout}` }
  return { ok: true, number: match[1] }
}

function mergePr(repo, number, { dryRun } = {}) {
  return gh(repo.path, ['pr', 'merge', number, '--merge', '--delete-branch=false'], { mutating: true, dryRun })
}

// Two steps: a quick, quiet probe (no --watch) to see whether the PR has
// any checks reported at all — most repos don't have CI wired up, and "no
// checks configured" isn't a reason to refuse merging — then, only if
// checks exist, the real wait, using gh's own `--watch` (rather than
// hand-rolled polling) with a real terminal so its live table renders.
function waitForChecks(repo, { number: prNumber }) {
  const probe = gh(repo.path, ['pr', 'checks', String(prNumber), '--json', 'bucket'], { quiet: true })
  if (!probe.ok || !probe.stdout || probe.stdout === '[]') {
    return { ok: true, skipped: true }
  }

  const watched = gh(repo.path, ['pr', 'checks', String(prNumber), '--watch', '--interval', '10'], {
    interactive: true,
  })
  if (watched.ok) return { ok: true, skipped: false }
  return {
    ok: false,
    message: `CI checks failed for PR #${prNumber} — not merging. Run \`gh pr checks ${prNumber}\` for details.`,
  }
}

async function listOpenPrsAsync(repo) {
  const result = await ghAsync(repo.path, ['pr', 'list', '--state', 'open', '--json', 'number,title,headRefName,isDraft'])
  if (!result.ok || !result.stdout) return []
  try {
    return JSON.parse(result.stdout).map((pr) => ({
      number: pr.number,
      title: pr.title,
      branch: pr.headRefName,
      isDraft: pr.isDraft,
    }))
  } catch {
    return []
  }
}

async function getDefaultBranchAsync(repo) {
  const result = await ghAsync(repo.path, ['repo', 'view', '--json', 'defaultBranchRef', '-q', '.defaultBranchRef.name'])
  return result.ok && result.stdout ? result.stdout : null
}

async function isBranchProtectedAsync(repo, branch) {
  const result = await ghAsync(repo.path, ['api', `repos/{owner}/{repo}/branches/${branch}`, '--jq', '.protected'])
  return result.ok && result.stdout ? result.stdout === 'true' : null
}

async function isPrMergedAsync(repo, branch) {
  const result = await ghAsync(repo.path, ['pr', 'list', '--head', branch, '--state', 'merged', '--json', 'number'])
  if (!result.ok || !result.stdout) return false
  try {
    return JSON.parse(result.stdout).length > 0
  } catch {
    return false
  }
}

async function releaseExistsAsync(repo, tag) {
  const result = await ghAsync(repo.path, ['release', 'view', tag])
  return result.ok
}

// Synchronous counterpart, used right before actually creating a release
// (see release.js's releaseOne) — re-checked there instead of just trusting
// whatever status was computed earlier, since `gh release create` fails
// outright against a tag that already has one; there's no "recreate", so
// this is the one thing that has to be current at the moment of the call.
function releaseExists(repo, tag) {
  return gh(repo.path, ['release', 'view', tag], { quiet: true }).ok
}

// `--verify-tag` makes this fail loudly instead of inventing a new tag if
// the one we expect (from `polyrepo bump`) somehow isn't on origin yet — a
// release should only ever point at a tag that already exists. Notes come
// from the matching CHANGELOG.md section when there is one, otherwise gh's
// own --generate-notes (from merged PRs/commits) is the fallback.
function createRelease(repo, { tag, title, notes, dryRun }) {
  const args = ['release', 'create', tag, '--verify-tag', '--title', title]
  let tempFile
  if (notes) {
    tempFile = path.join(os.tmpdir(), `polyrepo-release-notes-${process.pid}-${Date.now()}.md`)
    fs.writeFileSync(tempFile, notes)
    args.push('--notes-file', tempFile)
  } else {
    args.push('--generate-notes')
  }
  try {
    return gh(repo.path, args, { mutating: true, dryRun })
  } finally {
    if (tempFile) fs.rmSync(tempFile, { force: true })
  }
}

function listOrgRepos(org, { includeArchived = false } = {}) {
  const result = gh('.', ['repo', 'list', org, '--limit', '200', '--json', 'name,url,isArchived'], { quiet: true })
  if (!result.ok) {
    return { ok: false, message: `Could not list repos for "${org}" — is \`gh\` authenticated and the name correct?` }
  }
  let repos
  try {
    repos = JSON.parse(result.stdout)
  } catch {
    return { ok: false, message: 'Could not parse `gh repo list` output.' }
  }
  if (!includeArchived) repos = repos.filter((r) => !r.isArchived)
  return { ok: true, repos: repos.map((r) => ({ name: r.name, url: r.url, isArchived: r.isArchived })) }
}

function checkAuth() {
  const version = run('.', 'gh', ['--version'], { quiet: true })
  if (!version.ok) {
    return { ok: false, message: 'gh (GitHub CLI) not found in PATH — required for `bump`, `release`, and PR merges. https://cli.github.com/' }
  }
  const versionLine = version.stdout.split('\n')[0]
  const auth = run('.', 'gh', ['auth', 'status'], { quiet: true })
  if (auth.ok) {
    const who = (auth.stdout + auth.stderr).match(/Logged in to [^\s]+ account (\S+)/)
    return { ok: true, versionLine, who: who ? who[1] : null }
  }
  return { ok: false, versionLine, message: `${versionLine} — not authenticated. Run \`gh auth login\`.` }
}

export const githubProvider = {
  name: 'github',
  cli: 'gh',
  requestLabel: 'PR',
  checkAuth,
  findPr,
  detectBumpState,
  createPr,
  mergePr,
  waitForChecks,
  listOpenPrsAsync,
  getDefaultBranchAsync,
  isBranchProtectedAsync,
  isPrMergedAsync,
  releaseExistsAsync,
  releaseExists,
  createRelease,
  listOrgRepos,
}
