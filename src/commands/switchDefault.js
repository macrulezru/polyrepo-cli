import { confirm } from '@inquirer/prompts'
import pc from 'picocolors'
import { discoverRepos, inspectRepos } from '../repos.js'
import { loadConfig } from '../loadConfig.js'
import { syncDefaultBranch } from '../defaultBranchSync.js'
import { selectPackages } from '../selectPackages.js'
import { heading, stepHeading, ok, fail, warn, columnWidths, formatRow } from '../ui.js'
import { startSpinner } from '../spinner.js'

export async function switchDefaultCommand({ configPath, packages, yes = false, force = false, clean = false } = {}) {
  const config = loadConfig({ configPath })
  const discovered = discoverRepos(config)
  if (discovered.length === 0) {
    console.log(pc.yellow('No repos found.'))
    return
  }

  heading('Switch to default branch')

  const spinner = startSpinner(`Checking ${discovered.length} package(s)...`)
  const repos = await inspectRepos(discovered)
  spinner.stop()

  const selected = await selectPackages({
    items: repos,
    packages,
    message: 'Pick repos to switch to their default branch and update:',
    buildChoice: (all) => {
      const columns = [{ value: (r) => r.dir }]
      const widths = columnWidths(all, columns)
      return (r) => ({
        name:
          formatRow(r, columns, widths) +
          pc.dim(
            `  (currently on: ${r.branch ?? '(detached)'}${r.clean ? '' : ', dirty'}${
              r.branch !== r.defaultBranch ? `, default: ${r.defaultBranch}` : ''
            })`,
          ) +
          (force && !r.clean ? pc.red(`  will discard uncommitted changes${clean ? ' and untracked files' : ''}`) : ''),
        value: r,
        checked: r.branch !== r.defaultBranch,
      })
    },
  })

  if (selected.length === 0) {
    console.log(pc.dim('Nothing selected.'))
    return
  }

  const dirtyCount = selected.filter((r) => !r.clean).length

  if (!yes) {
    const proceed = await confirm({
      message:
        force && dirtyCount > 0
          ? `Switch ${selected.length} repo(s) to their default branch — ${dirtyCount} of them dirty, their uncommitted changes${
              clean ? ' and untracked files' : ''
            } will be permanently discarded. Continue?`
          : `Switch ${selected.length} repo(s) to their default branch and fast-forward?`,
      default: !force,
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

    if (!repo.clean && !force) {
      warn(`Working tree is dirty — skipping to avoid discarding local changes.`)
      continue
    }

    const result = syncDefaultBranch(repo, { force, clean })
    if (!result.ok) {
      fail(result.message)
      continue
    }

    ok(
      force && !repo.clean
        ? `Discarded local changes${clean ? ' and untracked files' : ''} — now on ${repo.defaultBranch}, matching origin.`
        : `Now on ${repo.defaultBranch}, up to date with origin.`,
    )
  }
}
