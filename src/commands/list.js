import pc from 'picocolors'
import { discoverRepos, inspectRepos } from '../repos.js'
import { MASTER_BRANCH } from '../config.js'
import { loadConfig } from '../loadConfig.js'
import { tagName, tagExistsAsync } from '../tags.js'
import { releaseExistsAsync } from '../release.js'
import { fetchPublishedVersionAsync } from '../registry.js'
import { findStaleLocalDeps } from '../crossDeps.js'
import { pMap } from '../pMap.js'
import { printTable, heading } from '../ui.js'
import { startSpinner } from '../spinner.js'

export async function listCommand({ configPath, quick = false, showPath = false } = {}) {
  const config = loadConfig({ configPath })
  const repos = discoverRepos(config)
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
      style: (r, text) => (r.branch === MASTER_BRANCH ? pc.dim(text) : pc.yellow(text)),
    },
    {
      label: 'Git',
      value: (r) => (r.clean ? 'clean' : 'dirty'),
      style: (r, text) => (r.clean ? pc.dim(text) : pc.red(text)),
    },
  ]

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
      const tag = tagName(r.version)
      const [tagged, published] = await Promise.all([tagExistsAsync(r, tag), fetchPublishedVersionAsync(r)])
      const released = tagged ? await releaseExistsAsync(r, tag) : false
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
        value: (r) => (r.published == null ? 'unpublished' : r.published === r.version ? '✓' : r.published),
        style: (r, text) => (r.published === r.version ? pc.green(text) : pc.yellow(text)),
      },
      {
        label: 'Deps',
        value: (r) => (r.staleDeps > 0 ? `⚠ ${r.staleDeps}` : '✓'),
        style: (r, text) => (r.staleDeps > 0 ? pc.yellow(text) : pc.dim(text)),
      },
    )

    printTable(withReleaseInfo, columns)
    return
  }

  printTable(rows, columns)
}
