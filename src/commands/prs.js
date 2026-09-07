import pc from 'picocolors'
import { discoverRepos } from '../repos.js'
import { loadConfig } from '../loadConfig.js'
import { providerFor } from '../providers/index.js'
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

  heading('Open pull/merge requests')

  const spinner = startSpinner(`Checking ${repos.length} package(s) for open pull/merge requests...`)
  const results = await pMap(repos, async (r) => {
    const provider = providerFor(r, config)
    if (!provider) return { repo: r, prs: [] }
    return { repo: r, prs: await provider.listOpenPrsAsync(r), requestLabel: provider.requestLabel }
  })
  spinner.stop()

  const rows = results.flatMap(({ repo, prs, requestLabel }) =>
    prs.map((pr) => ({
      dir: repo.dir,
      number: `${requestLabel} #${pr.number}`,
      title: pr.title.length > 50 ? `${pr.title.slice(0, 47)}...` : pr.title,
      branch: pr.branch,
      draft: pr.isDraft,
    })),
  )

  if (rows.length === 0) {
    console.log(pc.green('No open pull/merge requests.'))
    return
  }

  printTable(
    rows,
    [
      { label: 'Package', value: (r) => r.dir },
      { label: 'PR/MR', value: (r) => r.number, style: (r, t) => pc.dim(t) },
      { label: 'Title', value: (r) => r.title },
      { label: 'Branch', value: (r) => r.branch, style: (r, t) => pc.dim(t) },
      { label: 'Status', value: (r) => (r.draft ? 'draft' : ''), style: (r, t) => pc.yellow(t) },
    ],
    { groupBy: (r) => r.dir },
  )
}
