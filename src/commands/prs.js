import pc from 'picocolors'
import { discoverRepos } from '../repos.js'
import { loadConfig } from '../loadConfig.js'
import { ghAsync } from '../exec.js'
import { pMap } from '../pMap.js'
import { heading, printTable } from '../ui.js'
import { startSpinner } from '../spinner.js'
import { filterByNames } from '../filterByNames.js'

export async function prsCommand({ configPath, packages } = {}) {
  const config = loadConfig({ configPath })
  const repos = filterByNames(discoverRepos(config), packages)
  if (repos.length === 0) {
    console.log(pc.yellow('No repos found.'))
    return
  }

  heading('Open pull requests')

  const spinner = startSpinner(`Checking ${repos.length} package(s) for open pull requests...`)
  const results = await pMap(repos, async (r) => {
    const result = await ghAsync(r.path, [
      'pr',
      'list',
      '--state',
      'open',
      '--json',
      'number,title,headRefName,isDraft',
    ])
    if (!result.ok || !result.stdout) return { repo: r, prs: [] }
    try {
      return { repo: r, prs: JSON.parse(result.stdout) }
    } catch {
      return { repo: r, prs: [] }
    }
  })
  spinner.stop()

  const rows = results.flatMap(({ repo, prs }) =>
    prs.map((pr) => ({
      dir: repo.dir,
      number: `#${pr.number}`,
      title: pr.title.length > 50 ? `${pr.title.slice(0, 47)}...` : pr.title,
      branch: pr.headRefName,
      draft: pr.isDraft,
    })),
  )

  if (rows.length === 0) {
    console.log(pc.green('No open pull requests.'))
    return
  }

  printTable(rows, [
    { label: 'Package', value: (r) => r.dir },
    { label: 'PR', value: (r) => r.number, style: (r, t) => pc.dim(t) },
    { label: 'Title', value: (r) => r.title },
    { label: 'Branch', value: (r) => r.branch, style: (r, t) => pc.dim(t) },
    { label: 'Status', value: (r) => (r.draft ? 'draft' : ''), style: (r, t) => pc.yellow(t) },
  ])
}
