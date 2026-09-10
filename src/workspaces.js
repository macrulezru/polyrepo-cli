import fs from 'node:fs'
import path from 'node:path'

const PNPM_WORKSPACE_FILE = 'pnpm-workspace.yaml'

function stripQuotes(value) {
  if (value.length >= 2 && ((value[0] === "'" && value.at(-1) === "'") || (value[0] === '"' && value.at(-1) === '"'))) {
    return value.slice(1, -1)
  }
  return value
}

// Reads the `packages:` glob list out of a repo's pnpm-workspace.yaml, if it
// has one — returns null when the repo isn't a pnpm workspace at all (no
// such file), or [] when it is but declares no members. Handles both the
// block-list form pnpm itself writes:
//   packages:
//     - 'packages/*'
//     - 'playground'
// and the less common inline-array form (`packages: [a, b]`). Deliberately
// hand-rolled instead of pulling in a YAML library — pnpm-workspace.yaml's
// `packages` key is always exactly one of these two shapes in practice, and
// a small parser aimed at just that is easier to trust than depending on a
// third-party YAML engine to interpret a file this tool doesn't otherwise
// need to understand.
export function pnpmWorkspaceGlobs(repoPath) {
  const filePath = path.join(repoPath, PNPM_WORKSPACE_FILE)
  if (!fs.existsSync(filePath)) return null

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
  const packagesLineIndex = lines.findIndex((l) => /^packages\s*:/.test(l.trim()))
  if (packagesLineIndex === -1) return []

  const inlineMatch = lines[packagesLineIndex].match(/^packages\s*:\s*\[(.*)\]\s*$/)
  if (inlineMatch) {
    return inlineMatch[1]
      .split(',')
      .map((s) => stripQuotes(s.trim()))
      .filter(Boolean)
  }

  const globs = []
  for (let i = packagesLineIndex + 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '') continue
    // Back to column 0 (no leading whitespace) — the `packages:` block is
    // over, whatever this line is belongs to some other top-level key.
    if (/^\S/.test(line)) break
    const match = line.match(/^\s*-\s*(.+?)\s*$/)
    if (!match) continue
    globs.push(stripQuotes(match[1].replace(/\s+#.*$/, '')))
  }
  return globs
}

function segmentToRegex(segment) {
  const escaped = segment.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')
  return new RegExp(`^${escaped}$`)
}

// Expands one glob pattern (as pnpm-workspace.yaml writes them) into the
// real, existing directories under repoPath that match it — a plain
// directory walk, not a general-purpose glob engine. Supports what
// pnpm-workspace.yaml patterns actually use: literal path segments
// ("playground"), a "*" wildcard standing in for one whole segment
// ("packages/*"), and "*" as part of a segment ("packages/build-*").
// Deliberately does not support "**" (recursive glob across any depth) —
// workspace members are always a fixed, shallow depth, so nothing here
// needs it.
function expandPattern(repoPath, pattern) {
  const segments = pattern.split('/').filter(Boolean)
  let current = ['']
  for (const segment of segments) {
    const isWildcard = segment.includes('*')
    const next = []
    for (const rel of current) {
      const dirAbs = path.join(repoPath, rel)
      if (!isWildcard) {
        const candidateRel = rel ? `${rel}/${segment}` : segment
        const candidateAbs = path.join(repoPath, candidateRel)
        if (fs.existsSync(candidateAbs) && fs.statSync(candidateAbs).isDirectory()) next.push(candidateRel)
        continue
      }
      if (!fs.existsSync(dirAbs) || !fs.statSync(dirAbs).isDirectory()) continue
      const regex = segmentToRegex(segment)
      for (const entry of fs.readdirSync(dirAbs, { withFileTypes: true })) {
        if (entry.isDirectory() && regex.test(entry.name)) {
          next.push(rel ? `${rel}/${entry.name}` : entry.name)
        }
      }
    }
    current = next
  }
  return current
}

// Resolves a repo's full `packages:` glob list down to its actual workspace
// members: real directories, each containing its own package.json (a
// matched folder without one — an empty placeholder, a doc folder, etc. —
// is silently skipped, same spirit as discoverRepos skipping a
// package.json-less folder found via a root scan). A leading "!" excludes
// whatever an earlier pattern matched, applied in the order the patterns are
// listed, same as pnpm itself.
export function resolveWorkspaceMembers(repoPath, globs) {
  if (!globs || globs.length === 0) return []

  const included = new Set()
  for (const raw of globs) {
    if (typeof raw !== 'string' || !raw.trim()) continue
    const negate = raw.startsWith('!')
    const pattern = negate ? raw.slice(1) : raw
    const matches = expandPattern(repoPath, pattern)
    if (negate) {
      for (const m of matches) included.delete(m)
    } else {
      for (const m of matches) included.add(m)
    }
  }

  const members = []
  for (const relDir of included) {
    const absDir = path.join(repoPath, relDir)
    const pkgPath = path.join(absDir, 'package.json')
    if (!fs.existsSync(pkgPath)) continue
    members.push({ relDir: relDir.split(path.sep).join('/'), absDir, pkgPath })
  }
  members.sort((a, b) => a.relDir.localeCompare(b.relDir))
  return members
}
