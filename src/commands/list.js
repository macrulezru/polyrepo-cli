import pc from 'picocolors'
import { discoverPackages, inspectRepos } from '../repos.js'
import { loadConfig } from '../loadConfig.js'
import { tagFor, tagExistsAsync } from '../tags.js'
import { providerFor } from '../providers/index.js'
import { fetchPublishedVersionAsync } from '../registry.js'
import { fetchOriginDefaultBranchAsync, readOriginVersionAsync } from '../remoteVersion.js'
import { findStaleLocalDeps } from '../crossDeps.js'
import { pMap } from '../pMap.js'
import { printTable, heading, ok, fail } from '../ui.js'
import { startSpinner } from '../spinner.js'
import { EXPORT_FORMATS, exportTable, inferExportFormat, writeExport } from '../export.js'

export async function listCommand({ configPath, quick = false, showPath = false, format, output } = {}) {
  if (format && !EXPORT_FORMATS.includes(format)) {
    fail(`Unknown --format "${format}" — expected one of: ${EXPORT_FORMATS.join(', ')}.`)
    return
  }
  if (format && !output) {
    fail('--format only matters together with --output <path> — nothing to export it to.')
    return
  }

  const config = loadConfig({ configPath })
  const repos = discoverPackages(config)
  if (repos.length === 0) {
    console.log(pc.yellow('No repos found.'))
    return
  }

  heading(`Packages (${repos.length})`)

  const gitSpinner = startSpinner(`Checking ${repos.length} package(s) — version, branch, git status...`)
  const rows = await inspectRepos(repos)
  gitSpinner.stop()

  const columns = [
    { label: 'Package', value: (r) => r.dir },
    ...(showPath ? [{ label: 'Path', value: (r) => r.path, style: (r, text) => pc.dim(text) }] : []),
    // Renamed from the original "Version" now that "Origin" sits right next
    // to it (added below, only under !quick) — local, origin's default
    // branch, and npm are three genuinely independent sources of truth for
    // a package's version (nothing keeps them in sync automatically; see
    // the "Origin" column below), so the label needs to say which one this
    // is rather than implying it's the only one.
    { label: 'Local', value: (r) => r.version ?? '?' },
    {
      label: 'Branch',
      value: (r) => r.branch ?? '(detached)',
      style: (r, text) => (r.branch === r.defaultBranch ? pc.dim(text) : pc.yellow(text)),
    },
    {
      label: 'Git',
      value: (r) => (r.clean ? 'clean' : 'dirty'),
      style: (r, text) => (r.clean ? pc.dim(text) : pc.red(text)),
    },
  ]

  let finalRows = rows

  if (!quick) {
    // Cross-package dependency drift is cheap (no network — just the
    // package.jsons already on disk) and doesn't vary per package the way
    // tag/release/npm do, so it's computed once for everyone rather than
    // inside the per-repo pMap below.
    const staleByRepo = new Map()
    for (const issue of findStaleLocalDeps(rows)) {
      staleByRepo.set(issue.repo.dir, (staleByRepo.get(issue.repo.dir) ?? 0) + 1)
    }

    // One `git fetch` per physical repo (not per package — a pnpm
    // workspace's several members all share the same origin/defaultBranch)
    // so the version read below reflects origin right now, independent of
    // whatever happens to be checked out locally (see remoteVersion.js).
    const uniqueRepos = [...new Map(rows.map((r) => [r.repoPath, r])).values()]
    const originSpinner = startSpinner(`Fetching ${uniqueRepos.length} repo(s) to compare against origin...`)
    await pMap(uniqueRepos, (r) => fetchOriginDefaultBranchAsync(r.repoPath, r.defaultBranch))
    originSpinner.stop()

    const registrySpinner = startSpinner(`Checking ${rows.length} package(s) for tags, releases, and the registry...`)
    const withReleaseInfo = await pMap(rows, async (r) => {
      const tag = tagFor(r)
      // A private package (workspace root, or a member like a playground
      // app) is never published — skip the registry round trip for it
      // rather than reporting a misleading "unpublished".
      const [tagged, published, originVersion] = await Promise.all([
        tagExistsAsync(r, tag),
        r.private ? Promise.resolve(null) : fetchPublishedVersionAsync(r),
        readOriginVersionAsync(r),
      ])
      const provider = tagged ? providerFor(r, config) : null
      const released = provider ? await provider.releaseExistsAsync(r, tag) : false
      return { ...r, tag, tagged, released, published, originVersion, staleDeps: staleByRepo.get(r.dir) ?? 0 }
    })
    registrySpinner.stop()

    columns.push(
      {
        label: 'Origin',
        value: (r) => r.originVersion ?? '?',
        style: (r, text) => (r.originVersion == null || r.originVersion !== r.version ? pc.yellow(text) : pc.dim(text)),
      },
      {
        label: 'Tag',
        value: (r) => (r.tagged ? r.tag : '—'),
        style: (r, text) => pc.dim(text),
      },
      {
        label: 'Release',
        value: (r) => (!r.tagged ? '—' : r.released ? '✓' : '✗'),
        style: (r, text) => (r.released ? pc.green(text) : pc.dim(text)),
      },
      {
        // Shows the actual published version number rather than collapsing
        // a match down to a bare ✓ — same reasoning as the Origin column
        // right above it: three independent sources for one package's
        // version (Local, Origin, npm), so each one should show the number
        // it actually has, not just whether it agrees with Local.
        label: 'npm',
        value: (r) => (r.private ? 'private' : r.published ?? 'unpublished'),
        style: (r, text) => (r.private ? pc.dim(text) : r.published === r.version ? pc.green(text) : pc.yellow(text)),
      },
      {
        label: 'Deps',
        value: (r) => (r.staleDeps > 0 ? `⚠ ${r.staleDeps}` : '✓'),
        style: (r, text) => (r.staleDeps > 0 ? pc.yellow(text) : pc.dim(text)),
      },
    )

    finalRows = withReleaseInfo
  }

  printTable(finalRows, columns)

  if (output) {
    const resolvedFormat = format ?? inferExportFormat(output)
    const savedPath = writeExport(output, exportTable(finalRows, columns, resolvedFormat))
    ok(`Saved ${resolvedFormat.toUpperCase()} to ${savedPath}.`)
  }
}
