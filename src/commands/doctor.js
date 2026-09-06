import pc from 'picocolors'
import { discoverRepos, inspectRepos } from '../repos.js'
import { loadConfig } from '../loadConfig.js'
import { run } from '../exec.js'
import { findStaleLocalDeps } from '../crossDeps.js'
import { heading, ok, fail, warn } from '../ui.js'

export async function doctorCommand({ configPath } = {}) {
  heading('Environment')
  checkNode()
  checkGit()
  checkGh()
  checkNpm()

  heading('Config')
  const config = loadConfig({ configPath })
  console.log(pc.dim(`Config file: ${config.configPath}`))
  const repos = await inspectRepos(discoverRepos(config))
  if (repos.length === 0) {
    fail('No packages discovered — check `vpc setup`.')
  } else {
    ok(`${repos.length} package(s) discovered.`)
    const dirty = repos.filter((r) => !r.clean)
    if (dirty.length > 0) {
      warn(`${dirty.length} repo(s) have uncommitted changes: ${dirty.map((r) => r.dir).join(', ')}`)
    }
    const offMaster = repos.filter((r) => r.branch !== 'master')
    if (offMaster.length > 0) {
      warn(`${offMaster.length} repo(s) are not on master: ${offMaster.map((r) => r.dir).join(', ')}`)
    }
  }

  heading('Cross-package dependencies')
  if (repos.length > 0) {
    const issues = findStaleLocalDeps(repos)
    if (issues.length === 0) {
      ok('No stale local dependency references found.')
    } else {
      for (const issue of issues) {
        warn(
          `${issue.repo.dir}: depends on "${issue.depName}" via "${issue.range}", which does not match the local version ${issue.localVersion}.`,
        )
      }
    }
  } else {
    console.log(pc.dim('Skipped — no packages discovered.'))
  }
}

function checkNode() {
  const [major] = process.versions.node.split('.').map(Number)
  if (major >= 20) {
    ok(`Node.js ${process.version} (>= 20 required).`)
  } else {
    fail(`Node.js ${process.version} — this CLI needs 20 or newer.`)
  }
}

function checkGit() {
  const result = run('.', 'git', ['--version'], { quiet: true })
  if (result.ok) {
    ok(`${result.stdout}.`)
  } else {
    fail('git not found in PATH — required for every command, including this one.')
  }
}

function checkGh() {
  const version = run('.', 'gh', ['--version'], { quiet: true })
  if (!version.ok) {
    fail('gh (GitHub CLI) not found in PATH — required for `bump`, `release`, and PR merges. https://cli.github.com/')
    return
  }
  const versionLine = version.stdout.split('\n')[0]
  const auth = run('.', 'gh', ['auth', 'status'], { quiet: true })
  if (auth.ok) {
    const who = (auth.stdout + auth.stderr).match(/Logged in to [^\s]+ account (\S+)/)
    ok(`${versionLine}${who ? ` — authenticated as ${who[1]}` : ' — authenticated'}.`)
  } else {
    fail(`${versionLine} — not authenticated. Run \`gh auth login\`.`)
  }
}

function checkNpm() {
  const version = run('.', 'npm', ['--version'], { quiet: true })
  if (!version.ok) {
    fail('npm not found in PATH — required only for `vpc publish`.')
    return
  }
  const who = run('.', 'npm', ['whoami'], { quiet: true })
  if (who.ok) {
    ok(`npm ${version.stdout} — authenticated as ${who.stdout}.`)
  } else {
    warn(`npm ${version.stdout} — not authenticated (only needed for \`vpc publish\`). Run \`npm login\`.`)
  }
}
