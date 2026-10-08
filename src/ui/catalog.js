import { listCommand } from '../commands/list.js'
import { outdatedCommand } from '../commands/outdated.js'
import { auditCommand } from '../commands/audit.js'
import { prsCommand } from '../commands/prs.js'
import { doctorCommand } from '../commands/doctor.js'
import { switchDefaultCommand } from '../commands/switchDefault.js'
import { bumpCommand } from '../commands/bump.js'
import { publishCommand } from '../commands/publish.js'
import { tagCommand } from '../commands/tag.js'
import { releaseCommand } from '../commands/release.js'
import { syncDepsCommand } from '../commands/syncDeps.js'
import { execCommand } from '../commands/exec.js'
import { cloneCommand } from '../commands/clone.js'

const BUMP_TYPES = ['patch', 'minor', 'major', 'prepatch', 'preminor', 'premajor', 'prerelease', 'custom']

const flag = (key, label, help, extra = {}) => ({ key, type: 'boolean', label, help, default: false, ...extra })

export function splitCommandLine(text) {
  const parts = []
  let current = ''
  let quote = null
  let started = false
  for (const char of String(text)) {
    if (quote) {
      if (char === quote) quote = null
      else current += char
    } else if (char === '"' || char === "'") {
      quote = char
      started = true
    } else if (/\s/.test(char)) {
      if (current !== '' || started) parts.push(current)
      current = ''
      started = false
    } else {
      current += char
    }
  }
  if (current !== '' || started) parts.push(current)
  return parts
}

function names(options) {
  const value = options.packages
  if (Array.isArray(value) && value.length > 0) return value
  return undefined
}

export const COMMANDS = [
  {
    id: 'list',
    title: 'Packages',
    group: 'inspect',
    summary: 'Version, branch, git status, tag, release, npm and dependency drift for every package.',
    mutating: false,
    packages: 'none',
    options: [
      flag('quick', 'Quick check', 'Skip the tag, release, npm and dependency checks: version, branch and git status only.'),
      flag('showPath', 'Show paths', 'Add a column with the location of each package on disk.'),
    ],
    run: (o, c) => listCommand({ configPath: c.configPath, quick: !!o.quick, showPath: !!o.showPath }),
  },
  {
    id: 'outdated',
    title: 'Outdated dependencies',
    group: 'inspect',
    summary: 'npm outdated across every package, with how far behind each dependency is.',
    mutating: false,
    packages: 'filter',
    options: [],
    run: (o, c) => outdatedCommand({ configPath: c.configPath, packages: names(o) }),
  },
  {
    id: 'audit',
    title: 'Security audit',
    group: 'inspect',
    summary: 'npm audit across every package, sorted by severity.',
    mutating: false,
    packages: 'filter',
    options: [],
    run: (o, c) => auditCommand({ configPath: c.configPath, packages: names(o) }),
  },
  {
    id: 'prs',
    title: 'Open pull requests',
    group: 'inspect',
    summary: 'Every open pull or merge request across the repos.',
    mutating: false,
    packages: 'filter',
    options: [],
    run: (o, c) => prsCommand({ configPath: c.configPath, packages: names(o) }),
  },
  {
    id: 'doctor',
    title: 'Doctor',
    group: 'inspect',
    summary: 'Environment, config, branch health and dependency drift, with a few safe self-repairs.',
    mutating: false,
    packages: 'none',
    options: [
      flag('cleanBranches', 'Offer to delete merged local bump branches', 'After the scan, asks which leftover local branches to delete.', { writes: true }),
      flag('cleanRemoteBranches', 'Offer to delete merged branches on origin', 'Shared state: asks which leftover branches to delete on the host.', { writes: true }),
    ],
    run: (o, c) =>
      doctorCommand({ configPath: c.configPath, cleanBranches: !!o.cleanBranches, cleanRemoteBranches: !!o.cleanRemoteBranches }),
  },
  {
    id: 'switch-default',
    title: 'Switch to default branch',
    group: 'sync',
    summary: 'Fast-forward repos to their up-to-date default branch, whatever it is called.',
    mutating: true,
    packages: 'select',
    options: [
      flag('force', 'Discard local changes', 'Hard-reset a repo to match origin, dropping uncommitted changes and local-only commits.', { danger: true }),
      flag('clean', 'Also delete untracked files', 'Only together with discarding local changes.', { danger: true, requires: 'force' }),
    ],
    run: (o, c) =>
      switchDefaultCommand({
        configPath: c.configPath,
        packages: names(o),
        yes: !!o.yes,
        force: !!o.force,
        clean: !!o.clean,
      }),
  },
  {
    id: 'sync-deps',
    title: 'Sync local dependency ranges',
    group: 'sync',
    summary: 'Update stale ranges of one local package on another to the current local version. Edits files only.',
    mutating: true,
    packages: 'select',
    options: [flag('dryRun', 'Dry run', 'Show what would be updated, write nothing.')],
    run: (o, c) => syncDepsCommand({ configPath: c.configPath, dryRun: !!o.dryRun, packages: names(o), yes: !!o.yes }),
  },
  {
    id: 'bump',
    title: 'Bump version',
    group: 'release',
    summary: 'Bump the version through a branch, a pull request and a merge, then tag it.',
    mutating: true,
    packages: 'select',
    options: [
      flag('dryRun', 'Dry run', 'Show every step without pushing, opening, merging or tagging anything.'),
      { key: 'bumpType', type: 'select', label: 'Bump', help: 'How the version moves.', default: 'patch', choices: BUMP_TYPES },
      { key: 'preid', type: 'text', label: 'Prerelease id', help: 'For the pre* kinds, for example alpha or beta.', default: '', showWhen: { key: 'bumpType', in: ['prepatch', 'preminor', 'premajor', 'prerelease'] } },
      { key: 'customVersion', type: 'text', label: 'Exact version', help: 'For a custom bump: exactly one package, for example 2.0.0-rc.1.', default: '', showWhen: { key: 'bumpType', in: ['custom'] } },
      flag('waitChecks', 'Wait for CI checks', 'Wait for the checks of each pull request before merging it.'),
      flag('publish', 'Publish to npm afterwards', 'Publish each package right after it is tagged.'),
    ],
    run: (o, c) =>
      bumpCommand({
        configPath: c.configPath,
        dryRun: !!o.dryRun,
        packages: names(o),
        yes: !!o.yes,
        waitChecks: !!o.waitChecks,
        bumpType: o.bumpType || 'patch',
        preid: o.preid || undefined,
        customVersion: o.customVersion || undefined,
        publish: !!o.publish,
      }),
  },
  {
    id: 'publish',
    title: 'Publish to npm',
    group: 'release',
    summary: 'Publish the packages that are ahead of the registry.',
    mutating: true,
    packages: 'select',
    options: [
      flag('dryRun', 'Dry run', 'Run npm publish --dry-run instead of a real publish.'),
      { key: 'distTag', type: 'text', label: 'Dist-tag', help: 'Overrides the tag a version is published under.', default: '' },
      { key: 'otp', type: 'text', label: 'One-time password', help: 'The current 2FA code from your authenticator, if your npm account needs one. Valid for about 30 seconds, so start the run right away.', default: '' },
    ],
    run: (o, c) =>
      publishCommand({
        configPath: c.configPath,
        dryRun: !!o.dryRun,
        packages: names(o),
        yes: !!o.yes,
        distTag: o.distTag || undefined,
        otp: o.otp || undefined,
      }),
  },
  {
    id: 'tag',
    title: 'Tag current version',
    group: 'release',
    summary: 'Tag packages at their current version without bumping, optionally releasing right after.',
    mutating: true,
    packages: 'select',
    options: [
      flag('dryRun', 'Dry run', 'Show every step without tagging, pushing or releasing anything.'),
      flag('release', 'Create releases too', 'Create a release for each package just tagged.'),
    ],
    run: (o, c) =>
      tagCommand({ configPath: c.configPath, dryRun: !!o.dryRun, packages: names(o), yes: !!o.yes, release: !!o.release }),
  },
  {
    id: 'release',
    title: 'Create releases',
    group: 'release',
    summary: "Create a release from each package's current tag, with notes from its changelog.",
    mutating: true,
    packages: 'select',
    options: [flag('dryRun', 'Dry run', 'Show what would be created, create nothing.')],
    run: (o, c) => releaseCommand({ configPath: c.configPath, dryRun: !!o.dryRun, packages: names(o), yes: !!o.yes }),
  },
  {
    id: 'exec',
    title: 'Run a command',
    group: 'sync',
    summary: 'Run any command in each selected package, one at a time.',
    mutating: true,
    packages: 'select',
    options: [
      { key: 'cmd', type: 'text', label: 'Command', help: 'For example: npm test, or npm run lint.', default: '', required: true },
      flag('bail', 'Stop at the first failure', 'Do not continue with the remaining packages after one fails.'),
    ],
    run: (o, c) =>
      execCommand({
        configPath: c.configPath,
        packages: names(o),
        yes: !!o.yes,
        bail: !!o.bail,
        cmd: splitCommandLine(o.cmd ?? ''),
      }),
  },
  {
    id: 'clone',
    title: 'Clone missing repos',
    group: 'sync',
    summary: 'Clone the repos of an organization or group that are not on disk yet.',
    mutating: true,
    packages: 'none',
    options: [
      { key: 'org', type: 'text', label: 'Organization or group', help: 'The GitHub org or user, or the GitLab group.', default: '', required: true },
      { key: 'provider', type: 'select', label: 'Host', help: 'Which host the name refers to.', default: 'github', choices: ['github', 'gitlab'] },
      { key: 'root', type: 'text', label: 'Folder to clone into', help: "Default: the first root of the config.", default: '' },
      flag('includeArchived', 'Include archived repos', 'Archived repos are skipped by default.'),
      flag('dryRun', 'Dry run', 'Show what would be cloned, clone nothing.'),
    ],
    run: (o, c) =>
      cloneCommand({
        configPath: c.configPath,
        org: o.org,
        provider: o.provider || 'github',
        root: o.root || undefined,
        includeArchived: !!o.includeArchived,
        packages: names(o),
        yes: !!o.yes,
        dryRun: !!o.dryRun,
      }),
  },
]

export function findCommand(id) {
  return COMMANDS.find((command) => command.id === id)
}

export function describeCommands() {
  return COMMANDS.map(({ run, ...rest }) => rest)
}
