import pc from 'picocolors'
import { discoverRepos, inspectRepos } from '../repos.js'
import { loadConfig } from '../loadConfig.js'
import { npmAsync } from '../exec.js'
import { pMap } from '../pMap.js'
import { heading, printTable } from '../ui.js'
import { startSpinner } from '../spinner.js'
import { filterByNames } from '../filterByNames.js'

const SEVERITY_COLOR = {
  critical: (t) => pc.bold(pc.red(t)),
  high: pc.red,
  moderate: pc.yellow,
  low: pc.dim,
  info: pc.dim,
}
const SEVERITY_RANK = { critical: 0, high: 1, moderate: 2, low: 3, info: 4 }

// `fixAvailable` from `npm audit --json` is `false` (no fix), `true` (a
// fix exists within the current dependency's range), or an object
// naming the package/version a fix would actually resolve to (which can
// be a semver-major bump of a *different* top-level dependency than the
// vulnerable one) — each reads differently enough to spell out rather
// than collapsing to a single yes/no.
function describeFix(fixAvailable) {
  if (fixAvailable === false) return 'no'
  if (fixAvailable === true) return 'yes'
  if (fixAvailable && typeof fixAvailable === 'object') {
    const via = `${fixAvailable.name}@${fixAvailable.version}`
    return fixAvailable.isSemVerMajor ? `yes (major: ${via})` : `yes (${via})`
  }
  return '—'
}

export async function auditCommand({ configPath, packages } = {}) {
  const config = loadConfig({ configPath })
  const repos = filterByNames((await inspectRepos(discoverRepos(config))).filter((r) => r.version), packages)
  if (repos.length === 0) {
    console.log(pc.yellow('No repos found.'))
    return
  }

  heading('Security audit')

  const spinner = startSpinner(`Checking ${repos.length} package(s) for vulnerabilities...`)
  const results = await pMap(repos, async (r) => {
    // Like `npm outdated --json`, `npm audit --json` exits 1 whenever it
    // finds anything — that's normal, not a failure, so success is judged
    // by whether stdout is parseable JSON rather than the exit code.
    const result = await npmAsync(r.path, ['audit', '--json'])
    if (!result.stdout) return { repo: r, entries: [], failed: !result.ok }
    try {
      const parsed = JSON.parse(result.stdout)
      return { repo: r, entries: Object.values(parsed.vulnerabilities ?? {}) }
    } catch {
      return { repo: r, entries: [], failed: true }
    }
  })
  spinner.stop()

  const failedRepos = results.filter((r) => r.failed).map((r) => r.repo.dir)
  if (failedRepos.length > 0) {
    console.log(pc.yellow(`Could not check: ${failedRepos.join(', ')}`))
  }

  const rows = results.flatMap(({ repo, entries }) => {
    // Sorted within each repo (not globally) so the most urgent findings
    // surface first without breaking printTable's per-repo grouping, which
    // relies on rows for the same repo staying adjacent.
    const sorted = [...entries].sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9))
    return sorted.map((v) => ({
      dir: repo.dir,
      name: v.name,
      severity: v.severity ?? 'unknown',
      direct: v.isDirect ? 'direct' : 'transitive',
      fix: describeFix(v.fixAvailable),
    }))
  })

  if (rows.length === 0) {
    console.log(pc.green('No known vulnerabilities.'))
    return
  }

  const packageCount = new Set(rows.map((r) => r.dir)).size
  const criticalOrHighCount = rows.filter((r) => r.severity === 'critical' || r.severity === 'high').length
  const vulnWord = rows.length === 1 ? 'vulnerability' : 'vulnerabilities'
  const summary = `${rows.length} ${vulnWord} across ${packageCount} package(s)`
  console.log(pc.dim(summary) + (criticalOrHighCount > 0 ? pc.red(`, ${criticalOrHighCount} of them critical/high severity`) : ''))

  printTable(
    rows,
    [
      { label: 'Package', value: (r) => r.dir },
      { label: 'Dependency', value: (r) => r.name },
      { label: 'Severity', value: (r) => r.severity, style: (r, t) => (SEVERITY_COLOR[r.severity] ?? pc.dim)(t) },
      { label: 'Type', value: (r) => r.direct },
      { label: 'Fix available', value: (r) => r.fix },
    ],
    { groupBy: (r) => r.dir },
  )
}
