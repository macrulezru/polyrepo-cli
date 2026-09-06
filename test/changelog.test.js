import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { hasChangelog, addChangelogEntry, extractChangelogSection } from '../src/changelog.js'

function makeRepo(changelogContent) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vpc-changelog-test-'))
  if (changelogContent !== undefined) {
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), changelogContent)
  }
  return { path: dir }
}

test('hasChangelog reflects whether CHANGELOG.md exists', () => {
  assert.equal(hasChangelog(makeRepo('# Changelog\n')), true)
  assert.equal(hasChangelog(makeRepo(undefined)), false)
})

test('addChangelogEntry inserts after "## [Unreleased]" when present', () => {
  const repo = makeRepo(
    ['# Changelog', '', '## [Unreleased]', '', '## [1.0.0] - 2026-01-01', '', '### Added', '', '- Initial release.', ''].join(
      '\n',
    ),
  )

  addChangelogEntry(repo, '1.0.1', ['abc123 fix: something real', 'def456 Merge pull request #1 from x/y'])

  const text = fs.readFileSync(path.join(repo.path, 'CHANGELOG.md'), 'utf8')
  const lines = text.split('\n')

  const unreleasedIdx = lines.findIndex((l) => l.startsWith('## [Unreleased]'))
  const newIdx = lines.findIndex((l) => l.startsWith('## [1.0.1]'))
  const oldIdx = lines.findIndex((l) => l.startsWith('## [1.0.0]'))

  assert.ok(unreleasedIdx < newIdx, 'new entry comes after Unreleased')
  assert.ok(newIdx < oldIdx, 'new entry comes before the previous most-recent release')
  assert.match(text, /- fix: something real/)
  // Merge-commit noise must be filtered out of the draft.
  assert.doesNotMatch(text, /Merge pull request/)
})

test('addChangelogEntry inserts before the first version heading when there is no Unreleased section', () => {
  const repo = makeRepo(['# Changelog', '', '## [1.0.0] - 2026-01-01', '', '- Initial release.', ''].join('\n'))

  addChangelogEntry(repo, '1.1.0', [])

  const lines = fs.readFileSync(path.join(repo.path, 'CHANGELOG.md'), 'utf8').split('\n')
  const newIdx = lines.findIndex((l) => l.startsWith('## [1.1.0]'))
  const oldIdx = lines.findIndex((l) => l.startsWith('## [1.0.0]'))

  assert.ok(newIdx !== -1 && oldIdx !== -1 && newIdx < oldIdx)
})

test('addChangelogEntry appends at the end when there are no version headings at all', () => {
  const repo = makeRepo(['# Changelog', '', 'Nothing released yet.', ''].join('\n'))

  addChangelogEntry(repo, '0.1.0', [])

  const text = fs.readFileSync(path.join(repo.path, 'CHANGELOG.md'), 'utf8')
  assert.match(text, /## \[0\.1\.0\]/)
})

test('addChangelogEntry omits the "### Changed" section when there are no real commits to list', () => {
  const repo = makeRepo(['# Changelog', ''].join('\n'))

  // Only a merge commit — filtered out, so nothing should end up under
  // "### Changed" at all rather than an empty, pointless heading.
  addChangelogEntry(repo, '0.1.0', ['abc Merge pull request #2 from x/y'])

  const text = fs.readFileSync(path.join(repo.path, 'CHANGELOG.md'), 'utf8')
  assert.match(text, /## \[0\.1\.0\]/)
  assert.doesNotMatch(text, /### Changed/)
})

test('extractChangelogSection returns the body of one version, and null when missing', () => {
  const repo = makeRepo(
    [
      '# Changelog',
      '',
      '## [1.2.0] - 2026-02-01',
      '',
      '### Fixed',
      '',
      '- A real bug.',
      '',
      '## [1.1.0] - 2026-01-01',
      '',
      '- Older stuff.',
      '',
    ].join('\n'),
  )

  const section = extractChangelogSection(repo, '1.2.0')
  assert.match(section, /A real bug/)
  assert.doesNotMatch(section, /Older stuff/)

  assert.equal(extractChangelogSection(repo, '9.9.9'), null)
  assert.equal(extractChangelogSection(makeRepo(undefined), '1.0.0'), null)
})
