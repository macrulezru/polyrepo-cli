import { git } from '../exec.js'

// Handles both URL forms `git remote get-url origin` can return:
//   https://host/owner/repo.git   (and the no-.git, no-path-prefix variants)
//   git@host:owner/repo.git       (SSH shorthand — not a real URL, no `//`)
export function parseRemoteHost(url) {
  if (!url) return null
  const httpMatch = url.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)/i)
  if (httpMatch) return httpMatch[1].toLowerCase()
  const sshMatch = url.match(/^[^@\s]+@([^:\s]+):/)
  if (sshMatch) return sshMatch[1].toLowerCase()
  return null
}

// Which provider a remote URL's host belongs to. `gitlab.com` is always
// recognized; a self-hosted instance needs its host listed once in
// `gitlabHosts` (same config.gitlabHosts the rest of the providers layer
// reads) — there's no way to tell "some other git server" from "our
// corporate GitLab" by URL shape alone. Anything not recognized as GitLab
// defaults to 'github', preserving today's behavior exactly (every repo,
// regardless of host, already goes through `gh` — this just makes that
// default explicit instead of the only option). Split out from
// providerNameFor below as the pure part of it — no I/O, so it's testable
// directly instead of only through a real git repo.
export function providerNameForUrl(url, config = {}) {
  const host = parseRemoteHost(url)
  if (!host) return null
  const gitlabHosts = config.gitlabHosts ?? []
  if (host === 'gitlab.com' || gitlabHosts.includes(host)) return 'gitlab'
  return 'github'
}

// Which provider a repo's `origin` remote belongs to — checked once per
// repo (cheap, local metadata read, no network) rather than assumed, so a
// folder can freely mix GitHub and GitLab repos.
export function providerNameFor(repo, config = {}) {
  const result = git(repo.path, ['remote', 'get-url', 'origin'], { quiet: true })
  if (!result.ok || !result.stdout) return null
  return providerNameForUrl(result.stdout.trim(), config)
}
