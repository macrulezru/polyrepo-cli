import { confirm } from '@inquirer/prompts'
import pc from 'picocolors'
import { discoverRepos, inspectRepos } from '../repos.js'
import { loadConfig } from '../loadConfig.js'
import { npm } from '../exec.js'
import { fetchPublishedVersionAsync } from '../registry.js'
import { selectPackages } from '../selectPackages.js'
import { pMap } from '../pMap.js'
import { heading, stepHeading, ok, fail, columnWidths, formatRow } from '../ui.js'

export async function publishCommand({ configPath, packages, yes = false, dryRun = false } = {}) {
  const config = loadConfig({ configPath })
  const repos = (await inspectRepos(discoverRepos(config))).filter((r) => r.version)
  if (repos.length === 0) {
    console.log(pc.yellow('No repos found.'))
    return
  }

  heading('Publish to npm')

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
    packages,
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

  let index = 0
  for (const repo of selected) {
    index += 1
    stepHeading(index, selected.length, `${repo.name}@${repo.version}`)
    // Real terminal, not captured — npm publish can stop for a 2FA/OTP
    // prompt, and --dry-run (npm's own flag) does a full dry run including
    // packing, so this exercises the same path as a real publish.
    const result = npm(repo.path, ['publish', ...(dryRun ? ['--dry-run'] : [])], { interactive: true })
    if (!result.ok) fail(`npm publish failed (exit ${result.status}).`)
    else ok(`Published ${repo.name}@${repo.version}${dryRun ? ' (dry run).' : '.'}`)
  }
}
