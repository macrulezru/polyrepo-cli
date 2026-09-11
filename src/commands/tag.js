import { confirm } from '@inquirer/prompts'
import pc from 'picocolors'
import { discoverPackages, inspectRepos, readPackageJson } from '../repos.js'
import { loadConfig } from '../loadConfig.js'
import { syncDefaultBranch } from '../defaultBranchSync.js'
import { tagFor, tagExists, tagExistsAsync, createAndPushTag } from '../tags.js'
import { fetchOriginDefaultBranchAsync, readOriginVersionAsync } from '../remoteVersion.js'
import { selectPackages } from '../selectPackages.js'
import { filterByNames } from '../filterByNames.js'
import { pMap } from '../pMap.js'
import { heading, stepHeading, ok, fail, warn, columnWidths, formatRow } from '../ui.js'
import { releaseOne } from './release.js'

// For packages whose version was bumped outside `polyrepo bump` (or before `bump`
// started tagging), there's no `v<version>` tag yet — `polyrepo release` refuses
// to touch those. This puts just the tag on the current version, on the
// default branch's current tip, without touching the version number or
// opening a PR — no need to bump again just to get a tag. Offers to
// release right after, since "I just caught this package's tag up" and "I
// want a release for it" are almost always the same reason to run this.
export async function tagCommand({ configPath, packages, yes = false, dryRun = false, release = false } = {}) {
  const config = loadConfig({ configPath })
  const allRepos = (await inspectRepos(discoverPackages(config))).filter((r) => r.version)
  if (allRepos.length === 0) {
    console.log(pc.yellow('No repos found.'))
    return
  }

  heading('Tag current versions')

  // Narrowed to --packages up front (a no-op when it wasn't given) — no
  // reason to check, or print the tag status of, packages nobody asked
  // about.
  const repos = filterByNames(allRepos, packages)
  if (repos.length === 0) {
    console.log(pc.dim('Nothing selected.'))
    return
  }

  console.log(pc.dim(`Checking ${repos.length} package(s) for an existing tag...`))
  // Also fetches each repo's origin default branch (once per physical repo)
  // so the check below can flag when the local version this would tag
  // differs from what's actually on origin — genuinely worth knowing here
  // specifically: the action below fast-forwards local to origin's default
  // branch *before* tagging (see syncDefaultBranch), so a mismatch here
  // means the tag about to be created may not name the version that ends
  // up actually being tagged.
  const uniqueRepos = [...new Map(repos.map((r) => [r.repoPath, r])).values()]
  await pMap(uniqueRepos, (r) => fetchOriginDefaultBranchAsync(r.repoPath, r.defaultBranch))

  const withTag = await pMap(repos, async (r) => {
    const tag = tagFor(r)
    const [alreadyTagged, originVersion] = await Promise.all([tagExistsAsync(r, tag), readOriginVersionAsync(r)])
    const originNote = originVersion != null && originVersion !== r.version ? pc.yellow(` (origin has ${originVersion})`) : ''
    console.log(pc.dim(`  ${r.dir}: ${tag} — ${alreadyTagged ? 'already tagged' : 'not tagged yet'}`) + originNote)
    return { ...r, tag, alreadyTagged, originVersion }
  })

  const selected = await selectPackages({
    items: withTag,
    // withTag is already the exact --packages match — passing those same
    // dir names back here just skips the checkbox without re-warning
    // about anything (see publish.js for the same pattern).
    packages: packages ? withTag.map((r) => r.dir) : undefined,
    message: 'Pick packages to tag at their current version:',
    buildChoice: (all) => {
      const columns = [
        { value: (r) => r.dir },
        { value: (r) => r.version, style: (r, t) => pc.dim(t) },
        { value: (r) => r.tag, style: (r, t) => pc.dim(t) },
      ]
      const widths = columnWidths(all, columns)
      return (r) => ({
        name:
          formatRow(r, columns, widths) +
          (r.alreadyTagged ? pc.dim('  (already tagged)') : '') +
          (r.originVersion != null && r.originVersion !== r.version ? pc.yellow(`  ⚠ origin has ${r.originVersion}`) : ''),
        value: r,
        checked: !r.alreadyTagged,
      })
    },
  })

  if (selected.length === 0) {
    console.log(pc.dim('Nothing selected.'))
    return
  }

  if (!yes) {
    const proceed = await confirm({
      message: `Tag ${selected.length} package(s) at their current version?${dryRun ? ' (dry run — nothing will actually be pushed)' : ''}`,
      default: true,
    })
    if (!proceed) {
      console.log(pc.dim('Cancelled.'))
      return
    }
  }

  const ready = []
  let index = 0
  for (const repo of selected) {
    index += 1
    stepHeading(index, selected.length, `${repo.dir}  ${repo.tag}`)

    const syncResult = syncDefaultBranch(repo)
    if (!syncResult.ok) {
      fail(syncResult.message)
      continue
    }
    ok(`${repo.defaultBranch} is up to date.`)

    // Re-read the version now that local matches origin's default branch
    // exactly — `repo.version` (and the tag name derived from it, computed
    // back when the table above was built) can be stale if local wasn't
    // already on defaultBranch, or was behind: the sync above just changed
    // what's actually on disk. Tagging has to name the version that's here
    // now, not the one that was here before syncDefaultBranch ran.
    const freshVersion = readPackageJson(repo).version
    if (!freshVersion) {
      fail(`Could not read a version from package.json after syncing ${repo.defaultBranch} — skipping.`)
      continue
    }
    const freshRepo = { ...repo, version: freshVersion }
    const tag = tagFor(freshRepo)
    if (tag !== repo.tag) {
      warn(`Version changed from ${repo.version} to ${freshVersion} after syncing with origin — tagging ${tag} instead of ${repo.tag}.`)
    }

    // Re-checked here (not just trusting the table above) in case it
    // changed between listing and now — same reasoning as bump's
    // detectBumpState re-check right before acting.
    if (tagExists(freshRepo, tag)) {
      ok(`Tag ${tag} already exists on origin.`)
      ready.push({ ...freshRepo, tag })
      continue
    }

    const tagResult = createAndPushTag(freshRepo, tag, { dryRun })
    if (!tagResult.ok) {
      fail(tagResult.message)
      continue
    }
    ok(`Tagged and pushed ${tag}.`)
    if (!dryRun) ready.push({ ...freshRepo, tag })
  }

  if (dryRun || ready.length === 0) return

  let wantRelease = release
  if (!wantRelease && !yes) {
    wantRelease = await confirm({
      message: `Create a release for the ${ready.length} package(s) just tagged?`,
      default: true,
    })
  }
  if (!wantRelease) return

  let releaseIndex = 0
  for (const repo of ready) {
    releaseIndex += 1
    stepHeading(releaseIndex, ready.length, `${repo.dir}  ${repo.tag}`)
    releaseOne(repo, repo.tag, { dryRun, config })
  }
}
