#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Command } from 'commander'
import pc from 'picocolors'
import { listCommand } from './commands/list.js'
import { doctorCommand } from './commands/doctor.js'
import { switchDefaultCommand } from './commands/switchDefault.js'
import { bumpCommand } from './commands/bump.js'
import { publishCommand } from './commands/publish.js'
import { tagCommand } from './commands/tag.js'
import { releaseCommand } from './commands/release.js'
import { setupCommand } from './commands/setup.js'
import { execCommand } from './commands/exec.js'
import { outdatedCommand } from './commands/outdated.js'
import { auditCommand } from './commands/audit.js'
import { prsCommand } from './commands/prs.js'
import { cloneCommand } from './commands/clone.js'

// Read once from package.json rather than a literal string here — the two
// silently drifted apart before (this file said 1.0.0 while package.json
// had already moved to 1.0.1).
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const { version: CLI_VERSION } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))

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
    'Manage local npm package repos: pick which directories to scan (setup), clone missing ones from GitHub (clone), see their state (list), outdated dependencies (outdated), security vulnerabilities (audit), or open PRs (prs), run a health check (doctor), keep them on an up-to-date default branch (switch-default), release a version through a PR (bump), publish to npm (publish), tag an already-current version (tag), create GitHub Releases (release), or run any command across every repo (exec).',
  )
  .version(CLI_VERSION)
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
  $ polyrepo audit                              Show npm security vulnerabilities across every package
  $ polyrepo prs                                List open pull requests across every package
  $ polyrepo switch-default                     Update selected repos to their latest default branch
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
  .option('--output <path>', 'Also save the table to this file, for sending the data somewhere.')
  .option(
    '--format <type>',
    'File format for --output: md, json, csv, html, or txt. Guessed from the file extension if omitted.',
  )
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

--output saves the exact same table (same columns as printed — respects
--quick/--path) to a file, in addition to printing it. --format picks the
file format (md/json/csv/html/txt); without it, the format is guessed from
--output's extension (.json → json, .md/.markdown → markdown, .csv → csv,
.html/.htm → html, anything else → plain text).

Examples:
  $ polyrepo list
  $ polyrepo ls
  $ polyrepo list --quick                       Just version/branch/git, no network calls
  $ polyrepo list --path                        Also show each package's directory
  $ polyrepo list --output packages.json        Also save as JSON (format guessed from extension)
  $ polyrepo list --output report.txt --format md  Save as Markdown despite the .txt name
`,
  )
  .action((opts) =>
    listCommand({
      configPath: program.opts().config,
      quick: Boolean(opts.quick),
      showPath: Boolean(opts.path),
      format: opts.format,
      output: opts.output,
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
  .command('audit')
  .description('Show npm security vulnerabilities across every package (npm audit).')
  .option(...PACKAGES_OPTION)
  .addHelpText(
    'after',
    `
Read-only. Runs \`npm audit --json\` for every package in parallel and prints
one flat table: package, dependency, severity (critical/high/moderate/low),
whether it's a direct or transitive dependency, and whether a fix is
available (and at what version, if that fix would mean a semver-major bump
of a top-level dependency). Packages with nothing found don't add any rows.
\`--packages\` here just narrows which packages are checked — there's no
checkbox, nothing to confirm, and nothing is changed; for that, fix the
version by hand or re-run \`polyrepo outdated\`/\`npm audit fix\` yourself.

Examples:
  $ polyrepo audit
  $ polyrepo audit --packages vue-toast-kit,os-detect
`,
  )
  .action((opts) =>
    auditCommand({
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
  .description('Check environment, config, branch health, and dependency drift — with a few safe self-repairs.')
  .option(
    '--clean-branches',
    'After scanning, show a checkbox of local bump branches whose PR is already merged, and delete the ones you pick.',
  )
  .addHelpText(
    'after',
    `
Seven sections. Most are read-only diagnosis; three include a small,
non-destructive self-repair:

  Environment           Node.js version, git/gh/npm on PATH and authenticated.
  Config                how many packages the config resolves to; which are
                        dirty, in a detached HEAD state, or off their
                        default branch.
  Remote sync           compares each repo's locally cached default-branch
                        name against what GitHub reports right now — git
                        never refreshes that cache on its own, so a rename
                        on GitHub would otherwise go unnoticed by every
                        other command forever; drifted ones are fixed with
                        \`git remote set-head origin --auto\`. Also runs
                        \`git remote prune origin\` on every repo, dropping
                        local refs for branches already deleted on GitHub.
                        Both are pointer-only fixes — no file, branch, or
                        commit is ever touched.
  Branch sync           fetches and compares each repo's local default
                        branch against origin: diverged (needs manual
                        resolution), behind only (safe to fast-forward with
                        \`switch-default\`), or ahead only (unpushed local
                        commits) — surfaced before a command trips over it.
  Branch protection     whether each repo's default branch actually has
                        GitHub branch protection enabled. Report-only —
                        enabling protection is a policy choice, not
                        something to set on your behalf.
  Stale bump branches   \`bump\` merges through a PR with the branch left on
                        origin (see \`bump\` above), so a local copy sticks
                        around too. Reports how many have an already-merged
                        PR; \`--clean-branches\` turns that into a checkbox
                        to delete the local ones you pick (\`git branch -d\`
                        — never the branch on origin, and refuses instead
                        of forcing if a branch isn't actually fully merged
                        locally).
  Cross-package deps    does any local package's dependency range no longer
                        match another local package's current version.

Run this first if any other command is behaving strangely, and any time
you rename a branch on GitHub or want to check for accumulated cruft.

Examples:
  $ polyrepo doctor
  $ polyrepo doctor --clean-branches
`,
  )
  .action((opts) =>
    doctorCommand({
      configPath: program.opts().config,
      cleanBranches: Boolean(opts.cleanBranches),
    }),
  )

program
  .command('switch-default')
  .alias('sd')
  .description('Pick repos and switch each to its up-to-date default branch.')
  .option(...PACKAGES_OPTION)
  .option(...YES_OPTION)
  .option(
    '--force',
    "Discard uncommitted changes and any local-only commits on a repo's default branch, hard-resetting it to match origin.",
  )
  .option(
    '--clean',
    'With --force, also remove untracked files/directories (git clean -fd) — only valid together with --force.',
  )
  .addHelpText(
    'after',
    `
Each repo's default branch is detected per repo (from origin — GitHub
defaults new repos to "main", but plenty of people rename it, "master"
included, so this never assumes one name for every repo). For each
selected repo: fetch, checkout its default branch, fast-forward-only
merge. A repo with uncommitted changes is skipped with a warning, never
touched. If the local default branch has diverged from origin
(fast-forward impossible), that repo is reported and left alone for you
to resolve by hand.

--force changes this: dirty repos are no longer skipped, and every
selected repo gets \`git checkout -f <default branch>\` + \`git reset --hard
origin/<default branch>\` instead of the safe fast-forward-only merge —
uncommitted changes to tracked files and any local-only commits on that
branch are permanently discarded. Untracked files are still left alone
at this point (this isn't \`git clean\`) — add --clean to also run
\`git clean -fd\` (removes untracked files/directories that aren't
gitignored; gitignored paths like node_modules are still left alone,
this doesn't use -x). --clean only means anything alongside --force —
without it there's nothing to discard in the first place. The proceed
confirmation says how many selected repos are dirty and defaults to
"No" when --force would actually discard something.

Examples:
  $ polyrepo switch-default
  $ polyrepo sd --packages vue-toast-kit,os-detect --yes
  $ polyrepo sd --packages vue-toast-kit --force   Discard its local changes and hard-reset to origin
  $ polyrepo sd --packages vue-toast-kit --force --clean   Also remove untracked build output etc.
`,
  )
  .action((opts) => {
    if (opts.clean && !opts.force) {
      console.error('--clean only makes sense together with --force.')
      process.exitCode = 1
      return
    }
    return switchDefaultCommand({
      configPath: program.opts().config,
      packages: opts.packages ? opts.packages.split(',') : undefined,
      yes: Boolean(opts.yes),
      force: Boolean(opts.force),
      clean: Boolean(opts.clean),
    })
  })

program
  .command('bump')
  .description('Pick packages, bump their version (patch by default), PR, merge to the default branch, and tag.')
  .option('--dry-run', 'Print every step without pushing, opening, merging, or tagging anything for real.')
  .option('--minor', 'Bump the minor version instead of patch (e.g. 1.2.9 → 1.3.0).')
  .option('--major', 'Bump the major version instead of patch (e.g. 1.2.9 → 2.0.0).')
  .option(
    '--prerelease',
    'Bump (or start) a prerelease instead of patch/minor/major (e.g. 1.2.9 → 1.2.10-alpha.0, or 1.2.10-alpha.0 → 1.2.10-alpha.1). Combine with --preid to name it.',
  )
  .option(
    '--preid <name>',
    'Prerelease identifier for --prerelease, or combined with --minor/--major for a preminor/premajor prerelease (e.g. --major --preid beta → 2.0.0-beta.0). Defaults to "alpha".',
  )
  .option(
    '--custom-version <version>',
    'Set an exact version instead of computing one. Requires --packages with exactly one package.',
  )
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

\`--prerelease\` bumps or starts a prerelease instead (\`--preid\` names it,
default "alpha") — node-semver decides whether that means adding
\`-alpha.0\` to the current version or advancing an existing prerelease's
number. Pairing \`--preid\` with \`--minor\`/\`--major\` instead starts a
preminor/premajor prerelease (e.g. \`--major --preid beta\` on 1.2.9 →
2.0.0-beta.0). \`--custom-version\` skips computing a version entirely and
sets exactly what you give it — only allowed with \`--packages\` naming a
single package, since applying one literal version to several packages at
once is never actually what you want.

Examples:
  $ polyrepo bump --dry-run                     See the plan, nothing changes
  $ polyrepo bump                               Interactive: checkbox + confirm, patch bump
  $ polyrepo bump --minor                       Interactive minor bump
  $ polyrepo bump --prerelease --preid beta     Bump/start a beta prerelease
  $ polyrepo bump --major --preid rc            Start a premajor rc prerelease (e.g. 2.0.0-rc.0)
  $ polyrepo bump --packages a --custom-version 3.0.0-hotfix.1   Set an exact version for one package
  $ polyrepo bump --wait-checks                 Wait for CI to go green before merging
  $ polyrepo bump --packages a,b --yes          Non-interactive, for scripts/CI
`,
  )
  .action((opts) => {
    const shapeFlags = [opts.minor, opts.major, opts.prerelease, opts.customVersion].filter(Boolean)
    if (shapeFlags.length > 1) {
      console.error('Pick only one of --minor, --major, --prerelease, or --custom-version.')
      process.exitCode = 1
      return
    }
    if (opts.customVersion && (opts.packages ?? '').split(',').filter(Boolean).length !== 1) {
      console.error('--custom-version requires --packages with exactly one package.')
      process.exitCode = 1
      return
    }

    let bumpType = 'patch'
    if (opts.customVersion) bumpType = 'custom'
    else if (opts.prerelease) bumpType = 'prerelease'
    else if (opts.major) bumpType = opts.preid ? 'premajor' : 'major'
    else if (opts.minor) bumpType = opts.preid ? 'preminor' : 'minor'
    else if (opts.preid) bumpType = 'prerelease'

    return bumpCommand({
      dryRun: Boolean(opts.dryRun),
      configPath: program.opts().config,
      packages: opts.packages ? opts.packages.split(',') : undefined,
      yes: Boolean(opts.yes),
      waitChecks: Boolean(opts.waitChecks),
      bumpType,
      preid: bumpType.startsWith('pre') ? opts.preid || 'alpha' : undefined,
      customVersion: opts.customVersion,
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
its default branch's current tip, no version change and no PR, so
\`polyrepo release\` has something to work from. Re-syncs the default branch
first for each package, same as \`bump\` does. Already-tagged packages are
shown but unchecked by default
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
