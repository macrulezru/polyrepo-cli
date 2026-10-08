import type { RunSummary } from './api'

export interface StepContext {
  command: string
  dirs: string[]
  runId: string
  options: Record<string, unknown>
}

export type StepAction =
  | { type: 'exec'; cmd: string; title: string }
  | { type: 'confirm'; cmd: string; note: string; danger?: boolean }
  | { type: 'form'; command: string; query: Record<string, string> }
  | { type: 'link'; hash: string }
  | { type: 'open'; url: string }
  | { type: 'copy'; text: string }
  | { type: 'changes' }
  | { type: 'rerun' }
  | { type: 'log' }

export interface NextStep {
  id: string
  icon?: string
  label: string
  hint?: string
  primary?: boolean
  action: StepAction
}

interface Rule {
  test: RegExp
  steps: (ctx: StepContext, match: RegExpExecArray) => NextStep[]
}

const dirList = (ctx: StepContext): string => ctx.dirs.join(',')

function needsDir(ctx: StepContext, steps: NextStep[]): NextStep[] {
  return ctx.dirs.length > 0
    ? steps
    : steps.filter(
        (step) =>
          step.action.type !== 'exec' &&
          step.action.type !== 'confirm' &&
          step.action.type !== 'changes',
      )
}

const RULES: Rule[] = [
  {
    test: /Working tree is dirty — skipping to avoid committing/i,
    steps: (ctx) =>
      needsDir(ctx, [
        {
          id: 'changes',
          label: 'Commit or discard the changes',
          hint: 'Typical after a dependency update: the manifest and lock file',
          primary: true,
          action: { type: 'changes' },
        },
        {
          id: 'status',
          icon: 'search',
          label: 'Show what changed',
          action: { type: 'exec', cmd: 'git status --short', title: 'git status' },
        },
        {
          id: 'stash',
          icon: 'archive',
          label: 'Stash everything…',
          hint: 'Sets all uncommitted work aside; bring it back with git stash pop',
          action: {
            type: 'confirm',
            cmd: 'git stash push -u -m "polyrepo: before bump"',
            note: 'Sets every uncommitted change aside, untracked files included. Nothing is lost: git stash pop brings it back.',
          },
        },
        { id: 'again', label: `Run ${ctx.command} again`, action: { type: 'rerun' } },
      ]),
  },
  {
    test: /Working tree is dirty — skipping to avoid discarding/i,
    steps: (ctx) =>
      needsDir(ctx, [
        {
          id: 'status',
          icon: 'search',
          label: 'Show what changed',
          primary: true,
          action: { type: 'exec', cmd: 'git status --short', title: 'git status' },
        },
        {
          id: 'changes',
          label: 'Commit or discard the manifest changes',
          action: { type: 'changes' },
        },
        {
          id: 'force',
          icon: 'bolt',
          label: 'Discard everything and switch…',
          hint: 'Throws local changes away',
          action: {
            type: 'form',
            command: 'switch-default',
            query: { packages: dirList(ctx), o_force: '1' },
          },
        },
      ]),
  },
  {
    test: /Could not determine a git host/i,
    steps: (ctx) =>
      needsDir(ctx, [
        {
          id: 'remotes',
          label: 'Show the remotes',
          primary: true,
          action: { type: 'exec', cmd: 'git remote -v', title: 'git remote -v' },
        },
        {
          id: 'add',
          label: 'Copy the command to add origin',
          hint: 'Fill in your repository URL',
          action: { type: 'copy', text: 'git remote add origin <repository-url>' },
        },
      ]),
  },
  {
    test: /git (push|commit|add) failed|Could not check out branch/i,
    steps: (ctx) =>
      needsDir(ctx, [
        {
          id: 'status',
          label: 'Show the repository state',
          primary: true,
          action: { type: 'exec', cmd: 'git status -sb', title: 'git status' },
        },
        {
          id: 'log',
          label: 'Show the last commits',
          action: { type: 'exec', cmd: 'git log --oneline -5', title: 'git log' },
        },
        { id: 'again', label: 'Run again', action: { type: 'rerun' } },
      ]),
  },
  {
    test: /is still open, merge it manually/i,
    steps: (ctx) => [
      {
        id: 'prs',
        label: 'See the open pull request',
        primary: true,
        action: { type: 'form', command: 'prs', query: { packages: dirList(ctx) } },
      },
      { id: 'again', label: 'Run again once it is merged', action: { type: 'rerun' } },
    ],
  },
  {
    test: /No tag .* on origin/i,
    steps: (ctx) => [
      {
        id: 'tag',
        label: 'Tag the current version…',
        primary: true,
        action: { type: 'form', command: 'tag', query: { packages: dirList(ctx) } },
      },
      {
        id: 'bump',
        label: 'Bump a new version…',
        action: { type: 'form', command: 'bump', query: { packages: dirList(ctx) } },
      },
    ],
  },
  {
    test: /npm publish failed/i,
    steps: (ctx) => [
      {
        id: 'login',
        label: 'Check the npm sign-in',
        primary: true,
        action: { type: 'link', hash: '#/settings' },
      },
      {
        id: 'again',
        label: 'Publish again, with a one-time password…',
        hint: 'A two-factor account needs a fresh code',
        action: { type: 'form', command: 'publish', query: { packages: dirList(ctx) } },
      },
      { id: 'copy', label: 'Copy: npm login', action: { type: 'copy', text: 'npm login' } },
    ],
  },
  {
    test: /Not logged in to npm|npm login did not succeed|npm .*not authenticated/i,
    steps: () => [
      {
        id: 'copy',
        label: 'Copy: npm login',
        primary: true,
        hint: 'Run it once in a terminal',
        action: { type: 'copy', text: 'npm login' },
      },
      { id: 'settings', label: 'Check the sign-in', action: { type: 'link', hash: '#/settings' } },
      { id: 'again', label: 'Run again', action: { type: 'rerun' } },
    ],
  },
  {
    test: /pnpm install failed/i,
    steps: (ctx) =>
      needsDir(ctx, [
        {
          id: 'install',
          label: 'Run pnpm install here…',
          primary: true,
          action: {
            type: 'confirm',
            cmd: 'pnpm install',
            note: 'Links the workspace dependencies. Read the output of this run to see why it failed.',
          },
        },
        { id: 'again', label: 'Run again', action: { type: 'rerun' } },
      ]),
  },
  {
    test: /repo\(s\) have uncommitted changes/i,
    steps: () => [
      {
        id: 'show',
        label: 'See them in Packages',
        primary: true,
        action: { type: 'link', hash: '#/packages?chip=dirty' },
      },
    ],
  },
  {
    test: /repo\(s\) are (not on their default branch|in a detached HEAD)/i,
    steps: (ctx) => [
      {
        id: 'switch',
        label: 'Switch them to the default branch…',
        primary: true,
        action: { type: 'form', command: 'switch-default', query: { packages: dirList(ctx) } },
      },
    ],
  },
  {
    test: /could not check sync status|git fetch failed/i,
    steps: () => [
      {
        id: 'settings',
        label: 'Check the sign-in and network',
        primary: true,
        action: { type: 'link', hash: '#/settings' },
      },
      { id: 'again', label: 'Run again', action: { type: 'rerun' } },
    ],
  },
  {
    test: /local cache said .* the host says/i,
    steps: (ctx) =>
      needsDir(ctx, [
        {
          id: 'head',
          label: 'Refresh the cached default branch…',
          primary: true,
          action: {
            type: 'confirm',
            cmd: 'git remote set-head origin -a',
            note: 'Asks the host for the default branch and stores it locally.',
          },
        },
      ]),
  },
  {
    test: /gh .*not (authenticated|logged)|(?:^|\s)gh auth/i,
    steps: () => [
      {
        id: 'copy',
        label: 'Copy: gh auth login',
        primary: true,
        action: { type: 'copy', text: 'gh auth login' },
      },
      { id: 'settings', label: 'Check the sign-in', action: { type: 'link', hash: '#/settings' } },
    ],
  },
  {
    test: /glab .*not (authenticated|logged)|glab auth/i,
    steps: () => [
      {
        id: 'copy',
        label: 'Copy: glab auth login',
        primary: true,
        action: { type: 'copy', text: 'glab auth login' },
      },
      { id: 'settings', label: 'Check the sign-in', action: { type: 'link', hash: '#/settings' } },
    ],
  },
  {
    test: /git clone failed/i,
    steps: () => [
      {
        id: 'settings',
        label: 'Check the sign-in',
        primary: true,
        action: { type: 'link', hash: '#/settings' },
      },
      { id: 'again', label: 'Run again', action: { type: 'rerun' } },
    ],
  },
  {
    test: /No packages discovered|Config file not found|No repos found/i,
    steps: () => [
      {
        id: 'settings',
        label: 'Open Settings',
        primary: true,
        action: { type: 'link', hash: '#/settings' },
      },
    ],
  },
  {
    test: /Nothing to commit/i,
    steps: () => [
      {
        id: 'packages',
        label: 'See the packages',
        primary: true,
        action: { type: 'link', hash: '#/packages' },
      },
    ],
  },
  {
    test: /Exited with code \d+/i,
    steps: () => [
      { id: 'log', label: 'Read the output in the log', primary: true, action: { type: 'log' } },
      { id: 'again', label: 'Run again', action: { type: 'rerun' } },
    ],
  },
]

export function stepsForProblem(
  text: string,
  level: 'fail' | 'warn',
  ctx: StepContext,
): NextStep[] {
  for (const rule of RULES) {
    const match = rule.test.exec(text)
    if (match) return rule.steps(ctx, match)
  }
  if (level === 'fail') {
    return [
      { id: 'log', label: 'Read the log around this line', primary: true, action: { type: 'log' } },
      { id: 'again', label: 'Run again', action: { type: 'rerun' } },
    ]
  }
  return []
}

export function stepsAfter(run: RunSummary, dirs: string[], opened = ''): NextStep[] {
  const options = run.options
  if (options.dryRun === true) return []
  const packages = dirs.join(',')
  const form = (command: string, label: string, hint: string, primary = false): NextStep => ({
    id: `next-${command}`,
    label,
    hint,
    primary,
    action: { type: 'form', command, query: packages ? { packages } : {} },
  })
  switch (run.command) {
    case 'bump':
      return [
        ...(options.publish === true
          ? []
          : [form('publish', 'Publish to npm…', 'The new version is tagged; publish it', true)]),
        form('release', 'Create a release…', 'Notes come from the changelog'),
      ]
    case 'tag':
      return options.release === true
        ? []
        : [form('release', 'Create a release…', 'Make a release from the tag you just made', true)]
    case 'publish':
      return [form('release', 'Create a release…', 'If you have not made one for this version yet')]
    case 'commit':
      return [
        ...(opened
          ? [
              {
                id: 'next-open',
                label: 'Open the pull request',
                primary: true,
                action: { type: 'open' as const, url: opened },
              },
              {
                id: 'next-switch',
                label: 'Update the default branch after the merge…',
                hint: 'Once it is merged, bring your local default branch up to date',
                action: {
                  type: 'form' as const,
                  command: 'switch-default',
                  query: packages ? { packages } : {},
                },
              },
            ]
          : []),
        form('bump', 'Bump a version…', 'Release what you just committed'),
      ]
    case 'clone':
      return [
        {
          id: 'packages',
          label: 'See the new packages',
          primary: true,
          action: { type: 'link', hash: '#/packages' },
        },
      ]
    default:
      return []
  }
}
