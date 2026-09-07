import fs from 'node:fs'
import { select, input, confirm, Separator } from '@inquirer/prompts'
import pc from 'picocolors'
import { resolveConfigFilePath, readConfigFile, writeConfigFile } from '../configFile.js'
import { isRepo } from '../repos.js'
import { heading, ok, warn, promptTheme } from '../ui.js'

export async function setupCommand({ configPath } = {}) {
  const filePath = resolveConfigFilePath(configPath)
  const data = readConfigFile(filePath)
  let dirty = false

  heading('Configure package sources')
  console.log(pc.dim(`Editing: ${filePath}`))

  while (true) {
    console.log('')
    printEntries('roots (subfolders are scanned as packages)', data.roots, describeRoot)
    console.log('')
    printEntries('packages (the folder itself is the package)', data.packages, describePackage)
    console.log('')
    printEntries('gitlabHosts (self-hosted GitLab instances — gitlab.com always works)', data.gitlabHosts, (h) => h)

    const choices = [
      { name: 'Add a root directory', value: 'add-root' },
      { name: 'Add a single package directory', value: 'add-package' },
      { name: 'Add a self-hosted GitLab host', value: 'add-gitlab-host' },
    ]
    if (data.roots.length + data.packages.length + data.gitlabHosts.length > 0) {
      choices.push(
        { name: 'Edit an entry', value: 'edit' },
        { name: 'Remove an entry', value: 'remove' },
      )
    }
    choices.push(new Separator())
    choices.push({ name: dirty ? 'Save and exit' : 'Exit', value: 'exit' })
    if (dirty) choices.push({ name: 'Discard changes and exit', value: 'discard' })

    console.log('')
    const action = await select({ message: 'What do you want to do?', choices, theme: promptTheme })

    if (action === 'add-root') {
      const value = await promptPath('Root directory (its direct subfolders are scanned as packages):')
      if (value) {
        data.roots.push(value)
        dirty = true
      }
    } else if (action === 'add-package') {
      const value = await promptPath('Package directory (this folder itself is the package):')
      if (value) {
        data.packages.push(value)
        dirty = true
      }
    } else if (action === 'add-gitlab-host') {
      const value = await promptHost('Self-hosted GitLab hostname (no scheme, e.g. gitlab.company.com):')
      if (value) {
        data.gitlabHosts.push(value)
        dirty = true
      }
    } else if (action === 'edit') {
      const picked = await pickEntry(data)
      if (picked) {
        const current = data[picked.kind][picked.index]
        const value =
          picked.kind === 'gitlabHosts'
            ? await promptHost('New hostname:', current)
            : await promptPath(`New value for this ${picked.kind === 'roots' ? 'root' : 'package directory'}:`, current)
        if (value) {
          data[picked.kind][picked.index] = value
          dirty = true
        }
      }
    } else if (action === 'remove') {
      const picked = await pickEntry(data)
      if (picked) {
        const current = data[picked.kind][picked.index]
        const reallyRemove = await confirm({ message: `Remove "${current}"?`, default: false })
        if (reallyRemove) {
          data[picked.kind].splice(picked.index, 1)
          dirty = true
        }
      }
    } else if (action === 'exit') {
      if (dirty) {
        writeConfigFile(filePath, data)
        ok(`Saved ${filePath}`)
      }
      return
    } else if (action === 'discard') {
      console.log(pc.dim('Discarded changes.'))
      return
    }
  }
}

function printEntries(label, list, describe) {
  console.log(pc.bold(label))
  if (list.length === 0) {
    console.log(pc.dim('  (none)'))
    return
  }
  list.forEach((p, i) => console.log(`  ${i + 1}. ${describe(p)}`))
}

function describeRoot(p) {
  return `${p}  ${fs.existsSync(p) ? pc.green('✓ exists') : pc.red('✗ not found')}`
}

function describePackage(p) {
  if (!fs.existsSync(p)) return `${p}  ${pc.red('✗ not found')}`
  if (!isRepo(p)) return `${p}  ${pc.yellow('! no package.json/.git here')}`
  return `${p}  ${pc.green('✓ ok')}`
}

async function promptPath(message, defaultValue) {
  const value = await input({ message, default: defaultValue })
  const trimmed = value.trim()
  if (!trimmed) return null
  if (!fs.existsSync(trimmed)) {
    warn(`Path does not exist yet — added anyway: ${trimmed}`)
  }
  return trimmed
}

// No existence check (unlike promptPath) — a hostname isn't a local path,
// there's nothing on disk to look for.
async function promptHost(message, defaultValue) {
  const value = await input({ message, default: defaultValue })
  const trimmed = value.trim().toLowerCase()
  return trimmed || null
}

async function pickEntry(data) {
  const choices = [
    ...data.roots.map((p, i) => ({ name: `[root] ${p}`, value: { kind: 'roots', index: i } })),
    ...data.packages.map((p, i) => ({ name: `[package] ${p}`, value: { kind: 'packages', index: i } })),
    ...data.gitlabHosts.map((h, i) => ({ name: `[gitlabHost] ${h}`, value: { kind: 'gitlabHosts', index: i } })),
    { name: 'Cancel', value: null },
  ]
  return select({ message: 'Which entry?', choices, theme: promptTheme })
}
