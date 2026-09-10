import { checkbox, confirm } from '@inquirer/prompts'
import pc from 'picocolors'
import { discoverRepos, discoverPackages, inspectRepos } from '../repos.js'
import { loadConfig } from '../loadConfig.js'
import { run, git, gitAsync } from '../exec.js'
import { findStaleLocalDeps } from '../crossDeps.js'
import { isBumpBranchName } from '../config.js'
import { pMap } from '../pMap.js'
import { ALL_PROVIDERS, providerFor, providerNameFor } from '../providers/index.js'
import { heading, ok, fail, warn, columnWidths, formatRow, promptTheme } from '../ui.js'
import { startSpinner } from '../spinner.js'

export async function doctorCommand({ configPath, cleanBranches = false } = {}) {
  // Discovered before printing "Environment" (unlike every other section
  // here, which discovers after) — which host CLI(s) to check depends on
  // which providers the repos actually use, so that has to be known first.
  const config = loadConfig({ configPath })
  const discovered = discoverRepos(config)
  const discoverySpinner = startSpinner(`Checking ${discovered.length} package(s)...`)
  const repos = await inspectRepos(discovered)
  discoverySpinner.stop()

  heading('Environment')
  checkNode()
  checkGit()
  const providersInUse = new Set(repos.map((r) => providerNameFor(r, config)).filter(Boolean))
  if (providersInUse.size === 0) {
    // No repos discovered yet, or none with a recognizable origin — still
    // worth checking `gh` (the default/most common case) so `doctor` says
    // something useful before `polyrepo setup` has ever been run.
    checkProviderCli(ALL_PROVIDERS[0])
  } else {
    for (const provider of ALL_PROVIDERS) {
      if (providersInUse.has(provider.name)) checkProviderCli(provider)
    }
  }
  checkNpm()

  heading('Config')
  console.log(pc.dim(`Config file: ${config.configPath}`))
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
    await checkRemoteSync(repos, config)
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
    await checkBranchProtection(repos, config)
  } else {
    console.log(pc.dim('Skipped — no packages discovered.'))
  }

  heading('Stale bump branches')
  if (repos.length > 0) {
    await checkStaleBumpBranches(repos, { cleanBranches, config })
  } else {
    console.log(pc.dim('Skipped — no packages discovered.'))
  }

  heading('Cross-package dependencies')
  if (repos.length > 0) {
    // Unlike every other section above (repo-level: one git working tree,
    // one branch, one PR list), a dependency range is declared per npm
    // package — a monorepo's own members need to be expanded here even
    // though the rest of this command deliberately stays at repo
    // granularity (see discoverPackages in repos.js).
    const packages = await inspectRepos(discoverPackages(config))
    const issues = findStaleLocalDeps(packages)
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
// cache on its own, so if the default branch gets renamed on the host
// after a repo was cloned, every command would keep using the old name
// forever with nothing to notice or fix it. This repairs it with `git
// remote set-head origin --auto` wherever it's drifted — a safe,
// non-destructive pointer refresh, not a change to any file, branch, or
// commit. Bundled with `git remote prune origin` (same "keep local
// remote-tracking state honest" spirit): drops local `remotes/origin/x`
// refs for branches already deleted on the host — also just local
// bookkeeping, touches nothing shared.
async function checkRemoteSync(repos, config) {
  const spinner = startSpinner(`Checking ${repos.length} package(s) against their host, and pruning stale remote-tracking refs...`)
  const results = await pMap(repos, async (r) => {
    const provider = providerFor(r, config)
    const actual = provider ? await provider.getDefaultBranchAsync(r) : null

    const pruneResult = await gitAsync(r.path, ['remote', 'prune', 'origin'])
    const pruned = pruneResult.ok ? [...pruneResult.stdout.matchAll(/\[pruned\] origin\/(\S+)/g)].map((m) => m[1]) : []

    return { repo: r, actual, pruned }
  })
  spinner.stop()

  const checked = results.filter((r) => r.actual)
  if (checked.length === 0) {
    console.log(pc.dim('Default branch: skipped — could not reach the host for any package (offline, `gh`/`glab` not authenticated, or no recognized host).'))
  } else {
    const drifted = checked.filter((r) => r.actual !== r.repo.defaultBranch)
    for (const { repo, actual } of drifted) {
      const fixResult = git(repo.path, ['remote', 'set-head', 'origin', '--auto'])
      if (fixResult.ok) {
        ok(`${repo.dir}: local cache said "${repo.defaultBranch}", the host says "${actual}" — refreshed the local cache.`)
      } else {
        fail(`${repo.dir}: local cache said "${repo.defaultBranch}", the host says "${actual}" — could not refresh it (git remote set-head failed).`)
      }
    }
    if (drifted.length === 0) {
      ok(`${checked.length} package(s) checked — local default-branch cache matches the host.`)
    }
    const uncheckedCount = repos.length - checked.length
    if (uncheckedCount > 0) {
      console.log(pc.dim(`  (${uncheckedCount} package(s) could not be checked against their host.)`))
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
async function checkBranchProtection(repos, config) {
  const spinner = startSpinner(`Checking ${repos.length} package(s) for branch protection...`)
  const results = await pMap(repos, async (r) => {
    const provider = providerFor(r, config)
    if (!provider) return null
    const protectedFlag = await provider.isBranchProtectedAsync(r, r.defaultBranch)
    return protectedFlag === null ? null : { repo: r, protected: protectedFlag }
  })
  spinner.stop()

  const checked = results.filter(Boolean)
  if (checked.length === 0) {
    console.log(pc.dim('Skipped — could not reach the host for any package (offline, `gh`/`glab` not authenticated, or no recognized host).'))
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
    console.log(pc.dim(`  (${uncheckedCount} package(s) could not be checked against their host.)`))
  }
}

// `bump` merges through a PR/MR with the source branch kept (see
// providers/github.js and providers/gitlab.js), so every completed bump
// leaves its branch behind, locally and on origin, forever. This only
// ever offers to delete the *local* copy — deleting the one on origin is
// more sensitive shared state, not something to fold into an opt-in
// local cleanup.
async function findStaleBumpBranches(repos, config) {
  const perRepo = await pMap(repos, async (r) => {
    const provider = providerFor(r, config)
    if (!provider) return []
    const branchesResult = await gitAsync(r.path, ['for-each-ref', 'refs/heads', '--format=%(refname:short)'])
    if (!branchesResult.ok) return []
    const candidates = branchesResult.stdout.split('\n').filter(Boolean).filter(isBumpBranchName)
    if (candidates.length === 0) return []

    const withStatus = await pMap(candidates, async (branch) => {
      const merged = await provider.isPrMergedAsync(r, branch)
      return { repo: r, branch, merged }
    })
    return withStatus.filter((b) => b.merged)
  })
  return perRepo.flat()
}

async function checkStaleBumpBranches(repos, { cleanBranches, config }) {
  const spinner = startSpinner(`Checking ${repos.length} package(s) for leftover bump branches with a merged PR...`)
  const stale = await findStaleBumpBranches(repos, config)
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

// Checks whichever host CLI(s) (`gh`, `glab`) the discovered repos actually
// need, instead of always requiring both — someone with only GitHub repos
// shouldn't see a failed check for a tool they have no reason to install.
function checkProviderCli(provider) {
  const result = provider.checkAuth()
  if (!result.ok) {
    fail(result.message)
    return
  }
  ok(`${result.versionLine}${result.who ? ` — authenticated as ${result.who}` : ' — authenticated'}.`)
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
