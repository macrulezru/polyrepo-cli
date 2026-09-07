# **Polyrepo CLI**

![Rest Pipeline JS](https://github.com/macrulezru/assets/blob/master/packages-images/polyrepo-cli.png?raw=true)

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
- **`audit`** — one table across every package of npm security
  vulnerabilities (`npm audit`), grouped by package and colored by
  severity, with whether a fix is available.
- **`prs`** — one table of every open pull request across every
  package (`gh pr list`) — useful after an interrupted `bump` run to
  see what's still waiting to be merged.
- **`doctor`** — a one-command health check: environment (Node/git/gh/npm,
  authentication), branch health (default-branch name drift, stale
  remote-tracking refs, divergence from origin, detached `HEAD`,
  missing branch protection, leftover `bump` branches — with a few
  safe, non-destructive self-repairs along the way, and
  `--clean-branches` for an interactive local-branch cleanup), and
  cross-package dependency drift.
- **`switch-default`** — fast-forward selected repos to their up-to-date
  default branch, whatever it's actually named (`master`, `main`, or
  anything else — detected per repo, not assumed). `--force` hard-resets
  a dirty repo to match origin; add `--clean` to also wipe untracked
  files/directories.
- **`bump`** — bump a package's version (patch by default, or
  `--minor`/`--major`; `--prerelease`/`--preid` to start or advance a
  prerelease; `--custom-version` for an exact version) through a
  branch → PR → merge, then tag the release. Safe to re-run if a
  previous attempt was interrupted partway — it picks up from wherever
  it left off instead of failing or duplicating work. Can wait for CI
  checks before merging (`--wait-checks`), and drafts a
  `CHANGELOG.md` entry when the package already has one.
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

📖 **Full documentation, every command's options, and more examples:**
[npm.vuecraft.ru/en/packages/polyrepo-cli](https://npm.vuecraft.ru/en/packages/polyrepo-cli/guide/overview.html)

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

Every command has built-in `--help` (`polyrepo --help`, `polyrepo bump --help`)
— and the [full manual](https://npm.vuecraft.ru/en/packages/polyrepo-cli/guide/overview.html)
covers every command's options and behavior in detail.

## Example output

`polyrepo doctor` — a health check with a few safe self-repairs along
the way (here: an unauthenticated npm login, and two leftover PR
branches on `os-detect` that GitHub already deleted):

```
Environment

  ✓ Node.js v22.23.2 (>= 20 required).
  ✓ git version 2.49.0.windows.1.
  ✓ gh version 2.69.0 (2025-03-19) — authenticated as macrulezru.
  ! npm 10.9.8 — not authenticated (only needed for `polyrepo publish`). Run `npm login`.

Config

Config file: C:\work\NPM\polyrepo.config.json
Checking 18 package(s)...
  ✓ 18 package(s) discovered.

Remote sync

Checking 18 package(s) against GitHub, and pruning stale remote-tracking refs...
  ✓ 18 package(s) checked — local default-branch cache matches GitHub.
  ✓ os-detect: pruned 2 stale remote-tracking ref(s) (add-more-examples, new-documentation-refactor).

Branch sync

Fetching and comparing 18 package(s) against origin...
  ✓ 18 package(s) checked — all in sync with origin.

Branch protection

Checking 18 package(s) for branch protection...
  ✓ 18 package(s) checked — default branch is protected on all of them.

Stale bump branches

Checking 18 package(s) for leftover bump branches with a merged PR...
  ✓ No stale bump branches found.

Cross-package dependencies

  ✓ No stale local dependency references found.
```

`polyrepo list` — version/branch/tag/release/npm/deps for every
package at a glance (truncated here — a real run covers all of them):

```
Package                   Version  Branch  Git    Tag      Release  npm  Deps
------------------------  -------  ------  -----  -------  -------  ---  ----
color-value-tools         1.1.12   master  clean  v1.1.12  ✓        ✓    ✓
css-magic-gradient        1.2.14   master  clean  v1.2.14  ✓        ✓    ✓
os-detect                 2.1.5    master  clean  v2.1.5   ✓        ✓    ✓
…
```

`polyrepo audit` — npm security vulnerabilities across every package,
sorted by severity, with whether a fix is available:

```
9 vulnerabilities across 1 package(s), 6 of them critical/high severity

Package    Dependency       Severity  Type        Fix available
---------  ---------------  --------  ----------  -------------
os-detect  brace-expansion  high      transitive  yes
os-detect  browserslist     high      transitive  yes
os-detect  js-yaml          high      transitive  yes
os-detect  nanoid           high      transitive  yes
os-detect  postcss          high      transitive  yes
os-detect  ws               high      transitive  yes
os-detect  @humanfs/node    moderate  transitive  yes
os-detect  @babel/core      low       transitive  yes
os-detect  esbuild          low       transitive  yes
```

`polyrepo switch-default --force` — hard-resetting a repo with an
uncommitted edit back to its default branch, whatever it's actually
named:

```
[1/1] vue-toast-kit
  $ git fetch origin
  $ git checkout -f master
    Your branch is up to date with 'origin/master'.
    Already on 'master'
  $ git reset --hard origin/master
    HEAD is now at 775ac80 init
  ✓ Discarded local changes — now on master, matching origin.
```

## Development

```bash
npm test
```

---

## Documentation & links

- 📖 **Full documentation:** [npm.vuecraft.ru/en/packages/polyrepo-cli](https://npm.vuecraft.ru/en/packages/polyrepo-cli/guide/overview.html)
- 🌐 **VueCraft:** [vuecraft.ru/en](https://vuecraft.ru/en)
- 👤 **Author:** [macrulez.ru/en](https://macrulez.ru/en)
- 💻 **GitHub:** [macrulezru/polyrepo-cli](https://github.com/macrulezru/polyrepo-cli)
- 📦 **NPM:** [polyrepo-cli](https://www.npmjs.com/package/polyrepo-cli)
- 🐛 **Issues:** [github.com/macrulezru/polyrepo-cli/issues](https://github.com/macrulezru/polyrepo-cli/issues)

---

## License

MIT

---

## 💖 Support the project

Open source takes time and effort. If this library saves you time or brings value, consider supporting further development.

<a href="https://donate.cryptocloud.plus/M6O34NIN" target="_blank">
  <img src="https://img.shields.io/badge/Donate-CryptoCloud-8A2BE2?style=for-the-badge&logo=cryptocurrency&logoColor=white" alt="Donate via CryptoCloud">
</a>

Thank you for being part of this journey. ❤️
