import semver from 'semver'
import { readPackageDependencies } from './repos.js'

// After bumping a package, other local packages that depend on it (e.g.
// css-magic-gradient depends on color-value-tools) can be left pointing at
// a version range that no longer matches — nothing enforces that today, so
// it's easy to bump one package and forget the ones that reference it.
// `repos` must already be inspected (name + version populated).
export function findStaleLocalDeps(repos) {
  const versionByName = new Map(repos.map((r) => [r.name, r.version]))
  const issues = []

  for (const repo of repos) {
    const deps = readPackageDependencies(repo)
    for (const [depName, range] of Object.entries(deps)) {
      if (depName === repo.name || !versionByName.has(depName)) continue
      // Not every dependency value is a semver range — "workspace:*"
      // (yarn/pnpm workspaces), "file:../x", "link:../y", and "npm:pkg@range"
      // aliases are all common and none of them are something to compare a
      // version against. semver.satisfies() doesn't throw for these (it
      // just quietly returns false), so it can't be used to detect them —
      // validRange() is the actual check.
      if (!semver.validRange(range)) continue
      const localVersion = versionByName.get(depName)
      if (!semver.satisfies(localVersion, range)) {
        issues.push({ repo, depName, range, localVersion })
      }
    }
  }
  return issues
}
