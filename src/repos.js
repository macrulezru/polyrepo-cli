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
// current branch, and whether the working tree has uncommitted changes.
// The two git calls per repo run concurrently across repos (see pMap)
// instead of one repo waiting on the last.
export async function inspectRepoAsync(repo) {
  const pkg = readPackageJson(repo)
  const [branchResult, statusResult] = await Promise.all([
    gitAsync(repo.path, ['branch', '--show-current']),
    gitAsync(repo.path, ['status', '--porcelain']),
  ])
  const branch = branchResult.ok ? branchResult.stdout || null : null
  const clean = statusResult.ok && statusResult.stdout === ''
  return { ...repo, ...pkg, branch, clean }
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
