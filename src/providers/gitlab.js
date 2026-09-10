import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run, glab, glabAsync } from '../exec.js'
import { remoteBranchExists } from './shared.js'
import { fullCommitLinesSince } from '../changes.js'

// GitLab merge requests carry both a project-scoped `iid` (what's shown as
// "!42" in the UI, and what `glab mr merge`/`mr view` expect) and a global
// `id` — every place this module deals with an MR number, it means `iid`.
function findMr(repo, branch, state) {
  const args = ['mr', 'list', '--source-branch', branch, '--output', 'json']
  if (state === 'merged') args.push('--merged')
  const result = glab(repo.path, args, { quiet: true })
  if (!result.ok || !result.stdout) return null
  try {
    const list = JSON.parse(result.stdout)
    const mr = list[0]
    return mr ? { number: mr.iid, url: mr.web_url } : null
  } catch {
    return null
  }
}

// Same resume logic as the GitHub adapter's detectBumpState — see there
// for the four states this can settle on.
function detectBumpState(repo, branch) {
  const merged = findMr(repo, branch, 'merged')
  if (merged) return { status: 'merged', pr: merged }

  const open = findMr(repo, branch, 'open')
  if (open) return { status: 'open', pr: open }

  if (remoteBranchExists(repo, branch)) return { status: 'branch' }

  return { status: 'fresh' }
}

function createPr(repo, { base, branch, title, body, dryRun }) {
  const result = glab(
    repo.path,
    ['mr', 'create', '--source-branch', branch, '--target-branch', base, '--title', title, '--description', body, '--yes'],
    { mutating: true, dryRun },
  )
  if (!result.ok) return { ok: false }
  const match = result.stdout.match(/merge_requests\/(\d+)/)
  if (!match) return { ok: false, message: `Could not parse MR number from: ${result.stdout}` }
  return { ok: true, number: match[1] }
}

// `--auto-merge=false` forces an immediate merge attempt even when a
// pipeline is running — glab's own default is to merge only once the
// pipeline succeeds, which would make this call return before the merge
// actually happened, breaking the "merged means merged now" assumption
// the rest of `bump` relies on (tagging comes right after). CI is either
// waited on explicitly first (see waitForChecks) or not at all — never
// silently deferred here.
function mergePr(repo, number, { dryRun } = {}) {
  return glab(repo.path, ['mr', 'merge', String(number), '--auto-merge=false', '--yes'], { mutating: true, dryRun })
}

// `glab` has no MR/pipeline-ID-scoped "wait for checks" the way `gh pr
// checks --watch` is scoped to a PR number — the closest primitive is
// `glab ci status`, which is scoped to a *branch*. A quiet, non-waiting
// probe first (mirrors the GitHub adapter's probe) — no pipeline for this
// branch isn't a reason to refuse merging, most repos won't have GitLab CI
// configured at all.
function waitForChecks(repo, { branch }) {
  const probe = glab(repo.path, ['ci', 'status', '--branch', branch, '--output', 'json'], { quiet: true })
  if (!probe.ok || !probe.stdout) {
    return { ok: true, skipped: true }
  }

  const watched = glab(repo.path, ['ci', 'status', '--branch', branch, '--wait'], { interactive: true })
  if (watched.ok) return { ok: true, skipped: false }
  return {
    ok: false,
    message: `CI checks failed for branch ${branch} — not merging. Run \`glab ci status --branch ${branch}\` for details.`,
  }
}

async function listOpenPrsAsync(repo) {
  const result = await glabAsync(repo.path, ['mr', 'list', '--output', 'json'])
  if (!result.ok || !result.stdout) return []
  try {
    return JSON.parse(result.stdout).map((mr) => ({
      number: mr.iid,
      title: mr.title,
      branch: mr.source_branch,
      isDraft: Boolean(mr.draft ?? mr.work_in_progress),
    }))
  } catch {
    return []
  }
}

async function getDefaultBranchAsync(repo) {
  const result = await glabAsync(repo.path, ['api', 'projects/:fullpath'])
  if (!result.ok || !result.stdout) return null
  try {
    return JSON.parse(result.stdout).default_branch ?? null
  } catch {
    return null
  }
}

// The project's own repository-branch endpoint (not `/protected_branches`)
// carries a flat `.protected` boolean on a resource that always exists as
// long as the branch does — same shape the GitHub adapter reads off
// `branches/{branch}`, and it sidesteps `/protected_branches`' 200-vs-404
// ambiguity (protected vs. "not protected" vs. "call failed" would
// otherwise all need separate handling).
async function isBranchProtectedAsync(repo, branch) {
  const result = await glabAsync(repo.path, ['api', `projects/:fullpath/repository/branches/${encodeURIComponent(branch)}`])
  if (!result.ok || !result.stdout) return null
  try {
    return JSON.parse(result.stdout).protected ?? null
  } catch {
    return null
  }
}

async function isPrMergedAsync(repo, branch) {
  const result = await glabAsync(repo.path, ['mr', 'list', '--source-branch', branch, '--merged', '--output', 'json'])
  if (!result.ok || !result.stdout) return false
  try {
    return JSON.parse(result.stdout).length > 0
  } catch {
    return false
  }
}

async function releaseExistsAsync(repo, tag) {
  const result = await glabAsync(repo.path, ['release', 'view', tag])
  return result.ok
}

// Synchronous counterpart — see the GitHub adapter's releaseExists for why
// release.js re-checks this right before creating instead of trusting a
// status computed earlier.
function releaseExists(repo, tag) {
  return glab(repo.path, ['release', 'view', tag], { quiet: true }).ok
}

// GitLab has no `--generate-notes` (no auto-summary from merged MRs/
// commits) — when there's no CHANGELOG.md section to use, this falls back
// to the same commit-log listing `bump` already uses to draft a
// CHANGELOG.md entry (see changes.js), rather than leaving the release
// with no notes at all. Best-effort: reads HEAD, which is only guaranteed
// to be the tagged commit right after a `bump`, not for a tag released
// long after the fact.
function createRelease(repo, { tag, title, notes, dryRun }) {
  const finalNotes = notes || fallbackNotes(repo)
  const args = ['release', 'create', tag, '--name', title]
  let tempFile
  if (finalNotes) {
    tempFile = path.join(os.tmpdir(), `polyrepo-release-notes-${process.pid}-${Date.now()}.md`)
    fs.writeFileSync(tempFile, finalNotes)
    args.push('--notes-file', tempFile)
  }
  try {
    return glab(repo.path, args, { mutating: true, dryRun })
  } finally {
    if (tempFile) fs.rmSync(tempFile, { force: true })
  }
}

function fallbackNotes(repo) {
  const lines = fullCommitLinesSince(repo)
  if (lines.length === 0) return null
  return lines.map((l) => `- ${l}`).join('\n')
}

// `-g <namespace>` scopes to a GitLab group (the GitLab analog of a GitHub
// org) — plain `glab repo list` without it lists only projects owned by
// the authenticated user, not what `polyrepo clone --provider gitlab`
// means by "list this namespace's repos".
function listOrgRepos(namespace, { includeArchived = false } = {}) {
  const args = ['repo', 'list', '--group', namespace, '--per-page', '100', '--output', 'json']
  if (!includeArchived) args.push('--archived', 'false')
  const result = glab('.', args, { quiet: true })
  if (!result.ok) {
    return { ok: false, message: `Could not list repos for group "${namespace}" — is \`glab\` authenticated and the name correct?` }
  }
  let repos
  try {
    repos = JSON.parse(result.stdout)
  } catch {
    return { ok: false, message: 'Could not parse `glab repo list` output.' }
  }
  return {
    ok: true,
    repos: repos.map((r) => ({
      name: r.path ?? r.name,
      url: r.http_url_to_repo ?? r.web_url,
      isArchived: Boolean(r.archived),
    })),
  }
}

function checkAuth() {
  const version = run('.', 'glab', ['--version'], { quiet: true })
  if (!version.ok) {
    return { ok: false, message: 'glab (GitLab CLI) not found in PATH — required for `bump`, `release`, and MR merges on GitLab repos. https://gitlab.com/gitlab-org/cli' }
  }
  const versionLine = version.stdout.split('\n')[0]
  const auth = run('.', 'glab', ['auth', 'status'], { quiet: true })
  if (auth.ok) {
    const who = (auth.stdout + auth.stderr).match(/Logged in to \S+ as (\S+)/)
    return { ok: true, versionLine, who: who ? who[1] : null }
  }
  return { ok: false, versionLine, message: `${versionLine} — not authenticated. Run \`glab auth login\`.` }
}

export const gitlabProvider = {
  name: 'gitlab',
  cli: 'glab',
  requestLabel: 'MR',
  checkAuth,
  findPr: findMr,
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
