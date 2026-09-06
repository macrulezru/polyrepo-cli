import { confirm } from '@inquirer/prompts'
import pc from 'picocolors'
import { discoverRepos, inspectRepos } from '../repos.js'
import { loadConfig } from '../loadConfig.js'
import { tagName, tagExists } from '../tags.js'
import { releaseExistsAsync, createRelease } from '../release.js'
import { extractChangelogSection } from '../changelog.js'
import { selectPackages } from '../selectPackages.js'
import { filterByNames } from '../filterByNames.js'
import { pMap } from '../pMap.js'
import { heading, stepHeading, ok, fail, columnWidths, formatRow } from '../ui.js'

export async function releaseCommand({ configPath, packages, yes = false, dryRun = false } = {}) {
  const config = loadConfig({ configPath })
  const allRepos = (await inspectRepos(discoverRepos(config))).filter((r) => r.version)
  if (allRepos.length === 0) {
    console.log(pc.yellow('No repos found.'))
    return
  }

  heading('GitHub releases')

  // Narrowed to --packages up front (a no-op when it wasn't given) — no
  // reason to check, or print the tag/release status of, packages nobody
  // asked about.
  const repos = filterByNames(allRepos, packages)
  if (repos.length === 0) {
    console.log(pc.dim('Nothing selected.'))
    return
  }

  console.log(pc.dim(`Checking ${repos.length} package(s) for a tag and an existing release...`))
  // A release always targets `v<local version>` — the tag `polyrepo bump`
  // creates. No tag for the current version means there's nothing to
  // release yet; a tag with no release is exactly what this command is for.
  const withStatus = await pMap(repos, async (r) => {
    const tag = tagName(r.version)
    const tagged = tagExists(r, tag)
    const released = tagged ? await releaseExistsAsync(r, tag) : false
    const status = !tagged ? 'no-tag' : released ? 'released' : 'ready'
    const statusText = status === 'no-tag' ? 'not tagged yet' : status === 'released' ? 'already released' : 'ready'
    console.log(pc.dim(`  ${r.dir}: ${tag} — ${statusText}`))
    return { ...r, tag, status }
  })

  // Every choice would be disabled ("no tag yet") — @inquirer/checkbox
  // throws rather than just showing an empty list in that case, so this
  // needs to be caught before ever calling selectPackages when the
  // checkbox is actually going to render (a --packages run doesn't hit
  // this, since it skips the checkbox and the per-repo loop below already
  // reports "no tag" per package on its own).
  if (!packages && withStatus.every((r) => r.status === 'no-tag')) {
    console.log(
      pc.yellow('No packages are tagged yet — run `polyrepo bump` (new version) or `polyrepo tag` (current version) first.'),
    )
    return
  }

  const selected = await selectPackages({
    items: withStatus,
    // withStatus is already the exact --packages match — passing those
    // same dir names back here just skips the checkbox without
    // re-warning about anything (see publish.js for the same pattern).
    packages: packages ? withStatus.map((r) => r.dir) : undefined,
    message: 'Pick packages to create a GitHub Release for:',
    buildChoice: (all) => {
      const columns = [
        { value: (r) => r.dir },
        { value: (r) => r.tag, style: (r, t) => pc.dim(t) },
      ]
      const widths = columnWidths(all, columns)
      return (r) => ({
        name: formatRow(r, columns, widths) + statusSuffix(r),
        value: r,
        checked: r.status === 'ready',
        disabled: r.status === 'no-tag' ? '(no tag yet — run `polyrepo bump` or `polyrepo tag` first)' : false,
      })
    },
  })

  if (selected.length === 0) {
    console.log(pc.dim('Nothing selected.'))
    return
  }

  if (!yes) {
    const proceed = await confirm({
      message: `Create ${selected.length} GitHub Release(s)?${dryRun ? ' (dry run — nothing will actually be created)' : ''}`,
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
    stepHeading(index, selected.length, `${repo.dir}  ${repo.tag}`)

    // The checkbox disables "no-tag" choices so they can't be picked
    // interactively, but --packages bypasses the checkbox entirely — this
    // is the guard for that path (and cheap insurance against the status
    // having gone stale between the check above and here).
    if (repo.status === 'no-tag') {
      fail(`No tag ${repo.tag} on origin — run \`polyrepo bump\` or \`polyrepo tag\` first.`)
      continue
    }

    releaseOne(repo, repo.tag, { dryRun })
  }
}

// Also used by `polyrepo tag` to offer "release what I just tagged" right after
// tagging, without making that command build its own checkbox/confirm and
// re-discover which packages are release-ready — it already knows exactly.
export function releaseOne(repo, tag, { dryRun } = {}) {
  const notes = extractChangelogSection(repo, repo.version)
  const title = `${repo.name}@${repo.version}`
  ok(notes ? 'Using the matching CHANGELOG.md section as release notes.' : 'No changelog entry — using --generate-notes.')

  const result = createRelease(repo, { tag, title, notes, dryRun })
  if (!result.ok) fail(`gh release create failed (exit ${result.status}).`)
  else ok(`Created release ${title}.`)
}

// @inquirer/checkbox appends the `disabled` reason after the name itself
// for disabled choices, so "no-tag" needs nothing here — only "released"
// needs an explicit suffix, since it stays selectable (re-releasing is a
// legitimate thing to want) but shouldn't look identical to a fresh one.
function statusSuffix(r) {
  return r.status === 'released' ? pc.dim('  (already released)') : ''
}
