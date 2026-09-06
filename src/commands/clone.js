import path from 'node:path'
import { confirm } from '@inquirer/prompts'
import pc from 'picocolors'
import { discoverRepos } from '../repos.js'
import { loadConfig } from '../loadConfig.js'
import { gh, git } from '../exec.js'
import { selectPackages } from '../selectPackages.js'
import { heading, stepHeading, ok, fail, columnWidths, formatRow } from '../ui.js'

// Diffs a GitHub org/user's repo list against what's already present under
// one root directory, then clones whatever's missing. `--org` is taken
// per-invocation rather than stored in polyrepo.config.json — the config's
// roots/packages are about *where local repos live*, not which GitHub
// account they come from, and one root can plausibly mix repos from
// several accounts.
export async function cloneCommand({
  configPath,
  org,
  root,
  includeArchived = false,
  packages,
  yes = false,
  dryRun = false,
} = {}) {
  const config = loadConfig({ configPath })
  const targetRoot = root ? path.resolve(root) : config.roots[0]
  if (!targetRoot) {
    console.log(pc.red('No root to clone into — pass --root, or run `polyrepo setup` to add one first.'))
    return
  }

  heading(`Clone missing repos from ${org}`)
  console.log(pc.dim(`Target root: ${targetRoot}`))

  const listResult = gh('.', ['repo', 'list', org, '--limit', '200', '--json', 'name,url,isArchived'], {
    quiet: true,
  })
  if (!listResult.ok) {
    fail(`Could not list repos for "${org}" — is \`gh\` authenticated and the name correct?`)
    return
  }

  let remoteRepos
  try {
    remoteRepos = JSON.parse(listResult.stdout)
  } catch {
    fail('Could not parse `gh repo list` output.')
    return
  }

  if (!includeArchived) remoteRepos = remoteRepos.filter((r) => !r.isArchived)

  const existing = new Set(discoverRepos({ roots: [targetRoot], packages: [] }).map((r) => r.dir.toLowerCase()))
  const missing = remoteRepos.filter((r) => !existing.has(r.name.toLowerCase()))

  if (missing.length === 0) {
    console.log(pc.green(`Nothing to clone — every repo in ${org} already exists under ${targetRoot}.`))
    return
  }

  const selected = await selectPackages({
    items: missing.map((r) => ({ dir: r.name, url: r.url })),
    packages,
    message: `Pick repos to clone into ${targetRoot}:`,
    buildChoice: (all) => {
      const columns = [{ value: (r) => r.dir }]
      const widths = columnWidths(all, columns)
      return (r) => ({ name: formatRow(r, columns, widths), value: r, checked: true })
    },
  })

  if (selected.length === 0) {
    console.log(pc.dim('Nothing selected.'))
    return
  }

  if (!yes) {
    const proceed = await confirm({
      message: `Clone ${selected.length} repo(s) into ${targetRoot}?${dryRun ? ' (dry run — nothing will actually be cloned)' : ''}`,
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
    stepHeading(index, selected.length, repo.dir)
    const dest = path.join(targetRoot, repo.dir)
    const result = git('.', ['clone', repo.url, dest], { mutating: true, dryRun })
    if (!result.ok) fail(`git clone failed (exit ${result.status}).`)
    else ok(dryRun ? `Would clone into ${dest}.` : `Cloned into ${dest}.`)
  }

  if (!dryRun && !config.roots.some((r) => path.resolve(r).toLowerCase() === targetRoot.toLowerCase())) {
    console.log('')
    console.log(pc.yellow(`Tip: ${targetRoot} isn't in your config yet — run \`polyrepo setup\` to add it as a root.`))
  }
}
