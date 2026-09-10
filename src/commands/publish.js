import { confirm } from '@inquirer/prompts'
import pc from 'picocolors'
import { discoverPackages, inspectRepos } from '../repos.js'
import { loadConfig } from '../loadConfig.js'
import { npm, pnpm } from '../exec.js'
import { fetchPublishedVersionAsync } from '../registry.js'
import { selectPackages } from '../selectPackages.js'
import { filterByNames } from '../filterByNames.js'
import { pMap } from '../pMap.js'
import { heading, stepHeading, ok, fail, warn, columnWidths, formatRow } from '../ui.js'

export async function publishCommand({ configPath, packages, yes = false, dryRun = false } = {}) {
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
  // Each repo's registry lookup is a real network round trip — running them
  // all at once instead of one at a time is where this actually pays off.
  // Printed as each one resolves, so the order below reflects how fast the
  // registry answered, not the package list's order.
  const withRegistry = await pMap(repos, async (r) => {
    const published = await fetchPublishedVersionAsync(r)
    const needsPublish = published !== r.version
    console.log(
      pc.dim(`  ${r.dir}: registry ${published ?? '(not published)'} ${needsPublish ? '≠' : '='} local ${r.version}`),
    )
    return { ...r, published, needsPublish }
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
        name: formatRow(r, columns, widths) + (r.needsPublish ? '' : pc.dim('  (already up to date)')),
        value: r,
        checked: r.needsPublish,
      })
    },
  })

  if (selected.length === 0) {
    console.log(pc.dim('Nothing selected.'))
    return
  }

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
      ? pnpm(repo.path, ['publish', '--no-git-checks', ...(dryRun ? ['--dry-run'] : [])], { interactive: true })
      : npm(repo.path, ['publish', ...(dryRun ? ['--dry-run'] : [])], { interactive: true })
    if (!result.ok) fail(`npm publish failed (exit ${result.status}).`)
    else ok(`Published ${repo.name}@${repo.version}${dryRun ? ' (dry run).' : '.'}`)
  }
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
async function ensureWorkspacesInstalled(selected) {
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
async function ensureNpmLogin() {
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
