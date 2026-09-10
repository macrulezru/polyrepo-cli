import { confirm } from '@inquirer/prompts'
import pc from 'picocolors'
import { discoverPackages, inspectRepos } from '../repos.js'
import { loadConfig } from '../loadConfig.js'
import { run } from '../exec.js'
import { selectPackages } from '../selectPackages.js'
import { heading, stepHeading, ok, fail, columnWidths, formatRow } from '../ui.js'

// Runs one package at a time (not in parallel, unlike the read-only checks
// elsewhere in this CLI) and always with a real terminal (stdio: 'inherit')
// — the whole point is running an arbitrary command, which might itself
// want a TTY (colored output, its own progress bar, an interactive
// prompt), and interleaved output from several packages running the same
// command at once would be unreadable anyway.
export async function execCommand({ configPath, packages, yes = false, bail = false, cmd } = {}) {
  const config = loadConfig({ configPath })
  const repos = await inspectRepos(discoverPackages(config))
  if (repos.length === 0) {
    console.log(pc.yellow('No repos found.'))
    return
  }

  const label = cmd.join(' ')
  heading(`Run: ${label}`)

  const selected = await selectPackages({
    items: repos,
    packages,
    message: 'Pick packages to run the command in:',
    buildChoice: (all) => {
      const columns = [
        { value: (r) => r.dir },
        { value: (r) => r.version ?? '?', style: (r, t) => pc.dim(t) },
      ]
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
      message: `Run \`${label}\` in ${selected.length} package(s)?`,
      default: true,
    })
    if (!proceed) {
      console.log(pc.dim('Cancelled.'))
      return
    }
  }

  const failed = []
  let index = 0
  for (const repo of selected) {
    index += 1
    stepHeading(index, selected.length, repo.dir)
    const result = run(repo.path, cmd[0], cmd.slice(1), { interactive: true })
    if (!result.ok) {
      failed.push(repo.dir)
      fail(`Exited with code ${result.status}.`)
      if (bail) break
    } else {
      ok('Done.')
    }
  }

  if (failed.length > 0) {
    console.log('')
    console.log(pc.red(`${failed.length}/${selected.length} package(s) failed: ${failed.join(', ')}`))
    process.exitCode = 1
  }
}
