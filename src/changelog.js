import fs from 'node:fs'
import path from 'node:path'

export function changelogPath(repo) {
  return path.join(repo.path, 'CHANGELOG.md')
}

export function hasChangelog(repo) {
  return fs.existsSync(changelogPath(repo))
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

// Inserts a "## [x.y.z] - YYYY-MM-DD" entry into an existing Keep a
// Changelog-style CHANGELOG.md, as the new most-recent release:
//   - right after "## [Unreleased]" if the file has one (so Unreleased
//     stays in place, empty, at the top)
//   - otherwise right before the first existing "## " version heading
//   - otherwise (no version headings at all) appended at the end
// `commitLines` (from changes.js's fullCommitLinesSince) seeds a "###
// Changed" section as a draft — merge-commit noise filtered out, but this
// is a starting point to review and edit, not a finished changelog. Only
// ever called when hasChangelog() is already true — packages without one
// are left alone rather than having a CHANGELOG.md invented for them.
export function addChangelogEntry(repo, version, commitLines) {
  const filePath = changelogPath(repo)
  const lines = fs.readFileSync(filePath, 'utf8').split('\n')

  const bullets = commitLines
    .map((l) => l.replace(/^[0-9a-f]+\s+/, '').trim())
    .filter((l) => l && !/^Merge (pull request|branch)\b/i.test(l))
    .map((l) => `- ${l}`)

  const entry = [`## [${version}] - ${todayISO()}`, '']
  if (bullets.length > 0) entry.push('### Changed', '', ...bullets, '')

  const unreleasedIndex = lines.findIndex((l) => /^## \[Unreleased\]/i.test(l))
  const searchStart = unreleasedIndex === -1 ? 0 : unreleasedIndex + 1

  let insertAt = -1
  for (let i = searchStart; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      insertAt = i
      break
    }
  }

  const before = insertAt === -1 ? lines : lines.slice(0, insertAt)
  const after = insertAt === -1 ? [] : lines.slice(insertAt)
  const updated = [...before, ...entry, ...after].join('\n')

  fs.writeFileSync(filePath, updated.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n')
}

// Pulls just the body of one version's section back out — used by `vpc
// release` to seed GitHub Release notes from the changelog instead of
// gh's own --generate-notes when a CHANGELOG.md entry already exists for
// that version. Returns null if there's no changelog, no matching heading,
// or the section is empty.
export function extractChangelogSection(repo, version) {
  if (!hasChangelog(repo)) return null
  const lines = fs.readFileSync(changelogPath(repo), 'utf8').split('\n')
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const headingIndex = lines.findIndex((l) => new RegExp(`^## \\[${escaped}\\]`).test(l))
  if (headingIndex === -1) return null

  let end = lines.length
  for (let i = headingIndex + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      end = i
      break
    }
  }
  const section = lines
    .slice(headingIndex + 1, end)
    .join('\n')
    .trim()
  return section || null
}
