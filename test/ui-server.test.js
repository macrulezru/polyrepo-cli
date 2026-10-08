import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { startUiServer } from '../src/ui/server.js'
import { createRunManager } from '../src/ui/runs.js'

let root
let home
let configPath
let server
let base
let cookie

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
}

function makeRepo(name, version) {
  const dir = path.join(root, 'repos', name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version }, null, 2))
  git(dir, 'init', '-q', '-b', 'master')
  git(dir, 'config', 'user.email', 'test@example.com')
  git(dir, 'config', 'user.name', 'Test')
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'init')
  return dir
}

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'polyrepo-ui-test-'))
  home = path.join(root, 'home')
  makeRepo('alpha', '1.2.3')
  makeRepo('beta', '0.0.1')
  configPath = path.join(root, 'polyrepo.config.json')
  fs.writeFileSync(configPath, JSON.stringify({ roots: [path.join(root, 'repos')], packages: [] }))
  const staticDir = path.join(root, 'static')
  fs.mkdirSync(staticDir)
  fs.writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>x</title>')
  server = await startUiServer({
    configPath,
    token: 'secret',
    staticDir,
    version: '9.9.9',
    runs: createRunManager({ directory: path.join(home, 'runs') }),
  })
  base = `http://127.0.0.1:${server.port}`
  cookie = `polyrepo-ui-${server.port}=secret`
})

after(async () => {
  await server.close()
  fs.rmSync(root, { recursive: true, force: true })
})

function call(pathname, init = {}, headers = {}) {
  return fetch(`${base}${pathname}`, { ...init, headers: { cookie, ...(init.headers ?? {}), ...headers } })
}

function post(pathname, body, method = 'POST') {
  return call(pathname, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

async function events(runId, { answer } = {}) {
  const response = await call(`/api/runs/${runId}/events`)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const entries = []
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const blocks = buffer.split('\n\n')
    buffer = blocks.pop() ?? ''
    for (const block of blocks) {
      if (block.startsWith('event: end')) return entries
      const data = /^data: (.*)$/m.exec(block)
      if (!data) continue
      const entry = JSON.parse(data[1])
      entries.push(entry)
      if (answer && entry.event.type === 'prompt') {
        const reply = answer(entry.event.question)
        await post(`/api/runs/${runId}/answer`, { id: entry.event.id, answer: reply })
      }
    }
  }
  return entries
}

async function startRun(body) {
  const response = await post('/api/runs', body)
  assert.equal(response.status, 202, await response.clone().text())
  return response.json()
}

function rawHttp(headers) {
  return new Promise((resolve) => {
    const request = http.request({ host: '127.0.0.1', port: server.port, path: '/api/status', headers }, (response) => {
      response.resume()
      resolve(response.statusCode)
    })
    request.end()
  })
}

test('only this machine, and only with the token', async () => {
  assert.equal(server.host, '127.0.0.1')
  const good = await fetch(`${base}/?token=secret`, { redirect: 'manual' })
  assert.equal(good.status, 302)
  assert.match(good.headers.get('set-cookie'), /HttpOnly/)
  assert.match(good.headers.get('set-cookie'), /SameSite=Strict/)
  assert.equal((await fetch(`${base}/?token=nope`, { redirect: 'manual' })).status, 403)
  assert.equal((await fetch(`${base}/api/status`)).status, 401)
  assert.equal((await fetch(`${base}/`)).status, 401)
  assert.equal((await call('/')).status, 200)
  assert.equal(await rawHttp({ cookie, Host: 'evil.example' }), 403)
  assert.equal((await call('/api/status', {}, { Origin: 'http://evil.example' })).status, 403)
})

test('status, environment and the command catalog', async () => {
  const status = await (await call('/api/status')).json()
  assert.equal(status.version, '9.9.9')
  assert.equal(status.configPath, configPath)
  assert.equal(status.configExists, true)
  const environment = await (await call('/api/environment')).json()
  assert.match(environment.node, /^v\d+/)
  assert.ok(environment.git)
  const commands = await (await call('/api/commands')).json()
  assert.deepEqual(
    commands.map((command) => command.id),
    ['list', 'outdated', 'audit', 'prs', 'doctor', 'switch-default', 'sync-deps', 'bump', 'publish', 'tag', 'release', 'exec', 'clone'],
  )
  assert.equal(commands.find((command) => command.id === 'bump').mutating, true)
  assert.equal(commands.find((command) => command.id === 'list').mutating, false)
})

test('the config can be read, checked, previewed and saved', async () => {
  const read = await (await call('/api/config')).json()
  assert.equal(read.path, configPath)
  assert.deepEqual(read.roots, [path.join(root, 'repos')])

  const bad = await post('/api/config', { roots: 'x' }, 'PUT')
  assert.equal(bad.status, 400)
  const host = await post('/api/config', { roots: [], gitlabHosts: ['not a host'] }, 'PUT')
  assert.equal(host.status, 400)

  const preview = await (await post('/api/config/preview', { roots: [path.join(root, 'repos')], packages: ['missing-dir'] })).json()
  assert.deepEqual(
    preview.packages.map((pkg) => [pkg.dir, pkg.version]),
    [
      ['alpha', '1.2.3'],
      ['beta', '0.0.1'],
    ],
  )
  assert.ok(preview.warnings.some((text) => text.includes('missing-dir')))

  const other = path.join(root, 'other.config.json')
  const custom = await startUiServer({ configPath: other, token: 't', staticDir: path.join(root, 'static') })
  try {
    const saved = await fetch(`http://127.0.0.1:${custom.port}/api/config`, {
      method: 'PUT',
      headers: { cookie: `polyrepo-ui-${custom.port}=t`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ roots: ['./repos'], packages: [], gitlabHosts: ['GitLab.Example.com'] }),
    })
    assert.equal(saved.status, 200)
    assert.deepEqual(JSON.parse(fs.readFileSync(other, 'utf8')), {
      roots: ['./repos'],
      packages: [],
      gitlabHosts: ['gitlab.example.com'],
    })
  } finally {
    await custom.close()
  }
})

test('the package list comes from the config, without touching the network', async () => {
  const result = await (await call('/api/packages')).json()
  assert.deepEqual(
    result.packages.map((pkg) => pkg.dir),
    ['alpha', 'beta'],
  )
  assert.equal(result.packages[0].path, path.join(root, 'repos', 'alpha'))
})

test('the folder browser lists folders and marks repos', async () => {
  const listing = await (await call(`/api/fs/list?path=${encodeURIComponent(path.join(root, 'repos'))}`)).json()
  assert.deepEqual(
    listing.folders.map((folder) => [folder.name, folder.repo]),
    [
      ['alpha', true],
      ['beta', true],
    ],
  )
  assert.equal((await call('/api/fs/list?path=nowhere-at-all-xyz')).status, 404)
})

test('a read-only run streams a heading, a table and a done event, and is kept as history', async () => {
  const run = await startRun({ command: 'list', options: { quick: true } })
  assert.equal(run.command, 'list')
  const entries = await events(run.id)
  const types = entries.map((entry) => entry.event.type)
  assert.equal(types[0], 'heading')
  assert.ok(types.includes('table'))
  assert.equal(types.at(-1), 'done')
  const table = entries.find((entry) => entry.event.type === 'table').event
  assert.deepEqual(table.columns, ['Package', 'Local', 'Branch', 'Git'])
  assert.deepEqual(
    table.rows.map((row) => row.cells.map((cell) => cell.text)),
    [
      ['alpha', '1.2.3', 'master', 'clean'],
      ['beta', '0.0.1', 'master', 'clean'],
    ],
  )
  assert.equal(entries.at(-1).event.status, 'done')
  assert.equal(entries.at(-1).event.exitCode, 0)
  const sequence = entries.map((entry) => entry.seq)
  assert.deepEqual(sequence, [...sequence].sort((a, b) => a - b))

  const history = await (await call('/api/runs')).json()
  assert.ok(history.some((item) => item.id === run.id && item.status === 'done'))
  const replay = await events(run.id)
  assert.equal(replay.length, entries.length)
  const later = await events(run.id)
  assert.deepEqual(later.map((entry) => entry.seq), sequence)
  const logFile = path.join(home, 'runs', `${run.id}.log.jsonl`)
  assert.ok(fs.existsSync(logFile))
})

test('a command that changes things refuses to start without a confirmation', async () => {
  const refused = await post('/api/runs', { command: 'tag', options: { dryRun: true } })
  assert.equal(refused.status, 409)
  const unknown = await post('/api/runs', { command: 'nope' })
  assert.equal(unknown.status, 404)
  const noCommand = await post('/api/runs', { command: 'exec', confirmed: true, options: { cmd: '  ' } })
  assert.equal(noCommand.status, 400)
  const custom = await post('/api/runs', {
    command: 'bump',
    confirmed: true,
    options: { bumpType: 'custom', customVersion: '2.0.0', packages: ['alpha', 'beta'] },
  })
  assert.equal(custom.status, 400)
  const doctor = await post('/api/runs', { command: 'doctor', options: { cleanBranches: true } })
  assert.equal(doctor.status, 409)
})

test('a question in a run is shown, answered, and the run carries on', async () => {
  const run = await startRun({
    command: 'exec',
    confirmed: true,
    options: { cmd: 'node -p 42', bail: false },
  })
  const asked = []
  const entries = await events(run.id, {
    answer: (question) => {
      asked.push(question)
      if (question.kind === 'checkbox') return question.choices.map((choice) => choice.id)
      return true
    },
  })
  assert.deepEqual(
    asked.map((question) => question.kind),
    ['checkbox', 'confirm'],
  )
  assert.deepEqual(
    asked[0].choices.map((choice) => [choice.id, choice.checked]),
    [
      [0, true],
      [1, true],
    ],
  )
  const types = entries.map((entry) => entry.event.type)
  assert.ok(types.includes('prompt'))
  assert.equal(types.filter((type) => type === 'answered').length, 2)
  assert.equal(types.filter((type) => type === 'step').length, 2)
  const raw = entries.filter((entry) => entry.event.type === 'raw').map((entry) => entry.event.text.replace(/[[0-9;]*m/g, '').trim())
  assert.deepEqual(raw.filter((text) => text === '42'), ['42', '42'])
  assert.equal(entries.at(-1).event.status, 'done')
})

test('choosing the packages up front skips every question', async () => {
  const run = await startRun({
    command: 'exec',
    confirmed: true,
    options: { cmd: 'node -p 7', packages: ['beta'] },
  })
  const entries = await events(run.id)
  const types = entries.map((entry) => entry.event.type)
  assert.ok(!types.includes('prompt'))
  assert.equal(entries.filter((entry) => entry.event.type === 'step').length, 1)
  assert.equal(entries.at(-1).event.status, 'done')
})

test('a failing command ends the run as failed with its exit code', async () => {
  const run = await startRun({
    command: 'exec',
    confirmed: true,
    options: { cmd: 'node -e "process.exit(3)"', packages: ['alpha', 'beta'] },
  })
  const entries = await events(run.id)
  const done = entries.at(-1).event
  assert.equal(done.status, 'failed')
  assert.equal(done.exitCode, 1)
  assert.ok(entries.some((entry) => entry.event.type === 'fail' && /code 3/.test(entry.event.text)))
})

test('a run that waits for an answer can be cancelled', async () => {
  const run = await startRun({
    command: 'exec',
    confirmed: true,
    options: { cmd: 'node -v' },
  })
  const seen = []
  const reading = events(run.id).then((entries) => seen.push(...entries))
  for (let tries = 0; tries < 100; tries++) {
    const state = await (await call(`/api/runs/${run.id}`)).json()
    if (state.status === 'waiting') break
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const cancel = await post(`/api/runs/${run.id}/cancel`, {})
  assert.equal(cancel.status, 200)
  await reading
  assert.equal(seen.at(-1).event.status, 'cancelled')
  assert.equal((await post(`/api/runs/${run.id}/cancel`, {})).status, 409)
  assert.equal((await post(`/api/runs/${run.id}/answer`, { id: 1, answer: true })).status, 409)
})

test('a finished run can be removed from the history', async () => {
  const run = await startRun({ command: 'list', options: { quick: true } })
  await events(run.id)
  assert.equal((await post(`/api/runs/${run.id}/remove`, {})).status, 200)
  const history = await (await call('/api/runs')).json()
  assert.ok(!history.some((item) => item.id === run.id))
  assert.equal((await call(`/api/runs/${run.id}`)).status, 404)
})

test('the built interface is served, with a helpful message when it is missing', async () => {
  const page = await call('/')
  assert.match(await page.text(), /<title>x<\/title>/)
  const lonely = await startUiServer({ configPath, token: 't', staticDir: path.join(root, 'nothing') })
  try {
    const response = await fetch(`http://127.0.0.1:${lonely.port}/`, {
      headers: { cookie: `polyrepo-ui-${lonely.port}=t` },
    })
    assert.equal(response.status, 503)
    assert.match(await response.text(), /build:ui/)
  } finally {
    await lonely.close()
  }
})

test('a one-time password reaches the command but is never kept in the run history', async () => {
  const runner = path.join(root, 'fake-runner.js')
  fs.writeFileSync(
    runner,
    [
      "process.send({ type: 'ready' })",
      "process.on('message', (message) => {",
      "  if (message.type !== 'start') return",
      "  process.send({ type: 'event', event: { type: 'line', text: 'otp:' + message.options.otp } })",
      "  process.send({ type: 'done', exitCode: 0 })",
      '  process.exit(0)',
      '})',
    ].join('\n'),
  )
  const directory = path.join(root, 'otp-runs')
  const manager = createRunManager({ directory, runner })
  const run = manager.start({ command: 'publish', options: { otp: '123456', dryRun: true }, configPath })
  assert.equal(run.options.otp, undefined)
  assert.equal(run.options.dryRun, true)
  const seen = []
  await new Promise((resolve) => {
    manager.subscribe(run.id, 0, (entry) => {
      if (entry === null) resolve()
      else seen.push(entry.event)
    })
  })
  assert.ok(seen.some((event) => event.type === 'line' && event.text === 'otp:123456'))
  const meta = fs.readFileSync(path.join(directory, `${run.id}.meta.json`), 'utf8')
  assert.ok(!meta.includes('123456'))
})

test('a run left unfinished by a stopped UI is reported as failed, not running forever', () => {
  const directory = path.join(root, 'stale-runs')
  fs.mkdirSync(directory)
  fs.writeFileSync(
    path.join(directory, 'old.meta.json'),
    JSON.stringify({ id: 'old', command: 'list', title: 'Packages', options: {}, startedAt: '2026-01-01T00:00:00.000Z', status: 'waiting', events: 3 }),
  )
  const manager = createRunManager({ directory })
  assert.equal(manager.list()[0].status, 'failed')
  assert.match(manager.list()[0].error, /interrupted/)
  assert.equal(manager.get('old').status, 'failed')
})

test('saved package sets round-trip and are validated', async () => {
  assert.deepEqual(await (await call('/api/presets')).json(), [])
  const saved = await post(
    '/api/presets',
    [{ name: ' Core ', packages: ['alpha', 'beta'] }],
    'PUT',
  )
  assert.equal(saved.status, 200)
  assert.deepEqual(await (await call('/api/presets')).json(), [{ name: 'Core', packages: ['alpha', 'beta'] }])
  const bad = await post('/api/presets', [{ name: '  ', packages: [] }], 'PUT')
  assert.equal(bad.status, 400)
})

test('a run keeps its counts and its whole log can be fetched as JSON', async () => {
  const run = await startRun({
    command: 'exec',
    confirmed: true,
    options: { cmd: 'node -p 1', packages: ['alpha', 'beta'] },
  })
  await events(run.id)
  const summary = await (await call(`/api/runs/${run.id}`)).json()
  assert.deepEqual(summary.stats, { ok: 2, warn: 0, fail: 0, steps: 2 })
  const log = await (await call(`/api/runs/${run.id}/log`)).json()
  assert.ok(log.length > 4)
  assert.equal(log.at(-1).event.type, 'done')
  assert.equal((await call('/api/runs/nope/log')).status, 404)
})

test('the sign-in check reports each tool with a yes or no', async () => {
  const auth = await (await call('/api/auth')).json()
  for (const tool of ['gh', 'glab', 'npm']) {
    assert.equal(typeof auth[tool].ok, 'boolean')
    assert.equal(typeof auth[tool].detail, 'string')
  }
})

test('the colour range for monorepo blocks has a default, is validated, and keeps the saved sets', async () => {
  const first = await (await call('/api/settings')).json()
  assert.match(first.groupColors.from, /^#[0-9a-f]{6}$/i)
  assert.equal((await post('/api/settings', { groupColors: { from: 'red', to: '#000000' } }, 'PUT')).status, 400)
  const saved = await post('/api/settings', { groupColors: { from: '#112233', to: '#445566' } }, 'PUT')
  assert.equal(saved.status, 200)
  assert.deepEqual((await (await call('/api/settings')).json()).groupColors, { from: '#112233', to: '#445566' })
  await post('/api/presets', [{ name: 'Keep', packages: ['alpha'] }], 'PUT')
  assert.deepEqual((await (await call('/api/settings')).json()).groupColors, { from: '#112233', to: '#445566' })
})
