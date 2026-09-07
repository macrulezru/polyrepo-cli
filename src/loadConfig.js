import fs from 'node:fs'
import path from 'node:path'
import pc from 'picocolors'
import { resolveConfigFilePath, readConfigFile, DEFAULT_CONFIG_PATH } from './configFile.js'

// No hardcoded fallback path — a folder that makes sense on one person's
// machine (an old default here used to be a Windows-only path) is either
// wrong or actively misleading for everyone else. An empty config just
// means `discoverRepos` finds nothing, and every command already prints
// "No repos found." for that — the hint below is what actually points
// people at the fix.
const EMPTY_CONFIG = { roots: [], packages: [], gitlabHosts: [] }

// Config shape:
//   {
//     "roots": ["/path/to/repos-folder"],    // each entry: a folder whose
//                                             // direct subdirectories are packages
//     "packages": ["/path/to/one-off-repo"], // each entry: a single package folder itself
//     "gitlabHosts": ["gitlab.company.com"]  // self-hosted GitLab hostnames (see providers/detect.js)
//   }
// All three keys are optional and additive. Relative paths in roots/packages
// are resolved against the config file's own directory, not the current
// working directory — so the config stays correct no matter where
// `polyrepo` is invoked from (important once it's `npm link`-ed globally).
// Edit this file by hand or through `polyrepo setup`.
export function loadConfig({ configPath } = {}) {
  const resolvedPath = resolveConfigFilePath(configPath)

  let raw = EMPTY_CONFIG
  let baseDir = path.dirname(DEFAULT_CONFIG_PATH)

  if (fs.existsSync(resolvedPath)) {
    baseDir = path.dirname(resolvedPath)
    try {
      raw = readConfigFile(resolvedPath)
    } catch (err) {
      console.log(pc.red(`Could not read config at ${resolvedPath}: ${err.message}`))
      raw = EMPTY_CONFIG
      baseDir = path.dirname(DEFAULT_CONFIG_PATH)
    }
  } else if (configPath || process.env.POLYREPO_CONFIG) {
    // An explicit --config / POLYREPO_CONFIG path was given but doesn't exist —
    // that's almost certainly a typo, worth a loud warning rather than a
    // silent fallback.
    console.log(pc.red(`Config file not found: ${resolvedPath}`))
  } else {
    console.log(pc.yellow(`No config found at ${resolvedPath} — run \`polyrepo setup\` to add package directories.`))
  }

  // POLYREPO_ROOT is a lighter-weight override for a single one-off run — it
  // replaces the configured roots but leaves any explicit `packages` entries
  // from the config file in place.
  const roots = process.env.POLYREPO_ROOT ? [process.env.POLYREPO_ROOT] : raw.roots

  return {
    configPath: resolvedPath,
    roots: roots.map((p) => resolveAgainst(baseDir, p)),
    packages: raw.packages.map((p) => resolveAgainst(baseDir, p)),
    // Hostnames, not paths — nothing to resolve against baseDir.
    gitlabHosts: (raw.gitlabHosts ?? []).map((h) => h.toLowerCase()),
  }
}

function resolveAgainst(baseDir, p) {
  return path.isAbsolute(p) ? p : path.resolve(baseDir, p)
}
