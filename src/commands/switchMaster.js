import { confirm } from '@inquirer/prompts'
import pc from 'picocolors'
import { discoverRepos, inspectRepos } from '../repos.js'
import { MASTER_BRANCH } from '../config.js'
import { loadConfig } from '../loadConfig.js'
import { syncMaster } from '../masterSync.js'
import { selectPackages } from '../selectPackages.js'
import { heading, stepHeading, ok, fail, warn, columnWidths, formatRow } from '../ui.js'
import { startSpinner } from '../spinner.js'

export async function switchMasterCommand({ configPath, packages, yes = false } = {}) {
  const config = loadConfig({ configPath })
  const discovered = discoverRepos(config)
  if (discovered.length === 0) {
    console.log(pc.yellow('No repos found.'))
    return
  }

  heading(`Switch to ${MASTER_BRANCH}`)

  const spinner = startSpinner(`Checking ${discovered.length} package(s)...`)
  const repos = await inspectRepos(discovered)
  spinner.stop()

  const selected = await selectPackages({
    items: repos,
    packages,
    message: 'Pick repos to switch to master and update:',
    buildChoice: (all) => {
      const columns = [{ value: (r) => r.dir }]
      const widths = columnWidths(all, columns)
      return (r) => ({
        name:
          formatRow(r, columns, widths) +
          pc.dim(`  (currently on: ${r.branch ?? '(detached)'}${r.clean ? '' : ', dirty'})`),
        value: r,
        checked: r.branch !== MASTER_BRANCH,
      })
    },
  })

  if (selected.length === 0) {
    console.log(pc.dim('Nothing selected.'))
    return
  }

  if (!yes) {
    const proceed = await confirm({
      message: `Switch ${selected.length} repo(s) to ${MASTER_BRANCH} and fast-forward?`,
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

    if (!repo.clean) {
      warn(`Working tree is dirty — skipping to avoid discarding local changes.`)
      continue
    }

    const result = syncMaster(repo)
    if (!result.ok) {
      fail(result.message)
      continue
    }

    ok(`Now on ${MASTER_BRANCH}, up to date with origin.`)
  }
}
