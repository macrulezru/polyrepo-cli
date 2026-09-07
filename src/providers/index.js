import { providerNameFor, parseRemoteHost } from './detect.js'
import { githubProvider } from './github.js'
import { gitlabProvider } from './gitlab.js'

export { providerNameFor, parseRemoteHost }

export const ALL_PROVIDERS = [githubProvider, gitlabProvider]

const BY_NAME = { github: githubProvider, gitlab: gitlabProvider }

// The adapter for a repo's `origin` host, or null when it can't be
// determined (no origin remote at all) — callers already have a
// "couldn't check" path for that (see doctor.js's unchecked-count
// reporting), same as an unreachable GitHub always has.
export function providerFor(repo, config) {
  const name = providerNameFor(repo, config)
  return name ? BY_NAME[name] : null
}

export function providerByName(name) {
  return BY_NAME[name] ?? null
}
