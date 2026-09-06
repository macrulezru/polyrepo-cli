import { checkbox, confirm } from '@inquirer/prompts'
import pc from 'picocolors'
import { discoverRepos, inspectRepos } from '../repos.js'
import { loadConfig } from '../loadConfig.js'
import { run, git, gitAsync, ghAsync } from '../exec.js'
import { findStaleLocalDeps } from '../crossDeps.js'
import { isBumpBranchName } from '../config.js'
import { pMap } from '../pMap.js'
import { heading, ok, fail, warn, columnWidths, formatRow, promptTheme } from '../ui.js'
import { startSpinner } from '../spinner.js'

export async function doctorCommand({ configPath, cleanBranches = false } = {}) {
  heading('Environment')
  checkNode()
  checkGit()
  checkGh()
  checkNpm()

  heading('Config')
  const config = loadConfig({ configPath })
  console.log(pc.dim(`Config file: ${config.configPath}`))
  const discovered = discoverRepos(config)
  const spinner = startSpinner(`Checking ${discovered.length} package(s)...`)
  const repos = await inspectRepos(discovered)
  spinner.stop()
  if (repos.length === 0) {
    fail('No packages discovered — check `polyrepo setup`.')
  } else {
    ok(`${repos.length} package(s) discovered.`)
    const dirty = repos.filter((r) => !r.clean)
    if (dirty.length > 0) {
      warn(`${dirty.length} repo(s) have uncommitted changes: ${dirty.map((r) => r.dir).join(', ')}`)
    }
    const detached = repos.filter((r) => r.branch === null)
    if (detached.length > 0) {
      warn(`${detached.length} repo(s) are in a detached HEAD state: ${detached.map((r) => r.dir).join(', ')}`)
    }
    const offDefault = repos.filter((r) => r.branch !== null && r.branch !== r.defaultBranch)
    if (offDefault.length > 0) {
      warn(`${offDefault.length} repo(s) are not on their default branch: ${offDefault.map((r) => r.dir).join(', ')}`)
    }
  }

  heading('Remote sync')
  if (repos.length > 0) {
    await checkRemoteSync(repos)
  } else {
    console.log(pc.dim('Skipped — no packages discovered.'))
  }

  heading('Branch sync')
  if (repos.length > 0) {
    await checkBranchSync(repos)
  } else {
    console.log(pc.dim('Skipped — no packages discovered.'))
  }

  heading('Branch protection')
  if (repos.length > 0) {
    await checkBranchProtection(repos)
  } else {
    console.log(pc.dim('Skipped — no packages discovered.'))
  }

  heading('Stale bump branches')
  if (repos.length > 0) {
    await checkStaleBumpBranches(repos, { cleanBranches })
  } else {
    console.log(pc.dim('Skipped — no packages discovered.'))
  }

  heading('Cross-package dependencies')
  if (repos.length > 0) {
    const issues = findStaleLocalDeps(repos)
    if (issues.length === 0) {
      ok('No stale local dependency references found.')
    } else {
      for (const issue of issues) {
        warn(
          `${issue.repo.dir}: depends on "${issue.depName}" via "${issue.range}", which does not match the local version ${issue.localVersion}.`,
        )
      }
    }
  } else {
    console.log(pc.dim('Skipped — no packages discovered.'))
  }
}

// Every other command trusts the locally cached `origin/HEAD` ref as the
// fast, no-network path for "what's this repo's default branch" (see
// detectDefaultBranchAsync in repos.js) — but git never refreshes that
// cache on its own, so if the default branch gets renamed on GitHub after
// a repo was cloned, every command would keep using the old name forever
// with nothing to notice or fix it. This repairs it with `git remote
// set-head origin --auto` wherever it's drifted — a safe, non-destructive
// pointer refresh, not a change to any file, branch, or commit. Bundled
// with `git remote prune origin` (same "keep local remote-tracking state
// honest" spirit): drops local `remotes/origin/x` refs for branches
// already deleted on GitHub — also just local bookkeeping, touches
// nothing shared.
async function checkRemoteSync(repos) {
  const spinner = startSpinner(`Checking ${repos.length} package(s) against GitHub, and pruning stale remote-tracking refs...`)
  const results = await pMap(repos, async (r) => {
    const ghResult = await ghAsync(r.path, [
      'repo',
      'view',
      '--json',
      'defaultBranchRef',
      '-q',
      '.defaultBranchRef.name',
    ])
    const actual = ghResult.ok && ghResult.stdout ? ghResult.stdout : null

    const pruneResult = await gitAsync(r.path, ['remote', 'prune', 'origin'])
    const pruned = pruneResult.ok ? [...pruneResult.stdout.matchAll(/\[pruned\] origin\/(\S+)/g)].map((m) => m[1]) : []

    return { repo: r, actual, pruned }
  })
  spinner.stop()

  const checked = results.filter((r) => r.actual)
  if (checked.length === 0) {
    console.log(pc.dim('Default branch: skipped — could not reach GitHub for any package (offline, or `gh` not authenticated).'))
  } else {
    const drifted = checked.filter((r) => r.actual !== r.repo.defaultBranch)
    for (const { repo, actual } of drifted) {
      const fixResult = git(repo.path, ['remote', 'set-head', 'origin', '--auto'])
      if (fixResult.ok) {
        ok(`${repo.dir}: local cache said "${repo.defaultBranch}", GitHub says "${actual}" — refreshed the local cache.`)
      } else {
        fail(`${repo.dir}: local cache said "${repo.defaultBranch}", GitHub says "${actual}" — could not refresh it (git remote set-head failed).`)
      }
    }
    if (drifted.length === 0) {
      ok(`${checked.length} package(s) checked — local default-branch cache matches GitHub.`)
    }
    const uncheckedCount = repos.length - checked.length
    if (uncheckedCount > 0) {
      console.log(pc.dim(`  (${uncheckedCount} package(s) could not be checked against GitHub.)`))
    }
  }

  const pruned = results.filter((r) => r.pruned.length > 0)
  if (pruned.length > 0) {
    for (const { repo, pruned: branches } of pruned) {
      ok(`${repo.dir}: pruned ${branches.length} stale remote-tracking ref(s) (${branches.join(', ')}).`)
    }
  } else {
    ok('No stale remote-tracking refs to prune.')
  }
}

// Whether each repo's local default branch actually matches origin —
// surfaced here proactively so it's known before a `switch-default` run
// fails partway on a fast-forward it can't do, or before `bump`/`tag`
// build a branch from a base that isn't what it looks like locally.
async function checkBranchSync(repos) {
  const spinner = startSpinner(`Fetching and comparing ${repos.length} package(s) against origin...`)
  const results = await pMap(repos, async (r) => {
    const fetchResult = await gitAsync(r.path, ['fetch', 'origin'])
    if (!fetchResult.ok) return { repo: r, error: 'git fetch failed' }

    const branch = r.defaultBranch
    const countResult = await gitAsync(r.path, ['rev-list', '--left-right', '--count', `${branch}...origin/${branch}`])
    if (!countResult.ok) return { repo: r, error: `no local branch "${branch}" to compare` }

    const [ahead, behind] = countResult.stdout.split(/\s+/).map(Number)
    return { repo: r, ahead, behind }
  })
  spinner.stop()

  for (const { repo, error } of results.filter((r) => r.error)) {
    warn(`${repo.dir}: could not check sync status (${error}).`)
  }

  const withCounts = results.filter((r) => !r.error)
  const diverged = withCounts.filter((r) => r.ahead > 0 && r.behind > 0)
  const behindOnly = withCounts.filter((r) => r.ahead === 0 && r.behind > 0)
  const aheadOnly = withCounts.filter((r) => r.ahead > 0 && r.behind === 0)
  const inSync = withCounts.filter((r) => r.ahead === 0 && r.behind === 0)

  for (const { repo, ahead, behind } of diverged) {
    warn(
      `${repo.dir}: diverged from origin/${repo.defaultBranch} — ${ahead} local commit(s) not on origin, ${behind} commit(s) behind. A fast-forward won't work; resolve by hand.`,
    )
  }
  if (behindOnly.length > 0) {
    warn(
      `${behindOnly.length} repo(s) are behind origin (safe to fast-forward with \`polyrepo switch-default\`): ${behindOnly
        .map((r) => r.repo.dir)
        .join(', ')}`,
    )
  }
  if (aheadOnly.length > 0) {
    console.log(
      pc.dim(
        `${aheadOnly.length} repo(s) have local commits not yet pushed to origin: ${aheadOnly.map((r) => r.repo.dir).join(', ')}`,
      ),
    )
  }
  if (inSync.length === withCounts.length && withCounts.length > 0) {
    ok(`${inSync.length} package(s) checked — all in sync with origin.`)
  }
}

// Not auto-fixable — enabling branch protection is a deliberate policy
// choice (required reviewers, status checks, etc.), not something to
// configure on someone's behalf. Just surfaces it, since this whole tool
// assumes every managed repo requires a PR to reach its default branch.
async function checkBranchProtection(repos) {
  const spinner = startSpinner(`Checking ${repos.length} package(s) for branch protection...`)
  const results = await pMap(repos, async (r) => {
    const result = await ghAsync(r.path, ['api', `repos/{owner}/{repo}/branches/${r.defaultBranch}`, '--jq', '.protected'])
    return result.ok && result.stdout ? { repo: r, protected: result.stdout === 'true' } : null
  })
  spinner.stop()

  const checked = results.filter(Boolean)
  if (checked.length === 0) {
    console.log(pc.dim('Skipped — could not reach GitHub for any package (offline, or `gh` not authenticated).'))
    return
  }

  const unprotected = checked.filter((r) => !r.protected)
  for (const { repo } of unprotected) {
    warn(`${repo.dir}: default branch "${repo.defaultBranch}" has no branch protection — pushes/merges to it aren't guarded.`)
  }
  if (unprotected.length === 0) {
    ok(`${checked.length} package(s) checked — default branch is protected on all of them.`)
  }

  const uncheckedCount = repos.length - checked.length
  if (uncheckedCount > 0) {
    console.log(pc.dim(`  (${uncheckedCount} package(s) could not be checked against GitHub.)`))
  }
}

// `bump` merges through a PR with --delete-branch=false (see github.js),
// so every completed bump leaves its branch behind, locally and on
// origin, forever. This only ever offers to delete the *local* copy —
// deleting the one on origin is more sensitive shared state, not
// something to fold into an opt-in local cleanup.
async function findStaleBumpBranches(repos) {
  const perRepo = await pMap(repos, async (r) => {
    const branchesResult = await gitAsync(r.path, ['for-each-ref', 'refs/heads', '--format=%(refname:short)'])
    if (!branchesResult.ok) return []
    const candidates = branchesResult.stdout.split('\n').filter(Boolean).filter(isBumpBranchName)
    if (candidates.length === 0) return []

    const withStatus = await pMap(candidates, async (branch) => {
      const prResult = await ghAsync(r.path, ['pr', 'list', '--head', branch, '--state', 'merged', '--json', 'number'])
      let merged = false
      if (prResult.ok && prResult.stdout) {
        try {
          merged = JSON.parse(prResult.stdout).length > 0
        } catch {
          merged = false
        }
      }
      return { repo: r, branch, merged }
    })
    return withStatus.filter((b) => b.merged)
  })
  return perRepo.flat()
}

async function checkStaleBumpBranches(repos, { cleanBranches }) {
  const spinner = startSpinner(`Checking ${repos.length} package(s) for leftover bump branches with a merged PR...`)
  const stale = await findStaleBumpBranches(repos)
  spinner.stop()

  if (stale.length === 0) {
    ok('No stale bump branches found.')
    return
  }

  if (!cleanBranches) {
    warn(
      `${stale.length} stale bump branch(es) found across ${new Set(stale.map((s) => s.repo.dir)).size} package(s) — run \`polyrepo doctor --clean-branches\` to review and delete them.`,
    )
    return
  }

  const columns = [{ value: (s) => s.repo.dir }, { value: (s) => s.branch, style: (s, t) => pc.dim(t) }]
  const widths = columnWidths(stale, columns)
  const choices = stale.map((s) => ({
    name: formatRow(s, columns, widths),
    value: s,
    checked: true,
  }))

  const selected = await checkbox({
    message: 'Pick stale bump branches to delete locally (their PR is already merged):',
    pageSize: 20,
    theme: promptTheme,
    choices,
  })

  if (selected.length === 0) {
    console.log(pc.dim('Nothing selected.'))
    return
  }

  const proceed = await confirm({
    message: `Delete ${selected.length} local branch(es)? Only the local branch pointer goes away — the commits are already merged into the default branch.`,
    default: true,
  })
  if (!proceed) {
    console.log(pc.dim('Cancelled.'))
    return
  }

  for (const { repo, branch } of selected) {
    const result = git(repo.path, ['branch', '-d', branch])
    if (result.ok) ok(`${repo.dir}: deleted local branch ${branch}.`)
    else fail(`${repo.dir}: could not delete ${branch} (git branch -d failed — it may not be fully merged locally).`)
  }
}

function checkNode() {
  const [major] = process.versions.node.split('.').map(Number)
  if (major >= 20) {
    ok(`Node.js ${process.version} (>= 20 required).`)
  } else {
    fail(`Node.js ${process.version} — this CLI needs 20 or newer.`)
  }
}

function checkGit() {
  const result = run('.', 'git', ['--version'], { quiet: true })
  if (result.ok) {
    ok(`${result.stdout}.`)
  } else {
    fail('git not found in PATH — required for every command, including this one.')
  }
}

function checkGh() {
  const version = run('.', 'gh', ['--version'], { quiet: true })
  if (!version.ok) {
    fail('gh (GitHub CLI) not found in PATH — required for `bump`, `release`, and PR merges. https://cli.github.com/')
    return
  }
  const versionLine = version.stdout.split('\n')[0]
  const auth = run('.', 'gh', ['auth', 'status'], { quiet: true })
  if (auth.ok) {
    const who = (auth.stdout + auth.stderr).match(/Logged in to [^\s]+ account (\S+)/)
    ok(`${versionLine}${who ? ` — authenticated as ${who[1]}` : ' — authenticated'}.`)
  } else {
    fail(`${versionLine} — not authenticated. Run \`gh auth login\`.`)
  }
}

function checkNpm() {
  const version = run('.', 'npm', ['--version'], { quiet: true })
  if (!version.ok) {
    fail('npm not found in PATH — required only for `polyrepo publish`.')
    return
  }
  const who = run('.', 'npm', ['whoami'], { quiet: true })
  if (who.ok) {
    ok(`npm ${version.stdout} — authenticated as ${who.stdout}.`)
  } else {
    warn(`npm ${version.stdout} — not authenticated (only needed for \`polyrepo publish\`). Run \`npm login\`.`)
  }
}
