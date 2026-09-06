import fs from 'node:fs'
import path from 'node:path'
import pc from 'picocolors'
import { gitAsync } from './exec.js'
import { pMap } from './pMap.js'

export function isRepo(dirPath) {
  return fs.existsSync(path.join(dirPath, 'package.json')) && fs.existsSync(path.join(dirPath, '.git'))
}

function toEntry(dirPath) {
  return {
    dir: path.basename(dirPath),
    path: dirPath,
    pkgPath: path.join(dirPath, 'package.json'),
  }
}

// GitHub itself defaults a new repo to "main", and plenty of people rename
// it back to "master" (or something else) — there's no one right answer,
// so this is only the last resort once nothing else could tell us.
const FALLBACK_DEFAULT_BRANCH = 'main'

async function readCachedOriginHead(repo) {
  const result = await gitAsync(repo.path, ['symbolic-ref', 'refs/remotes/origin/HEAD'])
  if (!result.ok || !result.stdout) return null
  const match = result.stdout.match(/^refs\/remotes\/origin\/(.+)$/)
  return match ? match[1] : null
}

// Detected once per repo (cached alongside branch/clean below) rather than
// assumed — a mixed folder of repos can easily have some on "master" and
// some on "main". In order:
//   1. the locally cached origin/HEAD ref — set by `git clone` (or a prior
//      `git remote set-head`), no network needed, the common case;
//   2. otherwise ask origin directly, read-only (`git ls-remote --symref`
//      doesn't write any local ref, unlike `git remote set-head --auto`);
//   3. offline or no working origin — guess from whichever of
//      master/main actually exists as a local branch;
//   4. still nothing to go on — GitHub's own default, "main".
export async function detectDefaultBranchAsync(repo) {
  const cached = await readCachedOriginHead(repo)
  if (cached) return cached

  const remoteHead = await gitAsync(repo.path, ['ls-remote', '--symref', 'origin', 'HEAD'])
  const remoteMatch = remoteHead.ok && remoteHead.stdout.match(/^ref:\s*refs\/heads\/(\S+)\s+HEAD/m)
  if (remoteMatch) return remoteMatch[1]

  for (const candidate of ['master', 'main']) {
    const exists = await gitAsync(repo.path, ['show-ref', '--verify', '--quiet', `refs/heads/${candidate}`])
    if (exists.ok) return candidate
  }

  return FALLBACK_DEFAULT_BRANCH
}

// `config.roots` — folders whose direct subdirectories are packages (the
// original C:\work\NPM-style layout). `config.packages` — individual
// package folders given directly, for a one-off repo that doesn't live
// under any of the scanned roots. A folder missing package.json/.git is
// silently skipped when found via a root scan (e.g. vue-masonry-kit, which
// has only README/LICENSE so far) but reported when named explicitly in
// `packages`, since that's almost certainly a typo worth knowing about.
export function discoverRepos(config) {
  const repos = []
  const seen = new Set()

  for (const root of config.roots) {
    if (!fs.existsSync(root)) {
      console.log(pc.yellow(`Configured root does not exist, skipping: ${root}`))
      continue
    }
    const entries = fs.readdirSync(root, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const repoPath = path.join(root, entry.name)
      if (!isRepo(repoPath)) continue
      addRepo(repoPath)
    }
  }

  for (const pkgDir of config.packages) {
    if (!fs.existsSync(pkgDir)) {
      console.log(pc.yellow(`Configured package folder does not exist, skipping: ${pkgDir}`))
      continue
    }
    if (!isRepo(pkgDir)) {
      console.log(pc.yellow(`Configured package folder has no package.json/.git, skipping: ${pkgDir}`))
      continue
    }
    addRepo(pkgDir)
  }

  function addRepo(repoPath) {
    const key = path.resolve(repoPath).toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    repos.push(toEntry(repoPath))
  }

  repos.sort((a, b) => a.dir.localeCompare(b.dir))
  return repos
}

export function readPackageJson(repo) {
  const text = fs.readFileSync(repo.pkgPath, 'utf8')
  const nameMatch = text.match(/"name"\s*:\s*"([^"]+)"/)
  const versionMatch = text.match(/"version"\s*:\s*"([^"]+)"/)
  return {
    text,
    name: nameMatch ? nameMatch[1] : repo.dir,
    version: versionMatch ? versionMatch[1] : null,
  }
}

// Full snapshot used everywhere a package list is shown: name, version,
// current branch, its default branch, and whether the working tree has
// uncommitted changes. The git calls per repo run concurrently across
// repos (see pMap) instead of one repo waiting on the last.
export async function inspectRepoAsync(repo) {
  const pkg = readPackageJson(repo)
  const [branchResult, statusResult, defaultBranch] = await Promise.all([
    gitAsync(repo.path, ['branch', '--show-current']),
    gitAsync(repo.path, ['status', '--porcelain']),
    detectDefaultBranchAsync(repo),
  ])
  const branch = branchResult.ok ? branchResult.stdout || null : null
  const clean = statusResult.ok && statusResult.stdout === ''
  return { ...repo, ...pkg, branch, clean, defaultBranch }
}

export function inspectRepos(repos, concurrency) {
  return pMap(repos, inspectRepoAsync, concurrency)
}

// Raw dependency ranges declared by a package — used to cross-check whether
// one local package still points at a stale version of another local one
// after a bump. Parses the real JSON (unlike readPackageJson's regex-based
// extraction, which only needs name/version and deliberately avoids
// reformatting the file on write) since dependency objects are more than a
// single scalar to pull out reliably with a regex.
export function readPackageDependencies(repo) {
  try {
    const json = JSON.parse(fs.readFileSync(repo.pkgPath, 'utf8'))
    return {
      ...json.dependencies,
      ...json.devDependencies,
      ...json.peerDependencies,
    }
  } catch {
    return {}
  }
}
