import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gh, ghAsync } from './exec.js'

export async function releaseExistsAsync(repo, tag) {
  const result = await ghAsync(repo.path, ['release', 'view', tag])
  return result.ok
}

// `--verify-tag` makes this fail loudly instead of inventing a new tag if
// the one we expect (from `polyrepo bump`) somehow isn't on origin yet — a
// release should only ever point at a tag that already exists. Notes come
// from the matching CHANGELOG.md section when there is one (see
// changelog.js's extractChangelogSection), otherwise gh's own
// --generate-notes (from merged PRs/commits) is the fallback.
export function createRelease(repo, { tag, title, notes, dryRun }) {
  const args = ['release', 'create', tag, '--verify-tag', '--title', title]
  let tempFile
  if (notes) {
    tempFile = path.join(os.tmpdir(), `polyrepo-release-notes-${process.pid}-${Date.now()}.md`)
    fs.writeFileSync(tempFile, notes)
    args.push('--notes-file', tempFile)
  } else {
    args.push('--generate-notes')
  }
  try {
    return gh(repo.path, args, { mutating: true, dryRun })
  } finally {
    if (tempFile) fs.rmSync(tempFile, { force: true })
  }
}
