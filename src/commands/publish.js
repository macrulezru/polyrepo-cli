import { confirm } from '@inquirer/prompts'
import semver from 'semver'
import pc from 'picocolors'
import { discoverPackages, inspectRepos } from '../repos.js'
import { loadConfig } from '../loadConfig.js'
import { npm, pnpm } from '../exec.js'
import { fetchPublishedVersionAsync } from '../registry.js'
import { fetchOriginDefaultBranchAsync, readOriginVersionAsync } from '../remoteVersion.js'
import { selectPackages } from '../selectPackages.js'
import { filterByNames } from '../filterByNames.js'
import { pMap } from '../pMap.js'
import { heading, stepHeading, ok, fail, warn, columnWidths, formatRow } from '../ui.js'

// A plain `npm publish`/`pnpm publish` always tags the published version
// "latest" on the registry unless told otherwise — including a prerelease
// version (e.g. 2.0.0-beta.1), which would then resolve as "latest" for
// anyone installing without an explicit version. Defaulting a prerelease to
// the "next" dist-tag instead (npm's own convention for this) avoids that
// footgun without needing anyone to remember `--tag next` by hand.
// `override`, when given (from `--dist-tag`), always wins — this is only
// ever the fallback for when nothing more specific was asked for.
export function distTagFor(version, override) {
  if (override) return override
  return semver.prerelease(version) ? 'next' : undefined
}

export async function publishCommand({ configPath, packages, yes = false, dryRun = false, distTag } = {}) {
  const config = loadConfig({ configPath })
  // A private package (e.g. a pnpm workspace's own root manifest, or a
  // workspace member like a playground app) never belongs in this list —
  // `npm`/`pnpm publish` would just refuse it, so there's nothing to check
  // against the registry or offer in the checkbox.
  const allRepos = (await inspectRepos(discoverPackages(config))).filter((r) => r.version && !r.private)
  if (allRepos.length === 0) {
    console.log(pc.yellow('No repos found.'))
    return
  }

  heading('Publish to npm')

  // Narrowed to --packages up front (a no-op when it wasn't given) — no
  // reason to hit the registry for, or print the status of, packages
  // nobody asked to publish.
  const repos = filterByNames(allRepos, packages)
  if (repos.length === 0) {
    console.log(pc.dim('Nothing selected.'))
    return
  }

  console.log(pc.dim(`Checking ${repos.length} package(s) against the registry...`))
  // Also fetches each repo's origin default branch (once per physical repo
  // — a pnpm workspace's several members share one fetch) so the check
  // below can compare local against origin too, not just against npm.
  // Purely informational: `publish` never gates on git state (see
  // --no-git-checks further down) and this doesn't change that — it just
  // surfaces a mismatch that's otherwise easy to miss (wrong branch
  // checked out, an uncommitted edit, a repo that's behind origin).
  const uniqueRepos = [...new Map(repos.map((r) => [r.repoPath, r])).values()]
  await pMap(uniqueRepos, (r) => fetchOriginDefaultBranchAsync(r.repoPath, r.defaultBranch))

  // Each repo's registry lookup is a real network round trip — running them
  // all at once instead of one at a time is where this actually pays off.
  // Printed as each one resolves, so the order below reflects how fast the
  // registry answered, not the package list's order.
  const withRegistry = await pMap(repos, async (r) => {
    const [published, originVersion] = await Promise.all([fetchPublishedVersionAsync(r), readOriginVersionAsync(r)])
    const needsPublish = published !== r.version
    const resolvedDistTag = distTagFor(r.version, distTag)
    const originNote = originVersion != null && originVersion !== r.version ? pc.yellow(` (origin has ${originVersion})`) : ''
    console.log(
      pc.dim(`  ${r.dir}: registry ${published ?? '(not published)'} ${needsPublish ? '≠' : '='} local ${r.version}`) +
        originNote,
    )
    return { ...r, published, needsPublish, originVersion, distTag: resolvedDistTag }
  })

  const selected = await selectPackages({
    items: withRegistry,
    // repos above is already the exact --packages match — passing those
    // same dir names back through here just skips the checkbox (as
    // before) without filterByNames re-warning about anything, since
    // there's nothing left for it to not find.
    packages: packages ? withRegistry.map((r) => r.dir) : undefined,
    message: 'Pick packages to publish:',
    buildChoice: (all) => {
      const columns = [
        { value: (r) => r.dir },
        { value: (r) => r.published ?? '(none)', style: (r, t) => pc.dim(t) },
        { value: () => '→', style: (r, t) => pc.dim(t) },
        { value: (r) => r.version, style: (r, t) => (r.needsPublish ? pc.green(t) : pc.dim(t)) },
      ]
      const widths = columnWidths(all, columns)
      return (r) => ({
        name:
          formatRow(r, columns, widths) +
          (r.needsPublish ? '' : pc.dim('  (already up to date)')) +
          (r.distTag ? pc.cyan(`  [dist-tag: ${r.distTag}]`) : '') +
          (r.originVersion != null && r.originVersion !== r.version ? pc.yellow(`  ⚠ origin has ${r.originVersion}`) : ''),
        value: r,
        checked: r.needsPublish,
      })
    },
  })

  if (selected.length === 0) {
    console.log(pc.dim('Nothing selected.'))
    return
  }

  warnIfPublishingOffBranch(selected)

  if (!yes) {
    const proceed = await confirm({
      message: `Publish ${selected.length} package(s) to npm?${dryRun ? ' (dry run — nothing will actually be published)' : ''}`,
      default: true,
    })
    if (!proceed) {
      console.log(pc.dim('Cancelled.'))
      return
    }
  }

  if (!dryRun && !(await ensureNpmLogin())) return
  if (!(await ensureWorkspacesInstalled(selected))) return

  let index = 0
  for (const repo of selected) {
    index += 1
    stepHeading(index, selected.length, `${repo.name}@${repo.version}`)
    await publishOne(repo, { dryRun })
  }
}

// Publish never gates on git state (see --no-git-checks below) — it reads
// straight off whatever's on disk, same as a plain `npm publish` always
// has. That's deliberate (see doctor.js: this CLI doesn't restrict what a
// user can do), but it does mean a branch switch or an uncommitted edit
// silently changes what gets published without origin knowing anything
// about it — easy to miss, worth surfacing right before the confirm
// prompt. Purely informational, same spirit as the origin-version mismatch
// note printed above: nothing here blocks or skips a package.
function warnIfPublishingOffBranch(selected) {
  for (const r of selected) {
    if (r.branch !== r.defaultBranch) {
      warn(`${r.dir} is on branch ${r.branch ?? '(detached)'}, not ${r.defaultBranch} — publishing what's on disk anyway.`)
    }
    if (!r.clean) {
      warn(`${r.dir} has uncommitted changes — publishing what's on disk anyway.`)
    }
  }
}

// The actual publish of one package — split out from publishCommand's loop
// so `polyrepo bump --publish` can reuse it right after tagging, without
// reimplementing the npm-vs-pnpm / dist-tag / dry-run logic. Callers are
// responsible for ensureNpmLogin/ensureWorkspacesInstalled beforehand (once
// per batch, not per package) and for printing their own step header.
export async function publishOne(repo, { dryRun = false, distTag } = {}) {
  const resolvedDistTag = repo.distTag ?? distTagFor(repo.version, distTag)
  const tagArgs = resolvedDistTag ? ['--tag', resolvedDistTag] : []
  // Real terminal, not captured — npm/pnpm publish can stop for a 2FA/OTP
  // prompt, and --dry-run does a full dry run including packing, so this
  // exercises the same path as a real publish. A pnpm workspace member
  // publishes through `pnpm publish` instead of `npm publish` — pnpm
  // rewrites a "workspace:*" dependency on a sibling package to its real
  // version when packing, which npm doesn't understand at all.
  // --no-git-checks matches npm's own (looser) behavior: pnpm publish
  // otherwise does its own branch/clean-tree checks on top of this tool's
  // own, which would newly block publishes that npm never blocked.
  const result = repo.isWorkspaceMember
    ? pnpm(repo.path, ['publish', '--no-git-checks', ...tagArgs, ...(dryRun ? ['--dry-run'] : [])], { interactive: true })
    : npm(repo.path, ['publish', ...tagArgs, ...(dryRun ? ['--dry-run'] : [])], { interactive: true })
  if (!result.ok) {
    fail(`npm publish failed (exit ${result.status}).`)
    return false
  }
  ok(`Published ${repo.name}@${repo.version}${resolvedDistTag ? ` (dist-tag: ${resolvedDistTag})` : ''}${dryRun ? ' (dry run).' : '.'}`)
  return true
}

// `pnpm publish` resolves a workspace member's "workspace:*" dependency on
// a sibling package by reading that sibling's linked copy in node_modules
// — without a prior `pnpm install`, it fails outright with
// ERR_PNPM_CANNOT_RESOLVE_WORKSPACE_PROTOCOL instead of publishing anything
// (a missing/never-run install, or one that's gone stale since — a
// dependency added or bumped locally without reinstalling — both look the
// same to pnpm). Run once per distinct repo among the selection (not per
// package — a repeat run against an already-current install is a fast
// no-op) right before publishing, so this is caught up front with one
// clear message instead of failing member-by-member partway through.
export async function ensureWorkspacesInstalled(selected) {
  const repoPaths = [...new Set(selected.filter((r) => r.isWorkspaceMember).map((r) => r.repoPath))]
  for (const repoPath of repoPaths) {
    console.log(pc.dim(`Running \`pnpm install\` in ${repoPath} to link workspace dependencies...`))
    const result = pnpm(repoPath, ['install'], { interactive: true })
    if (!result.ok) {
      fail(`pnpm install failed in ${repoPath} (exit ${result.status}) — aborting before publishing anything.`)
      return false
    }
  }
  return true
}

// Without this, a batch of several packages would only find out about a
// missing/expired npm login at the very end of the first `npm publish` —
// after everything before it in the run (fetch, checkout, confirmation)
// already succeeded. Checked once for the whole batch, not per package,
// since npm auth isn't per-repo. `npm login` needs a real terminal — it
// can open a browser for npm's web-based OTP flow, or prompt directly.
export async function ensureNpmLogin() {
  if (npm('.', ['whoami'], { quiet: true }).ok) return true

  warn('Not logged in to npm — running `npm login` first.')
  npm('.', ['login'], { interactive: true })

  if (npm('.', ['whoami'], { quiet: true }).ok) {
    ok('Logged in to npm.')
    return true
  }

  fail('npm login did not succeed — aborting before publishing anything.')
  return false
}
