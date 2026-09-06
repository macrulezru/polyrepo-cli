# polyrepo-cli

An interactive CLI for managing a folder of local npm package repos:
version bumps through a pull request, npm publishing, GitHub releases,
and cross-package dependency drift — all from one tool, all reviewable
with `--dry-run` before anything actually changes.

## Features

- **`setup`** — add, edit, or remove the package directories the CLI
  scans, right from the terminal — no hand-editing JSON.
- **`clone`** — diff a GitHub org/user's repo list against what's
  already cloned under a root, and clone whatever's missing.
- **`list`** — one table per package: version, branch, git status, git
  tag, GitHub Release, npm registry status, and cross-package
  dependency drift. `list --quick` skips the network checks for an
  instant version/branch/git-only view; `list --output <path>` also
  saves the same table as Markdown, JSON, CSV, HTML, or plain text.
- **`outdated`** — one table across every package of what's outdated
  (`npm outdated`), instead of running it in each repo by hand.
- **`prs`** — one table of every open pull request across every
  package (`gh pr list`) — useful after an interrupted `bump` run to
  see what's still waiting to be merged.
- **`doctor`** — a one-command health check: is the environment set up
  correctly (Node/git/gh/npm, authentication), and does any local
  package still depend on an incompatible version of another local
  package.
- **`switch-master`** — fast-forward selected repos to an up-to-date
  `master`.
- **`bump`** — bump a package's version (patch by default, or
  `--minor`/`--major`) through a branch → PR → merge, then tag the
  release. Safe to re-run if a previous attempt was interrupted
  partway — it picks up from wherever it left off instead of failing
  or duplicating work. Can wait for CI checks before merging
  (`--wait-checks`), and drafts a `CHANGELOG.md` entry when the
  package already has one.
- **`publish`** — run `npm publish` for the packages that are actually
  ahead of the registry, after comparing each one automatically.
- **`tag`** — tag a package at its *current* version without bumping
  again, for when the version was already moved forward some other
  way. Offers to create a GitHub Release right after.
- **`release`** — create a GitHub Release from a tag, with notes
  pulled from the matching `CHANGELOG.md` section when there is one.
- **`exec`** — run any command (`npm test`, `npm outdated`, a lint
  script, anything) across every selected package, one at a time, with
  a real terminal.
- Every command that touches multiple repos supports `--packages` and
  `--yes` for fully non-interactive use in scripts.

Everywhere a checkbox list appears, columns line up consistently
across commands, and read-only checks across many packages (versions,
tags, releases, registry state) run in parallel instead of one at a
time. Mutating steps (commit, push, merge) always run one package at a
time, printing each step as it happens, so progress stays easy to
follow.

## Requirements

- Node.js 20+
- `git` on `PATH`
- [`gh`](https://cli.github.com/) (GitHub CLI), authenticated
  (`gh auth status`) — needed for opening/merging pull requests,
  checking the state of a previous `bump` attempt, CI checks
  (`bump --wait-checks`), and `tag`/`release`
- `npm` on `PATH`, authenticated (`npm whoami`) — needed only for
  `publish`

Run `polyrepo doctor` to check all of this in one go.

## Installation

```bash
git clone <this repository's URL>
cd polyrepo-cli
npm install
```

Optionally, make `polyrepo` available everywhere:

```bash
npm link
```

Without `npm link`, run commands as `node src/index.js <command>`.

## Quick start

```bash
polyrepo setup      # tell it where your package repos live
polyrepo doctor     # confirm the environment is set up correctly
polyrepo list       # see version/branch/tag/release/npm status for everything
```

## Help

Every command has built-in `--help`:

```bash
polyrepo --help
polyrepo bump --help
```

`polyrepo --help` lists every command together with its flags, so you
rarely need to open a command's own `--help` just to remember an
option name.

## Commands

### `polyrepo setup`

An interactive menu for `polyrepo.config.json` itself — no need to open the
JSON by hand. Shows the current `roots` and `packages` lists with
`✓ exists` / `✗ not found` (and, for `packages`, `! no
package.json/.git here` when the folder exists but isn't a package),
and lets you:

- add a root or package directory
- edit an existing entry
- remove an entry (with confirmation)

A path isn't checked strictly — adding one that doesn't exist yet
just prints a warning, in case the folder shows up later. Changes are
only written to disk when you choose "Save and exit"; "Discard changes
and exit" throws away anything done in that session.

```bash
polyrepo setup

# edit a non-default config
polyrepo setup --config "/path/to/polyrepo.config.json"
```

### `polyrepo clone`

Diffs a GitHub org/user's repo list against what's already cloned
under a root, and clones whatever's missing:

1. `gh repo list <org>` — every repo under that org/user (archived
   ones are skipped by default, `--include-archived` to include them).
2. Compares the names against the directories already found under the
   target root (`--root`, or the first root in your config if not
   given).
3. Shows a checkbox of the missing ones (all checked by default), then
   `git clone`s each selected one into the target root, one at a time.

`--org` is required and isn't stored in the config — the config's
`roots`/`packages` describe *where local repos live*, not which
GitHub account they came from. Cloning into a root that isn't in the
config yet still works — you'll just be reminded to run
`polyrepo setup` afterward so `list`/`doctor`/etc. pick the new repos
up too.

**Options:**

| Flag | What it does |
| --- | --- |
| `--org <name>` | GitHub org or user to list repos from (required). |
| `--root <path>` | Root directory to clone into. Defaults to the config's first `roots` entry. |
| `--include-archived` | Also offer archived repos. |
| `--packages <a,b,c>` | Only offer these repo names instead of the interactive checkbox. |
| `--yes` | Skip the "proceed?" confirmation. |
| `--dry-run` | Print what would be cloned; clone nothing. |

```bash
polyrepo clone --org my-github-org

# a specific root, no prompts
polyrepo clone --org my-github-org --root "C:\work\NPM" --yes
```

### `polyrepo list` (alias `ls`)

A table of every discovered package. Full summary by default:

| Column | Shows |
| --- | --- |
| Package / Version / Branch | directory name, `package.json` version, current branch |
| Git | whether the working tree is clean or dirty |
| Tag | the `v<version>` tag for the current version, if it exists, else `—` |
| Release | whether that tag has a GitHub Release (`✓`/`✗`/`—` if untagged) |
| npm | `✓` if the registry matches the local version, else the registry version or `unpublished` |
| Deps | `✓`, or `⚠ N` — how many other local packages reference this one with a version range that no longer matches (same check as `doctor` and the end of `bump`) |

Read-only. The git/tag/release/npm checks run in parallel across
packages, but they're still real network calls (tag, release, and
registry — three per package), so a full `polyrepo list` across many
packages takes a few seconds rather than being instant. Use `--quick`
for just version/branch/git status when that's all you need. Add
`--path` for a **Path** column (right after Package) showing where
each one actually lives on disk — handy once packages come from a mix
of `roots` and one-off `packages` entries and the directory name alone
doesn't say where to find it.

`--output <path>` additionally saves the exact same table (same
columns as printed — respects `--quick`/`--path`) to a file, for
sending the data somewhere. `--format` picks the file format —
`md` (Markdown table), `json` (array of objects), `csv` (RFC
4180-quoted), `html` (a standalone page, openable directly in a
browser), or `txt` (plain aligned columns, no ANSI colors); without
it, the format is guessed from `--output`'s extension (`.json` →
json, `.md`/`.markdown` → markdown, `.csv` → csv, `.html`/`.htm` →
html, anything else → plain text). In JSON, a cell that's just the
terminal's ✓/✗ checkmark (e.g. Release, or npm when it's up to date)
becomes a real `true`/`false` — anything carrying more information
than a plain yes/no (an outdated registry version, `⚠ N` stale deps,
`clean`/`dirty`) stays text.

**Options:**

| Flag | What it does |
| --- | --- |
| `--quick` | Skip the tag/release/npm/dependency checks — just version, branch, git status. |
| `--path` | Add a Path column showing each package's location on disk. |
| `--output <path>` | Also save the table to this file. |
| `--format <md\|json\|csv\|html\|txt>` | File format for `--output`. Guessed from the file extension if omitted. |

```bash
polyrepo list

# version/branch/git only — no network calls
polyrepo list --quick

# also show each package's directory
polyrepo list --path

# also save as JSON (format guessed from the .json extension)
polyrepo list --output packages.json

# save as Markdown regardless of the file's own extension
polyrepo list --output report.txt --format md
```

### `polyrepo outdated`

Read-only. Runs `npm outdated --json` for every package in parallel
and prints one table (Package, Dependency, Current, Wanted, Latest)
instead of running it in each repo by hand — with a blank line
between each package's rows for readability, and a summary line above
the table (`N dependencies outdated across M package(s), K of them
major version behind`). The **Latest** column is colored by how far
behind it is — red for a major bump, yellow for minor, dim for patch
— so what actually needs a look stands out from routine bumps.
Packages with nothing outdated just don't add any rows.

```bash
polyrepo outdated

# only these packages
polyrepo outdated --packages vue-toast-kit,os-detect
```

### `polyrepo prs`

Read-only. Runs `gh pr list` for every package in parallel and prints
one flat table (Package, PR, Title, Branch, Status). Useful after an
interrupted `polyrepo bump` run, to see at a glance which packages
still have a PR open that needs merging by hand.

```bash
polyrepo prs

# only these packages
polyrepo prs --packages vue-toast-kit,os-detect
```

### `polyrepo doctor`

A read-only health check in three sections:

1. **Environment** — Node.js version (20+ required), whether
   `git`/`gh`/`npm` are on `PATH`, and whether `gh`/`npm` are
   authenticated (npm auth is only a warning — it's only needed for
   `publish`).
2. **Config** — how many packages the current config actually
   resolves to, and which repos are dirty or off `master`.
3. **Cross-package dependencies** — the same dependency-drift check
   that runs at the end of `bump`, available on demand without
   bumping anything.

Worth running first if any other command is behaving unexpectedly.

```bash
polyrepo doctor
```

### `polyrepo switch-master` (alias `sm`)

1. Shows a checkbox list of every repo with its current branch; repos
   not currently on `master` are pre-selected.
2. After confirming, for each selected repo, one at a time (each
   step's result prints immediately, not after the whole batch):
   - a dirty working tree is skipped with a warning, untouched;
   - otherwise: `git fetch origin` → `git checkout master` →
     `git merge --ff-only origin/master`.
3. If local `master` has diverged from `origin/master` (fast-forward
   isn't possible), that repo is reported and left alone to resolve by
   hand — no `--force`/`reset --hard` is ever used.

```bash
polyrepo switch-master

# no checkbox, specific repos, no confirmation — for scripts
polyrepo switch-master --packages vue-toast-kit,os-detect --yes
```

### `polyrepo bump [options]`

1. Shows a checkbox of packages with their current version and the
   version they'd bump to (`1.2.9 → 1.2.10` for a patch bump, the
   default — `--minor`/`--major` bump that part instead, resetting
   the parts below it to `0`, same as any semver tool). Packages
   with a dirty working tree are marked — they'll be skipped. The
   highlighted package's description shows what's actually changed
   since the last git tag (`git log <tag>..master`) — if that's empty,
   there's probably nothing worth bumping. These previews are computed
   for every package in parallel, not one at a time.
2. After confirming, for each selected package, one at a time, with
   live progress:
   1. `git fetch origin` → `git checkout master` →
      `git merge --ff-only origin/master` (the bump branch is always
      created from an up-to-date master, not whatever branch the repo
      happened to be on);
   2. **checks the state of a previous attempt** — is there already a
      merged PR, an open PR, or just a pushed branch named
      `<new-version>-version-bump` (e.g. `1.2.10-version-bump` — the
      version number at the start of the branch name guarantees two
      different bumps never collide). Depending on what's found, it
      resumes from the right place instead of failing on "branch
      already exists" or opening a duplicate PR:
      - **already merged** — nothing to do (master was already synced
        in step 1), go straight to tagging;
      - **open PR exists** — merge that one, don't open a new one;
      - **branch pushed, no PR** — reuse the branch, open a PR;
      - **nothing exists** — the full flow from scratch.
   3. if `package.json` on the branch isn't bumped yet, its
      `"version"` field is updated (a text-level replace, not
      `JSON.parse`/`stringify` — formatting and field order are left
      alone). If the package already has a `CHANGELOG.md`, a draft
      `## [x.y.z] - YYYY-MM-DD` entry (Keep a Changelog style) is
      added too, with a `### Changed` section listing commits since
      the last tag (merge commits filtered out) — a starting draft to
      review, not a finished changelog. Packages without a
      `CHANGELOG.md` don't get one created. Both files are committed
      together;
   4. `gh pr create` against `master` (if there isn't one already);
   5. with `--wait-checks`: wait for the PR's CI checks via
      `gh pr checks --watch` (with a real terminal, live-updating). No
      checks configured isn't an error — there's just nothing to wait
      for. Failing checks stop that package's bump with an error and
      skip the merge;
   6. `gh pr merge --merge` — through a PR, not a direct push, since
      these repos require it;
   7. `git checkout master` → `git fetch origin` →
      `git merge --ff-only origin/master` — local master is synced to
      the just-merged PR;
   8. **git tag** `v<new-version>` (e.g. `v1.2.10`) is created and
      pushed if it doesn't already exist (idempotent, like everything
      else here — a re-run won't try to create it twice).
3. Any failure along the way (fetch/push/PR/CI/merge) marks that
   package ✗ with a clear message and moves on to the next one in the
   queue, without aborting the whole run.
4. **Once every selected package is processed** — a separate check
   across *all* packages (not just the ones just bumped): does any
   local package's `dependencies`/`devDependencies`/`peerDependencies`
   reference another local package with a range that no longer
   matches (e.g. package A declares `"pkg-b": "^1.2.0"` but the local
   version of `pkg-b` is `1.1.12`). Nothing is changed automatically —
   just a warning that it's worth checking and bumping/adjusting that
   dependency separately.

Publishing to npm and creating a GitHub Release are deliberately
separate steps — see `polyrepo publish` and `polyrepo release` below. Bumping a
batch of packages and then publishing or releasing only some of them
are different decisions that don't always happen at the same time.

**Options:**

| Flag | What it does |
| --- | --- |
| `--dry-run` | Prints the plan for each package, changes and pushes nothing — including the `CHANGELOG.md` entry, CI wait, and git tag. |
| `--minor` | Bump the minor version instead of patch (e.g. `1.2.9 → 1.3.0`). |
| `--major` | Bump the major version instead of patch (e.g. `1.2.9 → 2.0.0`). |
| `--packages <a,b,c>` | Comma-separated package dir names instead of the interactive checkbox — for scripts. Unknown names are printed as a warning and skipped. |
| `--yes` | Skip the "proceed?" confirmation. |
| `--wait-checks` | Wait for the PR's CI checks (if any are configured) before merging; don't merge if they fail. |

```bash
# dry run first — nothing is pushed, committed, merged, or tagged,
# it just shows what would happen
polyrepo bump --dry-run

# normal interactive run (patch bump)
polyrepo bump

# minor bump instead
polyrepo bump --minor

# wait for CI before merging
polyrepo bump --wait-checks

# fully non-interactive, for a script/CI
polyrepo bump --packages vue-toast-kit,os-detect --yes
```

### `polyrepo publish [options]`

1. Checks each package's registry version (`npm view <pkg> version`)
   against its local `package.json` version — in parallel, printing
   each result as it arrives (so the order reflects registry response
   time, not the package list order).
2. Shows a checkbox: registry version → local version. Packages where
   they differ (genuinely unpublished) are pre-selected; already
   published ones are unchecked but still selectable (e.g. to
   republish after an unpublish).
3. After confirming, for each selected package, one at a time:
   `npm publish` (or `npm publish --dry-run` with the `--dry-run`
   flag — npm's own dry run, including the real build and pack step,
   not just printing a plan). Runs with a real terminal, not captured
   — an npm 2FA/OTP prompt works normally.

**Options:**

| Flag | What it does |
| --- | --- |
| `--dry-run` | `npm publish --dry-run` instead of a real publish. |
| `--packages <a,b,c>` | Package list instead of the interactive checkbox. |
| `--yes` | Skip the "proceed?" confirmation. |

```bash
# see what's unpublished, then publish what you pick
polyrepo publish

# same, but nothing is actually published — just build and pack
polyrepo publish --dry-run

# specific packages, no prompts
polyrepo publish --packages vue-toast-kit,os-detect --yes
```

### `polyrepo tag [options]`

For a package whose version was already bumped some other way (not
through `polyrepo bump`, or before it started tagging), `polyrepo release` has
nothing to work with — there's no tag for the current version yet.
`polyrepo tag` puts the missing tag on the current version without bumping
it again or opening a PR:

1. Checks each package (in parallel) for whether a tag
   `v<local version>` already exists — printing progress per package.
2. Shows a checkbox: package, version, tag. Untagged packages are
   pre-selected; already-tagged ones can still be picked manually
   (harmless — it just confirms the tag is there).
3. After confirming, for each selected package, one at a time:
   `git fetch`/`checkout master`/`merge --ff-only` (tags an up-to-date
   master, same as `bump`), then creates and pushes the tag if it's
   missing.
4. If at least one package was actually tagged (and it wasn't a
   `--dry-run`), it asks: "Create a GitHub Release for the N
   package(s) just tagged?" — answering yes runs the same process as
   `polyrepo release` for exactly those packages (notes from `CHANGELOG.md`
   when available, otherwise `--generate-notes`).

**Options:**

| Flag | What it does |
| --- | --- |
| `--dry-run` | Prints the plan; tags, pushes, and releases nothing. |
| `--packages <a,b,c>` | Package list instead of the interactive checkbox. |
| `--yes` | Skip the "proceed?" confirmation (the release question is skipped too — no release is created unless `--release` is also given). |
| `--release` | Create a release right after tagging, without asking — for scripts. |

```bash
# see what needs tagging, tag it, get offered a release
polyrepo tag

# fully non-interactive: tag and release
polyrepo tag --packages vue-toast-kit,os-detect --yes --release
```

### `polyrepo release [options]`

1. Checks each package (in parallel) for a `v<local version>` tag on
   origin (the one `bump` or `tag` creates) and whether that tag
   already has a GitHub Release — printing progress per package.
2. Shows a checkbox: package and its tag. Packages with no tag for
   their current version are shown disabled ("no tag yet — run
   `polyrepo bump` first") — they can't be selected until tagged. Already
   released ones are shown as "(already released)" — selectable but
   not required.
3. After confirming, for each selected package, one at a time:
   `gh release create <tag> --verify-tag --title "<pkg>@<version>"`.
   `--verify-tag` guarantees this never invents a new tag — only ever
   uses one that already exists. Release notes come from the matching
   `CHANGELOG.md` section when there is one, otherwise
   `--generate-notes` (gh's own summary of merged PRs/commits).

**Options:**

| Flag | What it does |
| --- | --- |
| `--dry-run` | Prints what would be created; publishes nothing. |
| `--packages <a,b,c>` | Package list instead of the interactive checkbox. |
| `--yes` | Skip the "proceed?" confirmation. |

```bash
# see what's tagged but not released, then release it
polyrepo release

# specific packages, no prompts
polyrepo release --packages vue-toast-kit,os-detect --yes
```

### `polyrepo exec -- <command...>`

Runs any command in each selected package, one at a time, with a real
terminal (its output, colors, and any prompts show up normally —
useful for things like `npm test` that might want a TTY). Shows a
checkbox of every discovered package first (all checked by default —
"run everywhere" is the common case).

The command itself must come after a literal `--`, same as
`npm run <script> --` — anything before it is parsed as `polyrepo`'s
own options. A package that exits non-zero is reported and, by
default, the run continues through the rest; `--bail` stops
immediately instead. A summary of failed packages (if any) prints at
the end, and the process exits non-zero if anything failed.

**Options:**

| Flag | What it does |
| --- | --- |
| `--packages <a,b,c>` | Package list instead of the interactive checkbox. |
| `--yes` | Skip the "proceed?" confirmation. |
| `--bail` | Stop at the first package that exits non-zero. |

```bash
# run tests everywhere
polyrepo exec -- npm test

# specific packages, no prompts
polyrepo exec --packages vue-toast-kit,os-detect --yes -- npm outdated

# stop at the first failure
polyrepo exec --bail -- npm run lint
```

## Example output

```
[1/1] vue-toast-kit  1.0.7 → 1.0.8

  $ git fetch origin
  $ git checkout master
  $ git merge --ff-only origin/master
  ✓ master is up to date.
  ✓ Created branch 1.0.8-version-bump.
  ✓ Drafted a CHANGELOG.md entry — review it before merging if you want it polished.
  $ git commit -m chore: bump version to 1.0.8
  ✓ package.json version set to 1.0.8 and committed.
  $ git push -u origin 1.0.8-version-bump
  ✓ Branch pushed (or already up to date on origin).
  $ gh pr create --base master --head 1.0.8-version-bump ...
  ✓ Opened PR #12.
  $ gh pr merge 12 --merge --delete-branch=false
  ✓ Merged PR #12.
  ✓ Local master synced to origin at 1.0.8.
  $ git tag -a v1.0.8 -m v1.0.8
  $ git push origin v1.0.8
  ✓ Tagged and pushed v1.0.8.
```

Re-running `polyrepo bump` on the same package (say, a previous run was
interrupted at the CI or network step) is shorter — anything already
done is just confirmed, not redone:

```
[1/1] vue-toast-kit  1.0.7 → 1.0.8

  ✓ master is up to date.
  ✓ Already merged as PR #12 — master already has it.
  ✓ Tag v1.0.8 already exists on origin.
```

`polyrepo publish` on its own:

```
Checking 2 package(s) against the registry...
  vue-toast-kit: registry 1.0.7 ≠ local 1.0.8
  os-detect: registry 2.1.5 = local 2.1.5

? Pick packages to publish:
    vue-toast-kit  1.0.7 → 1.0.8

[1/1] vue-toast-kit@1.0.8
  $ npm publish
  ✓ Published vue-toast-kit@1.0.8.
```

`polyrepo release` on its own:

```
Checking 2 package(s) for a tag and an existing release...
  vue-toast-kit: v1.0.8 — ready
  os-detect: v2.1.5 — already released

? Pick packages to create a GitHub Release for:
    vue-toast-kit  v1.0.8

[1/1] vue-toast-kit  v1.0.8
  ✓ Using the matching CHANGELOG.md section as release notes.
  $ gh release create v1.0.8 --verify-tag --title vue-toast-kit@1.0.8 --notes-file ...
  ✓ Created release vue-toast-kit@1.0.8.
```

## Configuration

The list of directories to scan lives in `polyrepo.config.json` (next to
this project's own `package.json`) — edit it through `polyrepo setup`
(recommended) or by hand. Two independent arrays:

- `roots` — directories whose **subfolders** are scanned: each
  subfolder containing both `package.json` and `.git` counts as a
  package. Convenient when all your packages live next to each other
  in one shared folder.
- `packages` — directories that are themselves a package (not their
  subfolders) — for a single repo that doesn't live next to the rest.

Both arrays are optional and additive; you can list several `roots`
and any number of `packages`. A package found through both `roots` and
`packages` (e.g. a path that happens to overlap) is only counted once.
Relative paths in the config are resolved against the config file's
own location, not the current working directory. With no config file
at all, the CLI finds nothing and tells you to run `polyrepo setup` — there
is no built-in default path.

```json
{
  "roots": ["/path/to/folder-of-repos"],
  "packages": ["/path/to/a-single-repo"]
}
```

A ready-to-copy template is at `polyrepo.config.example.json` in the
project root — copy it to `polyrepo.config.json` and edit by hand, or fill
it in through `polyrepo setup`.

If a directory in `roots`/`packages` doesn't exist, or (for
`packages`) doesn't contain `package.json`/`.git`, the CLI prints a
warning and skips it without stopping the rest of the run.

A different config file can be pointed to with `--config` (works
before or after the subcommand) or the `POLYREPO_CONFIG` environment
variable:

```bash
polyrepo --config "/path/to/polyrepo.config.json" list
polyrepo list --config "/path/to/polyrepo.config.json"
```

For a one-off override without editing the file, `POLYREPO_ROOT` replaces
the configured `roots` entirely (`packages` is left as-is):

```bash
POLYREPO_ROOT="/other/path" polyrepo list
```

## Development

```bash
npm test
```

Unit tests cover the pure logic that doesn't need a real
`git`/`gh`/`npm` — version bumping, `CHANGELOG.md` entry insertion,
and cross-package dependency drift detection — using real temporary
files on disk rather than mocks.

## Author

Danil Lisin Vladimirovich, aka Macrulez — [macrulez.ru/en](https://macrulez.ru/en)

## License

MIT — see [LICENSE](./LICENSE).
