import pc from 'picocolors'
import { discoverRepos, inspectRepos } from '../repos.js'
import { loadConfig } from '../loadConfig.js'
import { npmAsync } from '../exec.js'
import { pMap } from '../pMap.js'
import { heading, printTable } from '../ui.js'
import { startSpinner } from '../spinner.js'
import { filterByNames } from '../filterByNames.js'

export async function outdatedCommand({ configPath, packages } = {}) {
  const config = loadConfig({ configPath })
  const repos = filterByNames((await inspectRepos(discoverRepos(config))).filter((r) => r.version), packages)
  if (repos.length === 0) {
    console.log(pc.yellow('No repos found.'))
    return
  }

  heading('Outdated dependencies')

  const spinner = startSpinner(`Checking ${repos.length} package(s) for outdated dependencies...`)
  const results = await pMap(repos, async (r) => {
    // `npm outdated --json` exits 1 whenever it finds anything outdated —
    // that's normal, not a failure, so "did this work" is judged by
    // whether stdout is parseable JSON rather than the exit code.
    const result = await npmAsync(r.path, ['outdated', '--json'])
    if (!result.stdout) return { repo: r, entries: [], failed: !result.ok }
    try {
      return { repo: r, entries: Object.entries(JSON.parse(result.stdout)).map(([name, info]) => ({ name, ...info })) }
    } catch {
      return { repo: r, entries: [], failed: true }
    }
  })
  spinner.stop()

  const failedRepos = results.filter((r) => r.failed).map((r) => r.repo.dir)
  if (failedRepos.length > 0) {
    console.log(pc.yellow(`Could not check: ${failedRepos.join(', ')}`))
  }

  const rows = results.flatMap(({ repo, entries }) =>
    entries.map((e) => ({
      dir: repo.dir,
      name: e.name,
      current: e.current ?? '—',
      wanted: e.wanted ?? '—',
      latest: e.latest ?? '—',
    })),
  )

  if (rows.length === 0) {
    console.log(pc.green('Everything up to date.'))
    return
  }

  printTable(rows, [
    { label: 'Package', value: (r) => r.dir },
    { label: 'Dependency', value: (r) => r.name },
    { label: 'Current', value: (r) => r.current, style: (r, t) => pc.dim(t) },
    { label: 'Wanted', value: (r) => r.wanted },
    { label: 'Latest', value: (r) => r.latest, style: (r, t) => pc.yellow(t) },
  ])
}
