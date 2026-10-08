import pc from 'picocolors'
import { discoverPackages, inspectRepos } from '../repos.js'
import { loadConfig } from '../loadConfig.js'
import { selectPackages } from '../selectPackages.js'
import { changedFiles, planSave, saveChanges } from '../saveChanges.js'
import { heading, stepHeading, ok, fail, columnWidths, formatRow } from '../ui.js'
import { confirm, input, line, setExitCode } from '../runtime.js'

const DEFAULT_MESSAGE = 'chore: update dependencies'

function describeTarget(plan) {
  if (!plan.onDefault) return `the current branch ${plan.current ?? '(detached)'}`
  if (plan.mode === 'direct') return `${plan.defaultBranch} directly`
  return `a new branch ${plan.branchName} and a ${plan.requestLabel} into ${plan.defaultBranch}`
}

export async function commitCommand({
  configPath,
  packages,
  message,
  scope = 'manifest',
  mode = 'auto',
  push = true,
  pr = true,
  branch,
  yes = false,
  dryRun = false,
  stay = false,
} = {}) {
  if (!['manifest', 'all'].includes(scope)) {
    fail(`Unknown --scope "${scope}" — expected "manifest" or "all".`)
    setExitCode(2)
    return
  }
  if (!['auto', 'direct', 'branch'].includes(mode)) {
    fail(`Unknown --mode "${mode}" — expected "auto", "direct" or "branch".`)
    setExitCode(2)
    return
  }

  const config = loadConfig({ configPath })
  const repos = (await inspectRepos(discoverPackages(config))).map((repo) => ({
    ...repo,
    files: changedFiles(repo, scope),
  }))
  if (repos.length === 0) {
    line(pc.yellow('No repos found.'))
    return
  }

  heading('Commit changes')

  const withChanges = repos.filter((repo) => repo.files.length > 0)
  if (withChanges.length === 0) {
    ok(
      scope === 'manifest'
        ? 'No package has uncommitted changes in package.json or the lock files.'
        : 'No package has uncommitted changes to tracked files.',
    )
    return
  }

  const selected = await selectPackages({
    items: withChanges,
    packages: packages ? withChanges.map((repo) => repo.dir) : undefined,
    message: 'Pick packages to commit:',
    buildChoice: (all) => {
      const columns = [
        { value: (repo) => repo.dir },
        { value: (repo) => repo.branch ?? '(detached)', style: (repo, text) => pc.dim(text) },
        { value: (repo) => repo.files.join(', '), style: (repo, text) => pc.dim(text) },
      ]
      const widths = columnWidths(all, columns)
      return (repo) => ({ name: formatRow(repo, columns, widths), value: repo, checked: true })
    },
  })
  if (selected.length === 0) {
    line(pc.dim('Nothing selected.'))
    return
  }

  const text =
    message && message.trim() !== ''
      ? message.trim()
      : yes
        ? DEFAULT_MESSAGE
        : await input({ message: 'Commit message:', default: DEFAULT_MESSAGE })

  let index = 0
  let failed = 0
  const requests = []
  for (const repo of selected) {
    index += 1
    stepHeading(index, selected.length, repo.dir)
    const plan = await planSave(repo, config, { scope, message: text, mode, branchName: branch })
    line(pc.dim(`  ${plan.files.join(', ')} → ${describeTarget(plan)}`))

    if (!yes) {
      const proceed = await confirm({
        message: `Commit ${plan.files.length} file(s) to ${describeTarget(plan)}?${dryRun ? ' (dry run)' : ''}`,
        default: true,
      })
      if (!proceed) {
        line(pc.dim('  Skipped.'))
        continue
      }
    }

    const result = await saveChanges(repo, config, { message: text, scope, mode, push, openPr: pr, branchName: branch, dryRun, stay })
    if (!result.ok) failed += 1
    else if (result.url) requests.push({ dir: repo.dir, url: result.url })
  }

  if (requests.length > 0) {
    line('')
    line(pc.bold('Open for review:'))
    for (const request of requests) line(`  ${request.dir}: ${pc.cyan(request.url)}`)
  }
  if (failed > 0) setExitCode(1)
}
