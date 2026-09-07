import fs from 'node:fs'
import { confirm } from '@inquirer/prompts'
import pc from 'picocolors'
import { discoverRepos, inspectRepos, readPackageJson } from '../repos.js'
import { bumpBranchName } from '../config.js'
import { loadConfig } from '../loadConfig.js'
import { bumpVersion, replaceVersionInText } from '../version.js'
import { git } from '../exec.js'
import { syncDefaultBranch } from '../defaultBranchSync.js'
import { detectBumpState, createPr, mergePr } from '../github.js'
import { tagName, tagExists, createAndPushTag } from '../tags.js'
import { describeRecentChangesForAll, formatRecentChanges, fullCommitLinesSince } from '../changes.js'
import { hasChangelog, addChangelogEntry } from '../changelog.js'
import { waitForChecks } from '../ciChecks.js'
import { findStaleLocalDeps } from '../crossDeps.js'
import { heading, stepHeading, ok, fail, warn, columnWidths, formatRow } from '../ui.js'
import { selectPackages } from '../selectPackages.js'
import { startSpinner } from '../spinner.js'

function bumpTypeLabel(bumpType, { preid, customVersion } = {}) {
  if (bumpType === 'custom') return `custom → ${customVersion}`
  if (bumpType === 'premajor') return `premajor, ${preid}`
  if (bumpType === 'preminor') return `preminor, ${preid}`
  if (bumpType === 'prepatch') return `prepatch, ${preid}`
  if (bumpType === 'prerelease') return `prerelease, ${preid}`
  return bumpType
}

export async function bumpCommand({
  dryRun = false,
  configPath,
  packages, // string[] of dir names — skips the checkbox when given
  yes = false, // skip the "proceed?" confirmation
  waitChecks = false, // wait for CI checks (if any) before merging each PR
  bumpType = 'patch', // 'patch' | 'minor' | 'major' | 'premajor' | 'preminor' | 'prepatch' | 'prerelease' | 'custom'
  preid, // prerelease identifier (e.g. 'alpha') for the 'pre*'/'prerelease' bump types
  customVersion, // exact version to set, for bumpType 'custom'
} = {}) {
  const config = loadConfig({ configPath })
  const discovered = discoverRepos(config)
  if (discovered.length === 0) {
    console.log(pc.yellow('No repos found.'))
    return
  }

  const bumpOptions = { preid, customVersion }
  heading(`Bump version (${bumpTypeLabel(bumpType, bumpOptions)})`)

  const scanSpinner = startSpinner(`Checking ${discovered.length} package(s)...`)
  const allRepos = await inspectRepos(discovered)
  scanSpinner.stop()

  const repos = allRepos.filter((r) => r.version)
  if (repos.length === 0) {
    console.log(pc.yellow('No repos found.'))
    return
  }

  const withTarget = repos.map((r) => ({ ...r, newVersion: bumpVersion(r.version, bumpType, bumpOptions) }))

  // Only worth computing when the checkbox is actually going to be shown —
  // a --packages run never displays it, so skip the (parallel, but still
  // real) work of asking every repo for its git log.
  let withPreview = withTarget
  if (!packages) {
    const previewSpinner = startSpinner(`Checking what changed since the last tag for ${withTarget.length} package(s)...`)
    const changesList = await describeRecentChangesForAll(withTarget)
    previewSpinner.stop()
    withPreview = withTarget.map((r, i) => ({ ...r, changes: changesList[i] }))
  }

  const selected = await selectPackages({
    items: withPreview,
    packages,
    message: `Pick packages to bump (${bumpType}):`,
    buildChoice: (all) => {
      const columns = [
        { value: (r) => r.dir },
        { value: (r) => r.version, style: (r, t) => pc.dim(t) },
        { value: () => '→', style: (r, t) => pc.dim(t) },
        { value: (r) => r.newVersion, style: (r, t) => pc.green(t) },
      ]
      const widths = columnWidths(all, columns)
      return (r) => ({
        name: formatRow(r, columns, widths) + (r.clean ? '' : pc.red('  (dirty, will be skipped)')),
        description: formatRecentChanges(r.changes),
        value: r,
      })
    },
  })

  if (selected.length === 0) {
    console.log(pc.dim('Nothing selected.'))
    return
  }

  if (!yes) {
    const proceed = await confirm({
      message: `Bump ${selected.length} package(s), open a PR, and merge each into its default branch?${
        dryRun ? ' (dry run — no changes will actually be pushed)' : ''
      }`,
      default: true,
    })
    if (!proceed) {
      console.log(pc.dim('Cancelled.'))
      return
    }
  }

  let index = 0
  for (const repo of selected) {
    index += 1
    stepHeading(index, selected.length, `${repo.dir}  ${repo.version} → ${repo.newVersion}`)
    await bumpOne(repo, { dryRun, waitChecks })
  }

  if (!dryRun) await reportStaleLocalDeps(config)
}

async function bumpOne(repo, { dryRun, waitChecks }) {
  if (!repo.clean) {
    warn('Working tree is dirty — skipping to avoid committing unrelated changes.')
    return
  }

  const syncResult = syncDefaultBranch(repo)
  if (!syncResult.ok) return fail(syncResult.message)
  ok(`${repo.defaultBranch} is up to date.`)

  const branchName = bumpBranchName(repo.newVersion)
  const state = detectBumpState(repo, branchName)

  if (dryRun) {
    if (state.status === 'merged') {
      ok(`[dry-run] Already merged as PR #${state.pr.number} — would only ensure the tag exists.`)
    } else {
      const verb = state.status === 'fresh' ? 'create' : 'reuse'
      const prVerb = state.status === 'open' ? `merge existing PR #${state.pr.number}` : 'open + merge a PR'
      const waitNote = waitChecks ? ', waiting for CI checks first' : ''
      console.log(
        pc.magenta(
          `  [dry-run] would ${verb} branch ${branchName}, ensure version ${repo.newVersion} (+ a CHANGELOG.md entry if one exists), commit/push if needed, then ${prVerb}${waitNote}, then tag ${tagName(repo.newVersion)}.`,
        ),
      )
    }
    return
  }

  let prNumber = state.status === 'merged' || state.status === 'open' ? state.pr.number : null

  if (state.status !== 'merged') {
    if (state.status === 'open') ok(`Found existing open PR #${state.pr.number} for ${branchName} — reusing it.`)
    if (state.status === 'branch') ok(`Found existing branch ${branchName} on origin without a PR — reusing it.`)

    const checkoutResult = checkoutBumpBranch(repo, branchName)
    if (!checkoutResult.ok) return fail(`Could not check out branch ${branchName}.`)
    ok(checkoutResult.reused ? `Reusing branch ${branchName}.` : `Created branch ${branchName}.`)

    const onDiskVersion = readPackageJson(repo).version
    if (onDiskVersion !== repo.newVersion) {
      const text = fs.readFileSync(repo.pkgPath, 'utf8')
      fs.writeFileSync(repo.pkgPath, replaceVersionInText(text, repo.newVersion))
      if (!git(repo.path, ['add', 'package.json']).ok) return fail('git add failed.')

      if (hasChangelog(repo)) {
        addChangelogEntry(repo, repo.newVersion, fullCommitLinesSince(repo))
        if (git(repo.path, ['add', 'CHANGELOG.md']).ok) {
          ok('Drafted a CHANGELOG.md entry — review it before merging if you want it polished.')
        } else {
          warn('Wrote a CHANGELOG.md entry but `git add` failed — it will stay as an uncommitted local change.')
        }
      }

      if (!git(repo.path, ['commit', '-m', `chore: bump version to ${repo.newVersion}`]).ok) {
        return fail('git commit failed.')
      }
      ok(`package.json version set to ${repo.newVersion} and committed.`)
    } else {
      ok(`package.json on ${branchName} is already at ${repo.newVersion} — nothing to commit.`)
    }

    if (!git(repo.path, ['push', '-u', 'origin', branchName]).ok) return fail('git push failed.')
    ok('Branch pushed (or already up to date on origin).')

    if (state.status !== 'open') {
      const prResult = createPr(repo, {
        base: repo.defaultBranch,
        branch: branchName,
        title: `chore: bump version to ${repo.newVersion}`,
        body: `Bump version: ${repo.version} → ${repo.newVersion}.`,
      })
      if (!prResult.ok) return fail(prResult.message ?? 'gh pr create failed.')
      prNumber = prResult.number
      ok(`Opened PR #${prNumber}.`)
    }

    if (waitChecks) {
      const checksResult = waitForChecks(repo, prNumber)
      if (!checksResult.ok) return fail(checksResult.message)
      ok(checksResult.skipped ? 'No CI checks reported — nothing to wait for.' : 'CI checks passed.')
    }

    if (!mergePr(repo, prNumber).ok) {
      return fail(`gh pr merge failed — PR #${prNumber} is still open, merge it manually.`)
    }
    ok(`Merged PR #${prNumber}.`)

    const resyncResult = syncDefaultBranch(repo)
    if (!resyncResult.ok) return fail(resyncResult.message)
    ok(`Local ${repo.defaultBranch} synced to origin at ${repo.newVersion}.`)
  } else {
    ok(`Already merged as PR #${state.pr.number} — ${repo.defaultBranch} already has it.`)
  }

  const tag = tagName(repo.newVersion)
  if (tagExists(repo, tag)) {
    ok(`Tag ${tag} already exists on origin.`)
  } else {
    const tagResult = createAndPushTag(repo, tag)
    if (!tagResult.ok) fail(tagResult.message)
    else ok(`Tagged and pushed ${tag}.`)
  }
}

// Reuse a local branch left over from a previous attempt if there is one,
// otherwise track the remote branch if a previous attempt got as far as
// pushing it, otherwise create it fresh from the current (just-synced)
// default branch. Trying "reuse" first before falling back is what makes
// this safe to call again after any partial failure without any state
// bookkeeping.
function checkoutBumpBranch(repo, branchName) {
  if (git(repo.path, ['checkout', branchName], { quiet: true }).ok) {
    return { ok: true, reused: true }
  }

  git(repo.path, ['fetch', 'origin', branchName], { quiet: true })
  if (git(repo.path, ['checkout', '-b', branchName, `origin/${branchName}`], { quiet: true }).ok) {
    return { ok: true, reused: true }
  }

  return { ok: git(repo.path, ['checkout', '-b', branchName]).ok, reused: false }
}

// One last look across every package (not just the ones just bumped) once
// the run is done — a bump can leave some other local package's
// dependencies/peerDependencies/devDependencies pointing at a range that no
// longer matches, and nothing else would surface that.
async function reportStaleLocalDeps(config) {
  const repos = (await inspectRepos(discoverRepos(config))).filter((r) => r.version)
  const issues = findStaleLocalDeps(repos)
  if (issues.length === 0) return
  heading('Stale local dependency references')
  for (const issue of issues) {
    warn(
      `${issue.repo.dir}: depends on "${issue.depName}" via "${issue.range}", which does not match the local version ${issue.localVersion}.`,
    )
  }
}
