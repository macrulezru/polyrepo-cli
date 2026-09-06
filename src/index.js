#!/usr/bin/env node
import { Command } from 'commander'
import pc from 'picocolors'
import { listCommand } from './commands/list.js'
import { doctorCommand } from './commands/doctor.js'
import { switchMasterCommand } from './commands/switchMaster.js'
import { bumpCommand } from './commands/bump.js'
import { publishCommand } from './commands/publish.js'
import { tagCommand } from './commands/tag.js'
import { releaseCommand } from './commands/release.js'
import { setupCommand } from './commands/setup.js'
import { execCommand } from './commands/exec.js'
import { outdatedCommand } from './commands/outdated.js'
import { prsCommand } from './commands/prs.js'
import { cloneCommand } from './commands/clone.js'

const program = new Command()

const PACKAGES_OPTION = [
  '--packages <names>',
  'Comma-separated package dir names, skipping the interactive picker (e.g. --packages vue-toast-kit,os-detect).',
]
const YES_OPTION = ['--yes', 'Skip the "proceed?" confirmation.']

// commander's built-in "Commands:" list puts each command's flags inline
// after its name ("bump [--dry-run] [--packages <names>] [--yes]") — fine
// for one flag, cramped for three: the name column has to widen to fit the
// longest one, which pushes every description far to the right and leaves
// too little room left for them to wrap. This builds the same information
// as a two-level list instead — flags on their own indented line under
// their command — which is what stays readable once a command has more
// than one or two options.
function formatCommandsHelp(commands) {
  // Grouped per command (not one flat row list) so a blank line can go
  // between groups — without the grouping, nothing marks where one
  // command's options end and the next command's name begins.
  const groups = commands
    .filter((cmd) => cmd.name() !== 'help')
    .map((cmd) => {
      const aliases = cmd.aliases()
      const label = aliases.length ? `${cmd.name()}, ${aliases.join(', ')}` : cmd.name()
      return [
        { indent: 0, label, desc: cmd.description() },
        ...cmd.options.map((opt) => ({ indent: 1, label: opt.flags, desc: opt.description })),
      ]
    })

  const allRows = groups.flat()
  const labelWidth = Math.max(...allRows.map((r) => r.indent * 4 + r.label.length))
  const totalWidth = (process.stdout.isTTY && process.stdout.columns) || 96
  const descWidth = Math.max(totalWidth - (2 + labelWidth + 2), 30)

  const lines = ['Commands:']
  groups.forEach((group, i) => {
    if (i > 0) lines.push('')
    for (const r of group) {
      const fullLabel = ' '.repeat(r.indent * 4) + r.label
      const [firstLine, ...restLines] = wrapText(r.desc, descWidth)
      lines.push(`  ${fullLabel.padEnd(labelWidth)}  ${firstLine}`)
      for (const cont of restLines) {
        lines.push(`  ${' '.repeat(labelWidth)}  ${cont}`)
      }
    }
  })
  return lines.join('\n')
}

function wrapText(text, width) {
  const words = text.split(' ')
  const lines = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (current && candidate.length > width) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)
  return lines
}

program
  .name('polyrepo')
  .description(
    'Manage local npm package repos: pick which directories to scan (setup), clone missing ones from GitHub (clone), see their state (list), outdated dependencies (outdated), or open PRs (prs), run a health check (doctor), keep them on an up-to-date master (switch-master), release a version through a PR (bump), publish to npm (publish), tag an already-current version (tag), create GitHub Releases (release), or run any command across every repo (exec).',
  )
  .version('1.0.0')
  .option(
    '--config <path>',
    'Path to a polyrepo.config.json listing roots/packages to scan (default: polyrepo.config.json next to this CLI).',
  )
  // Hide commander's own one-line-per-command list (see formatCommandsHelp
  // above for why) — the "after" text below replaces it with the two-level
  // version instead of showing both.
  .configureHelp({ visibleCommands: () => [] })
  .addHelpText(
    'after',
    () => `
${formatCommandsHelp(program.commands)}

Getting started:
  First run \`polyrepo setup\` to tell it where your package repos live — a folder
  of repos (a "root", subfolders are scanned) and/or individual repo folders
  ("packages"). \`polyrepo doctor\` checks the rest of your setup (git/gh/npm,
  auth, cross-package dependency drift). Everything else reads the same
  package list.

Examples:
  $ polyrepo setup                              Add/edit/remove package source directories
  $ polyrepo clone --org my-org                 Clone repos from GitHub that aren't local yet
  $ polyrepo doctor                             Check environment, auth, and dependency drift
  $ polyrepo list                               Show version + branch for every package
  $ polyrepo outdated                           Show outdated dependencies across every package
  $ polyrepo prs                                List open pull requests across every package
  $ polyrepo switch-master                      Update selected repos to the latest master
  $ polyrepo bump --dry-run                     Preview a version bump, nothing is pushed
  $ polyrepo bump --minor --packages a,b --yes  Bump specific packages' minor version, non-interactively
  $ polyrepo publish                            Publish packages that are ahead of the registry
  $ polyrepo tag                                Tag an already-current version (no bump needed)
  $ polyrepo release                            Create GitHub Releases for tagged packages
  $ polyrepo exec -- npm test                   Run any command across every (or selected) package

Run \`polyrepo <command> --help\` for that command's own options and examples.
`,
  )

program
  .command('setup')
  .description('View, add, edit, or remove the roots/packages entries in polyrepo.config.json.')
  .addHelpText(
    'after',
    `
A "root" is a folder whose direct subfolders are packages (e.g. C:\\work\\NPM).
A "package" is a single repo folder given directly, for one that doesn't live
under any root. Both are edited through the same menu; nothing is written to
disk until you choose "Save and exit".

Examples:
  $ polyrepo setup
  $ polyrepo setup --config "D:\\other\\polyrepo.config.json"   Edit a different config file
`,
  )
  .action(() => setupCommand({ configPath: program.opts().config }))

program
  .command('clone')
  .description("Clone repos from a GitHub org/user that aren't already present under a root.")
  .requiredOption('--org <name>', 'GitHub org or user to list repos from.')
  .option('--root <path>', "Root directory to clone into (default: the config's first root).")
  .option('--include-archived', 'Also offer archived repos (skipped by default).')
  .option(...PACKAGES_OPTION)
  .option(...YES_OPTION)
  .option('--dry-run', 'Print what would be cloned, without actually cloning anything.')
  .addHelpText(
    'after',
    `
Lists every repo under --org (via \`gh repo list\`), compares it against the
directory names already found under the target root, and offers to clone
whatever's missing. Archived repos are skipped by default (--include-archived
to include them). \`--packages\` here means "only offer these repo names",
same as everywhere else. Cloning into a root that isn't in your config yet
still works — you're just reminded to run \`polyrepo setup\` afterward so
\`list\`/\`doctor\`/etc. pick the new repos up too.

Examples:
  $ polyrepo clone --org my-github-org
  $ polyrepo clone --org my-github-org --root "C:\\work\\NPM" --yes
  $ polyrepo clone --org my-github-org --dry-run
`,
  )
  .action((opts) =>
    cloneCommand({
      configPath: program.opts().config,
      org: opts.org,
      root: opts.root,
      includeArchived: Boolean(opts.includeArchived),
      packages: opts.packages ? opts.packages.split(',') : undefined,
      yes: Boolean(opts.yes),
      dryRun: Boolean(opts.dryRun),
    }),
  )

program
  .command('list')
  .alias('ls')
  .description('Show version, branch, tag, release, npm, and dependency status for every package.')
  .option('--quick', 'Skip the tag/release/npm/dependency checks — just version, branch, and git status.')
  .option('--path', "Add a Path column showing each package's location on disk.")
  .addHelpText(
    'after',
    `
Read-only — safe to run any time. By default, for every package: local
version, branch, git status (clean/dirty), whether the current version is
tagged, whether that tag has a GitHub Release, whether the npm registry
matches (or the registry version if it doesn't, or "unpublished"), and how
many other local packages reference it with a now-stale dependency range
(see \`polyrepo doctor\`). Everything (git, tag, release, npm) runs in parallel
across packages, not one at a time — still not instant with the extra
network checks, so use --quick for just version/branch/git when that's
all you need. --path adds a Path column right after Package, for when a
package's directory name alone doesn't tell you where it actually lives
(e.g. it was found via a --packages entry, not a root).

Examples:
  $ polyrepo list
  $ polyrepo ls
  $ polyrepo list --quick                       Just version/branch/git, no network calls
  $ polyrepo list --path                        Also show each package's directory
`,
  )
  .action((opts) =>
    listCommand({
      configPath: program.opts().config,
      quick: Boolean(opts.quick),
      showPath: Boolean(opts.path),
    }),
  )

program
  .command('outdated')
  .description('Show outdated dependencies across every package (npm outdated).')
  .option(...PACKAGES_OPTION)
  .addHelpText(
    'after',
    `
Read-only. Runs \`npm outdated --json\` for every package in parallel and
prints one flat table: package, dependency, current/wanted/latest version.
Packages with nothing outdated don't add any rows. \`--packages\` here just
narrows which packages are checked — there's no checkbox, nothing to
confirm.

Examples:
  $ polyrepo outdated
  $ polyrepo outdated --packages vue-toast-kit,os-detect
`,
  )
  .action((opts) =>
    outdatedCommand({
      configPath: program.opts().config,
      packages: opts.packages ? opts.packages.split(',') : undefined,
    }),
  )

program
  .command('prs')
  .description('List open pull requests across every package.')
  .option(...PACKAGES_OPTION)
  .addHelpText(
    'after',
    `
Read-only. Runs \`gh pr list\` for every package in parallel and prints one
flat table: package, PR number, title, branch, draft status. Packages with
no open PRs don't add any rows — useful after an interrupted \`polyrepo bump\`
run to see which packages still have a PR waiting to be merged by hand.

Examples:
  $ polyrepo prs
  $ polyrepo prs --packages vue-toast-kit,os-detect
`,
  )
  .action((opts) =>
    prsCommand({
      configPath: program.opts().config,
      packages: opts.packages ? opts.packages.split(',') : undefined,
    }),
  )

program
  .command('doctor')
  .description('Check environment (node/git/gh/npm, auth), config, and cross-package dependency drift.')
  .addHelpText(
    'after',
    `
Read-only. Three sections: Environment (is Node.js new enough, are git/gh/npm
on PATH and authenticated), Config (does polyrepo.config.json resolve to any
packages, which repos are dirty or off master), and Cross-package
dependencies (does any local package's dependencies/devDependencies/
peerDependencies range no longer match another local package's current
version — e.g. after a \`bump\` that package's own package.json wasn't
updated for). Run this first if any other command is behaving strangely.

Examples:
  $ polyrepo doctor
`,
  )
  .action(() => doctorCommand({ configPath: program.opts().config }))

program
  .command('switch-master')
  .alias('sm')
  .description('Pick repos and switch each to an up-to-date master.')
  .option(...PACKAGES_OPTION)
  .option(...YES_OPTION)
  .addHelpText(
    'after',
    `
For each selected repo: fetch, checkout master, fast-forward-only merge.
A repo with uncommitted changes is skipped with a warning, never touched.
If local master has diverged from origin (fast-forward impossible), that
repo is reported and left alone for you to resolve by hand.

Examples:
  $ polyrepo switch-master
  $ polyrepo sm --packages vue-toast-kit,os-detect --yes
`,
  )
  .action((opts) =>
    switchMasterCommand({
      configPath: program.opts().config,
      packages: opts.packages ? opts.packages.split(',') : undefined,
      yes: Boolean(opts.yes),
    }),
  )

program
  .command('bump')
  .description('Pick packages, bump their version (patch by default), PR, merge to master, and tag.')
  .option('--dry-run', 'Print every step without pushing, opening, merging, or tagging anything for real.')
  .option('--minor', 'Bump the minor version instead of patch (e.g. 1.2.9 → 1.3.0).')
  .option('--major', 'Bump the major version instead of patch (e.g. 1.2.9 → 2.0.0).')
  .option(...PACKAGES_OPTION)
  .option(...YES_OPTION)
  .option('--wait-checks', 'Wait for CI checks on the PR (if any are configured) before merging; abort if they fail.')
  .addHelpText(
    'after',
    `
Branch, PR, merge, and tag — no npm publish here, that's its own command
(see \`polyrepo publish\`; for a GitHub Release from the resulting tag, see
\`polyrepo release\`). Bumps the patch version by default; \`--minor\`/\`--major\`
bump that part instead (resetting the parts below it to 0, same as any
semver tool). Safe to re-run: if a previous attempt already pushed a
branch, opened a PR, or even merged it, this picks up from there instead of
failing or duplicating work. If the package has a CHANGELOG.md, a draft
entry (Keep a Changelog style, seeded from the commit log since the last
tag) is added to the same commit — review/edit it before merging if you
want it polished. After every package is processed, any other local
package whose dependencies/peerDependencies/devDependencies no longer
match a bumped package's new version is reported (nothing is changed
automatically).

Examples:
  $ polyrepo bump --dry-run                     See the plan, nothing changes
  $ polyrepo bump                               Interactive: checkbox + confirm, patch bump
  $ polyrepo bump --minor                       Interactive minor bump
  $ polyrepo bump --wait-checks                 Wait for CI to go green before merging
  $ polyrepo bump --packages a,b --yes          Non-interactive, for scripts/CI
`,
  )
  .action((opts) => {
    if (opts.minor && opts.major) {
      console.error('Cannot combine --minor and --major — pick one.')
      process.exitCode = 1
      return
    }
    return bumpCommand({
      dryRun: Boolean(opts.dryRun),
      configPath: program.opts().config,
      packages: opts.packages ? opts.packages.split(',') : undefined,
      yes: Boolean(opts.yes),
      waitChecks: Boolean(opts.waitChecks),
      bumpType: opts.major ? 'major' : opts.minor ? 'minor' : 'patch',
    })
  })

program
  .command('publish')
  .description('Pick packages and run "npm publish" — pre-selects ones ahead of the registry.')
  .option('--dry-run', 'Run "npm publish --dry-run" instead of a real publish.')
  .option(...PACKAGES_OPTION)
  .option(...YES_OPTION)
  .addHelpText(
    'after',
    `
Compares each package's local version against the npm registry first (in
parallel — one round trip per package, not one after another), so the
checkbox pre-selects only what's actually ahead. Runs with a real terminal
(not captured), so an npm 2FA/OTP prompt works normally.

Examples:
  $ polyrepo publish                            See what needs publishing, then publish it
  $ polyrepo publish --dry-run                  Full build + pack, nothing actually published
  $ polyrepo publish --packages a,b --yes       Non-interactive, for scripts/CI
`,
  )
  .action((opts) =>
    publishCommand({
      dryRun: Boolean(opts.dryRun),
      configPath: program.opts().config,
      packages: opts.packages ? opts.packages.split(',') : undefined,
      yes: Boolean(opts.yes),
    }),
  )

program
  .command('tag')
  .description('Tag selected packages at their current version, without bumping — then optionally release.')
  .option('--dry-run', 'Print every step without actually tagging, pushing, or releasing anything.')
  .option(...PACKAGES_OPTION)
  .option(...YES_OPTION)
  .option('--release', 'After tagging, create a GitHub Release for each package just tagged, without asking.')
  .addHelpText(
    'after',
    `
For a package whose version was bumped some other way (not through
\`polyrepo bump\`, or before it started tagging) — puts the \`v<version>\` tag on
master's current tip, no version change and no PR, so \`polyrepo release\` has
something to work from. Re-syncs master first for each package, same as
\`bump\` does. Already-tagged packages are shown but unchecked by default
(picking one anyway just confirms the tag is there, harmless). After
tagging, asks whether to create a GitHub Release right away for whatever
was just tagged (same as running \`polyrepo release\` for exactly those
packages) — \`--release\` answers that yes without asking, for scripts.

Examples:
  $ polyrepo tag                                See what needs tagging, tag it, then offered to release
  $ polyrepo tag --dry-run                      Print the plan, tag and release nothing
  $ polyrepo tag --packages a,b --yes --release Non-interactive: tag and release, for scripts/CI
`,
  )
  .action((opts) =>
    tagCommand({
      dryRun: Boolean(opts.dryRun),
      configPath: program.opts().config,
      packages: opts.packages ? opts.packages.split(',') : undefined,
      yes: Boolean(opts.yes),
      release: Boolean(opts.release),
    }),
  )

program
  .command('release')
  .description('Pick packages and create a GitHub Release for their current version\'s tag.')
  .option('--dry-run', 'Print what would be created, without actually creating any release.')
  .option(...PACKAGES_OPTION)
  .option(...YES_OPTION)
  .addHelpText(
    'after',
    `
A release always targets the tag \`polyrepo bump\` (or \`polyrepo tag\`, for a version
that was already correct) already created for the package's current
version (\`v<version>\`, e.g. v1.2.10) — \`--verify-tag\` is passed to
\`gh release create\` so it fails loudly instead of inventing one. Packages
with no tag yet for their current version show up disabled in the
checkbox ("run \`polyrepo bump\` first"); ones already released are selectable
but unchecked, in case you want to re-run it. Release notes come from the
matching CHANGELOG.md section when there is one, otherwise from gh's own
--generate-notes (summarizing merged PRs/commits).

Examples:
  $ polyrepo release                            See what's tagged but not released, then release it
  $ polyrepo release --dry-run                  Print the plan, create nothing
  $ polyrepo release --packages a,b --yes       Non-interactive, for scripts/CI
`,
  )
  .action((opts) =>
    releaseCommand({
      dryRun: Boolean(opts.dryRun),
      configPath: program.opts().config,
      packages: opts.packages ? opts.packages.split(',') : undefined,
      yes: Boolean(opts.yes),
    }),
  )

program
  .command('exec')
  .description('Run an arbitrary command in each selected package.')
  .argument('<cmd...>', 'Command to run, after a literal -- (e.g. `polyrepo exec -- npm test`).')
  .option(...PACKAGES_OPTION)
  .option(...YES_OPTION)
  .option('--bail', 'Stop at the first package that exits non-zero, instead of continuing through the rest.')
  .addHelpText(
    'after',
    `
Shows a checkbox of every discovered package (all checked by default —
"run everywhere" is the common case), then runs the given command in each
selected one, one at a time, with a real terminal (its output, colors, and
any prompts show up normally). A package that exits non-zero is reported
and, by default, the run continues with the rest — pass --bail to stop
immediately instead. A summary of any failed packages is printed at the
end, and the process exits non-zero if any package failed.

The command itself must come after a literal --, same as \`npm run <script> --\`
— anything before it is parsed as polyrepo's own options.

Examples:
  $ polyrepo exec -- npm test                         Run tests everywhere
  $ polyrepo exec --packages a,b --yes -- npm outdated Non-interactive, specific packages
  $ polyrepo exec --bail -- npm run lint               Stop at the first package that fails lint
`,
  )
  .action((cmd, opts) =>
    execCommand({
      configPath: program.opts().config,
      packages: opts.packages ? opts.packages.split(',') : undefined,
      yes: Boolean(opts.yes),
      bail: Boolean(opts.bail),
      cmd,
    }),
  )

program.parseAsync(process.argv).catch((err) => {
  // Ctrl+C during any @inquirer prompt (checkbox/select/confirm/input)
  // rejects with this instead of just resolving to nothing — left
  // uncaught, Node prints the full internal readline/keypress stack
  // trace, which reads like a real crash even though the user just
  // meant "never mind." @inquirer/prompts doesn't export the error
  // class for an instanceof check, so this is the documented way to
  // recognize it: by name.
  if (err?.name === 'ExitPromptError') {
    console.log(pc.dim('\nCancelled.'))
    process.exit(0)
  }
  console.error(err)
  process.exitCode = 1
})
