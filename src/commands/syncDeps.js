import { checkbox, confirm } from '@inquirer/prompts'
import pc from 'picocolors'
import { discoverPackages, inspectRepos } from '../repos.js'
import { loadConfig } from '../loadConfig.js'
import { findStaleLocalDeps } from '../crossDeps.js'
import { updatedRange, applyRangeUpdate } from '../depRanges.js'
import { heading, ok, fail, columnWidths, formatRow, promptTheme } from '../ui.js'
import { startSpinner } from '../spinner.js'

// `findStaleLocalDeps` (see doctor's "Cross-package dependencies" section,
// and the Deps column in `list`) already finds exactly this — a local
// package whose dependency range no longer matches another local package's
// current version — but every place that reports it stops at reporting.
// This is the write side: pick which of those stale ranges to fix, preview
// the exact before/after, and update package.json in place. Deliberately
// stops there — no commit, no push, no branch/PR — this only ever touches
// files on disk, same as running `npm audit fix` yourself; review and
// commit through your own normal git workflow (or `polyrepo exec -- git
// commit -am ...` across everything at once).
export async function syncDepsCommand({ configPath, packages, yes = false, dryRun = false } = {}) {
  const config = loadConfig({ configPath })

  // Every discovered package is needed here regardless of --packages —
  // finding a stale range requires knowing every local package's current
  // version, not just the ones being fixed. --packages narrows which
  // *dependent* packages' issues are offered below, same meaning as
  // everywhere else in this CLI.
  const spinner = startSpinner('Checking cross-package dependency ranges...')
  const allRepos = (await inspectRepos(discoverPackages(config))).filter((r) => r.version)
  const issues = findStaleLocalDeps(allRepos)
  spinner.stop()

  if (allRepos.length === 0) {
    console.log(pc.yellow('No repos found.'))
    return
  }

  heading('Sync local dependency ranges')

  const scoped = packages
    ? issues.filter((i) => packages.map((p) => p.toLowerCase()).includes(i.repo.dir.toLowerCase()))
    : issues

  if (scoped.length === 0) {
    ok(issues.length === 0 ? 'No stale local dependency references found.' : 'Nothing selected.')
    return
  }

  const withUpdate = scoped.map((issue) => ({ ...issue, newRange: updatedRange(issue.range, issue.localVersion) }))

  const columns = [
    { value: (i) => i.repo.dir },
    { value: (i) => i.depName, style: (i, t) => pc.dim(t) },
    { value: (i) => `"${i.range}"`, style: (i, t) => pc.red(t) },
    { value: () => '→', style: (i, t) => pc.dim(t) },
    { value: (i) => `"${i.newRange}"`, style: (i, t) => pc.green(t) },
  ]
  const widths = columnWidths(withUpdate, columns)

  let selected
  if (packages) {
    // --packages already narrowed which dependents to consider — acting on
    // every one of their issues, no checkbox, matches how every other
    // command treats an explicit --packages list.
    selected = withUpdate
    for (const issue of selected) console.log(`  ${formatRow(issue, columns, widths)}`)
  } else {
    const choices = withUpdate.map((issue) => ({ name: formatRow(issue, columns, widths), value: issue, checked: true }))
    selected = await checkbox({
      message: 'Pick stale dependency ranges to update:',
      pageSize: 20,
      theme: promptTheme,
      choices,
    })
  }

  if (selected.length === 0) {
    console.log(pc.dim('Nothing selected.'))
    return
  }

  if (!yes) {
    const proceed = await confirm({
      message: `Update ${selected.length} dependency range(s)?${dryRun ? ' (dry run — nothing will actually be written)' : ''}`,
      default: true,
    })
    if (!proceed) {
      console.log(pc.dim('Cancelled.'))
      return
    }
  }

  for (const issue of selected) {
    if (dryRun) {
      console.log(pc.magenta(`  [dry-run] would update ${issue.repo.dir}: "${issue.depName}" "${issue.range}" → "${issue.newRange}"`))
      continue
    }
    const result = applyRangeUpdate(issue.repo.pkgPath, issue.depName, issue.range, issue.newRange)
    if (!result.ok) fail(`${issue.repo.dir}: ${result.message}`)
    else ok(`${issue.repo.dir}: "${issue.depName}" "${issue.range}" → "${issue.newRange}"`)
  }
}
