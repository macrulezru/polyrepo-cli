import pc from 'picocolors'
import { discoverPackages, inspectRepos } from '../repos.js'
import { loadConfig } from '../loadConfig.js'
import { tagFor, tagExistsAsync } from '../tags.js'
import { providerFor } from '../providers/index.js'
import { fetchPublishedVersionAsync } from '../registry.js'
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
    { label: 'Version', value: (r) => r.version ?? '?' },
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

    const registrySpinner = startSpinner(`Checking ${rows.length} package(s) for tags, releases, and the registry...`)
    const withReleaseInfo = await pMap(rows, async (r) => {
      const tag = tagFor(r)
      // A private package (workspace root, or a member like a playground
      // app) is never published — skip the registry round trip for it
      // rather than reporting a misleading "unpublished".
      const [tagged, published] = await Promise.all([
        tagExistsAsync(r, tag),
        r.private ? Promise.resolve(null) : fetchPublishedVersionAsync(r),
      ])
      const provider = tagged ? providerFor(r, config) : null
      const released = provider ? await provider.releaseExistsAsync(r, tag) : false
      return { ...r, tag, tagged, released, published, staleDeps: staleByRepo.get(r.dir) ?? 0 }
    })
    registrySpinner.stop()

    columns.push(
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
        label: 'npm',
        value: (r) => (r.private ? 'private' : r.published == null ? 'unpublished' : r.published === r.version ? '✓' : r.published),
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
