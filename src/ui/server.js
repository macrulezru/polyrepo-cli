import { randomBytes, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { discoverPackages, readPackageJson } from '../repos.js'
import { loadConfig } from '../loadConfig.js'
import { readConfigFile, resolveConfigFilePath, writeConfigFile } from '../configFile.js'
import { runWithRuntime } from '../runtime.js'
import { gitAsync } from '../exec.js'
import { pMap } from '../pMap.js'
import { createEventRuntime } from './events.js'
import { describeCommands, findCommand, splitCommandLine } from './catalog.js'
import { HttpError, asObject, matchRoute, readJsonBody, sendJson } from './http.js'
import { createRunManager } from './runs.js'
import { runAsync } from '../exec.js'

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

const HERE = path.dirname(fileURLToPath(import.meta.url))

export function defaultStaticDir() {
  return path.join(HERE, '..', '..', 'ui-dist')
}

export function cookieName(port) {
  return `polyrepo-ui-${port}`
}

function readCookie(req, name) {
  const header = req.headers.cookie
  if (!header) return undefined
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim()
  }
  return undefined
}

function sameToken(given, expected) {
  if (given === undefined) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function stringList(value, name) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new HttpError(400, `${name} must be a list of strings`)
  }
  return value.map((item) => item.trim()).filter(Boolean)
}

function validateConfig(body) {
  const object = asObject(body)
  const roots = stringList(object.roots, 'roots')
  const packages = stringList(object.packages, 'packages')
  const gitlabHosts = stringList(object.gitlabHosts, 'gitlabHosts').map((host) => host.toLowerCase())
  for (const host of gitlabHosts) {
    if (!/^[a-z0-9.-]+(:\d+)?$/.test(host)) {
      throw new HttpError(400, `"${host}" is not a host name — use something like gitlab.company.com`)
    }
  }
  return { roots, packages, gitlabHosts }
}

function capture(task) {
  const warnings = []
  const runtime = createEventRuntime({
    emit: (event) => {
      if (event.type === 'line' && event.text) warnings.push(event.text.replace(/\x1b\[[0-9;]*m/g, ''))
    },
    ask: async () => undefined,
  })
  const result = runWithRuntime(runtime, task)
  return { result, warnings }
}

function resolveAgainst(baseDir, target) {
  return path.isAbsolute(target) ? target : path.resolve(baseDir, target)
}

function describePackages(config) {
  const { result, warnings } = capture(() => discoverPackages(config))
  const packages = result.map((repo) => {
    let version = null
    let name = repo.dir
    let isPrivate = false
    try {
      const pkg = readPackageJson(repo)
      version = pkg.version
      name = pkg.name
      isPrivate = pkg.private
    } catch {
      version = null
    }
    return {
      dir: repo.dir,
      name,
      version,
      private: isPrivate,
      path: repo.path,
      repoDir: repo.repoDir,
      repoPath: repo.repoPath,
      isWorkspaceMember: repo.isWorkspaceMember,
    }
  })
  return { packages, warnings }
}

async function withGitState(packages) {
  const states = new Map()
  const paths = [...new Set(packages.map((pkg) => pkg.repoPath).filter(Boolean))]
  await pMap(paths, async (repoPath) => {
    const [branch, status] = await Promise.all([
      gitAsync(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']),
      gitAsync(repoPath, ['status', '--porcelain']),
    ])
    states.set(repoPath, {
      branch: branch.ok ? branch.stdout : null,
      dirty: status.ok ? status.stdout !== '' : null,
    })
  })
  return packages.map(({ repoPath, ...pkg }) => ({
    ...pkg,
    branch: states.get(repoPath)?.branch ?? null,
    dirty: states.get(repoPath)?.dirty ?? null,
  }))
}

function presetsFile(runs) {
  return path.join(path.dirname(runs.directory), 'ui.json')
}

function readUiFile(runs) {
  try {
    const data = JSON.parse(fs.readFileSync(presetsFile(runs), 'utf8'))
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

function writeUiFile(runs, patch) {
  const next = { ...readUiFile(runs), ...patch }
  fs.mkdirSync(path.dirname(presetsFile(runs)), { recursive: true })
  fs.writeFileSync(presetsFile(runs), JSON.stringify(next, null, 2))
}

function readPresets(runs) {
  const data = readUiFile(runs)
  return Array.isArray(data.presets) ? data.presets : []
}

const DEFAULT_SETTINGS = { groupColors: { from: '#4f7bff', to: '#c06be0' } }

function readSettings(runs) {
  const saved = readUiFile(runs).settings
  const colors = saved && typeof saved === 'object' ? saved.groupColors : undefined
  const ok = (value) => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
  return {
    groupColors: {
      from: colors && ok(colors.from) ? colors.from : DEFAULT_SETTINGS.groupColors.from,
      to: colors && ok(colors.to) ? colors.to : DEFAULT_SETTINGS.groupColors.to,
    },
  }
}

function cleanSettings(value) {
  const body = asObject(value, 'settings')
  const colors = asObject(body.groupColors, 'groupColors')
  for (const key of ['from', 'to']) {
    if (typeof colors[key] !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(colors[key])) {
      throw new HttpError(400, `groupColors.${key} must be a color like #4f7bff`)
    }
  }
  return { groupColors: { from: colors.from, to: colors.to } }
}

function cleanPresets(value) {
  if (!Array.isArray(value)) throw new HttpError(400, 'presets must be a list')
  return value.slice(0, 50).map((entry) => {
    const item = asObject(entry, 'preset')
    const name = String(item.name ?? '').trim().slice(0, 60)
    if (name === '') throw new HttpError(400, 'every set needs a name')
    const packages = Array.isArray(item.packages) ? item.packages.map(String).slice(0, 500) : []
    return { name, packages }
  })
}

async function authState() {
  const probe = async (cmd, args) => {
    const result = await runAsync('.', cmd, args)
    const text = (result.stdout || result.stderr || '').split('\n').find((l) => l.trim() !== '') ?? ''
    return { ok: result.ok, detail: text.trim() }
  }
  const [gh, glab, npm] = await Promise.all([
    probe('gh', ['auth', 'status']),
    probe('glab', ['auth', 'status']),
    probe('npm', ['whoami']),
  ])
  return { gh, glab, npm }
}

function toolVersion(command, args = ['--version']) {
  try {
    const result = spawnSync(command, args, {
      encoding: 'utf8',
      shell: process.platform === 'win32',
      timeout: 8000,
    })
    if (result.status !== 0) return null
    return (result.stdout || result.stderr || '').trim().split('\n')[0] ?? null
  } catch {
    return null
  }
}

export async function startUiServer({
  configPath,
  host = '127.0.0.1',
  port = 0,
  token = randomBytes(18).toString('hex'),
  staticDir = defaultStaticDir(),
  version = '',
  runs = createRunManager(),
} = {}) {
  const state = { port, host, token, staticDir, version, configPath }

  function configFile() {
    return resolveConfigFilePath(state.configPath)
  }

  function packageConfig(raw) {
    const file = configFile()
    const baseDir = path.dirname(file)
    return {
      configPath: file,
      roots: raw.roots.map((target) => resolveAgainst(baseDir, target)),
      packages: raw.packages.map((target) => resolveAgainst(baseDir, target)),
      gitlabHosts: raw.gitlabHosts,
    }
  }

  const routes = [
    {
      method: 'GET',
      path: '/api/status',
      handler: ({ res }) => {
        sendJson(res, 200, {
          version: state.version,
          configPath: configFile(),
          configExists: fs.existsSync(configFile()),
          home: os.homedir(),
          platform: process.platform,
          cwd: process.cwd(),
        })
      },
    },
    {
      method: 'GET',
      path: '/api/environment',
      handler: ({ res }) => {
        sendJson(res, 200, {
          node: process.version,
          git: toolVersion('git'),
          gh: toolVersion('gh'),
          glab: toolVersion('glab'),
          npm: toolVersion('npm'),
          pnpm: toolVersion('pnpm'),
        })
      },
    },
    {
      method: 'GET',
      path: '/api/config',
      handler: ({ res }) => {
        const file = configFile()
        let raw = { roots: [], packages: [], gitlabHosts: [] }
        let error = null
        try {
          raw = readConfigFile(file)
        } catch (caught) {
          error = caught instanceof Error ? caught.message : String(caught)
        }
        sendJson(res, 200, { path: file, exists: fs.existsSync(file), ...raw, error })
      },
    },
    {
      method: 'PUT',
      path: '/api/config',
      handler: async ({ res, readBody }) => {
        const config = validateConfig(await readBody())
        writeConfigFile(configFile(), config)
        sendJson(res, 200, { path: configFile(), ...config })
      },
    },
    {
      method: 'POST',
      path: '/api/config/preview',
      handler: async ({ res, readBody }) => {
        const config = validateConfig(await readBody())
        const resolved = packageConfig(config)
        sendJson(res, 200, describePackages(resolved))
      },
    },
    {
      method: 'GET',
      path: '/api/packages',
      handler: async ({ res }) => {
        const { result, warnings } = capture(() => loadConfig({ configPath: state.configPath }))
        const described = describePackages(result)
        sendJson(res, 200, {
          packages: await withGitState(described.packages),
          warnings: [...described.warnings, ...warnings],
        })
      },
    },
    {
      method: 'GET',
      path: '/api/fs/list',
      handler: ({ res, url }) => {
        const raw = url.searchParams.get('path')
        const target = raw && raw.trim() !== '' ? path.resolve(raw.trim()) : os.homedir()
        let entries
        try {
          entries = fs.readdirSync(target, { withFileTypes: true })
        } catch (error) {
          throw new HttpError(404, error instanceof Error ? error.message : String(error))
        }
        const folders = entries
          .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
          .map((entry) => ({
            name: entry.name,
            repo: fs.existsSync(path.join(target, entry.name, '.git')),
          }))
          .sort((a, b) => a.name.localeCompare(b.name))
        const parent = path.dirname(target)
        sendJson(res, 200, {
          path: target,
          parent: parent === target ? null : parent,
          home: os.homedir(),
          isRepo: fs.existsSync(path.join(target, '.git')),
          folders,
        })
      },
    },
    {
      method: 'GET',
      path: '/api/commands',
      handler: ({ res }) => {
        sendJson(res, 200, describeCommands())
      },
    },
    {
      method: 'GET',
      path: '/api/runs',
      handler: ({ res }) => {
        sendJson(res, 200, runs.list())
      },
    },
    {
      method: 'POST',
      path: '/api/runs',
      handler: async ({ res, readBody }) => {
        const body = asObject(await readBody())
        const entry = findCommand(body.command)
        if (!entry) throw new HttpError(404, `no command named "${body.command}"`)
        const options = body.options === undefined ? {} : asObject(body.options, 'options')
        const writes = entry.mutating || entry.options.some((option) => option.writes && options[option.key] === true)
        if (writes && body.confirmed !== true) {
          throw new HttpError(409, 'this command changes things: confirm it first')
        }
        if (entry.id === 'exec' && splitCommandLine(options.cmd ?? '').length === 0) {
          throw new HttpError(400, 'give the command to run')
        }
        if (entry.id === 'clone' && !String(options.org ?? '').trim()) {
          throw new HttpError(400, 'give the organization or group to clone from')
        }
        if (entry.id === 'bump' && options.bumpType === 'custom') {
          const picked = Array.isArray(options.packages) ? options.packages : []
          if (picked.length !== 1 || !String(options.customVersion ?? '').trim()) {
            throw new HttpError(400, 'an exact version needs exactly one package and a version')
          }
        }
        const run = runs.start({
          command: entry.id,
          title: typeof body.title === 'string' && body.title ? body.title : entry.title,
          options: { ...options, yes: Array.isArray(options.packages) && options.packages.length > 0 },
          configPath: state.configPath,
        })
        sendJson(res, 202, run)
      },
    },
    {
      method: 'GET',
      path: '/api/runs/:id',
      handler: ({ res, params }) => {
        const run = runs.get(params.id)
        if (!run) throw new HttpError(404, 'no such run')
        sendJson(res, 200, run)
      },
    },
    {
      method: 'GET',
      path: '/api/runs/:id/events',
      handler: ({ req, res, params, url }) => {
        const from = Number(url.searchParams.get('from') ?? 0) || 0
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
        })
        const heartbeat = setInterval(() => res.write(': ping\n\n'), 20000)
        const stop = runs.subscribe(params.id, from, (entry) => {
          if (entry === null) {
            clearInterval(heartbeat)
            res.write('event: end\ndata: {}\n\n')
            res.end()
            return
          }
          res.write(`data: ${JSON.stringify(entry)}\n\n`)
        })
        if (!stop) {
          clearInterval(heartbeat)
          res.write('event: end\ndata: {}\n\n')
          res.end()
          return
        }
        req.on('close', () => {
          clearInterval(heartbeat)
          stop()
        })
      },
    },
    {
      method: 'GET',
      path: '/api/runs/:id/log',
      handler: ({ res, params }) => {
        const entries = runs.log(params.id)
        if (!entries) throw new HttpError(404, 'no such run')
        sendJson(res, 200, entries)
      },
    },
    {
      method: 'GET',
      path: '/api/presets',
      handler: ({ res }) => {
        sendJson(res, 200, readPresets(runs))
      },
    },
    {
      method: 'PUT',
      path: '/api/presets',
      handler: async ({ res, readBody }) => {
        const presets = cleanPresets(await readBody())
        writeUiFile(runs, { presets })
        sendJson(res, 200, presets)
      },
    },
    {
      method: 'GET',
      path: '/api/settings',
      handler: ({ res }) => {
        sendJson(res, 200, readSettings(runs))
      },
    },
    {
      method: 'PUT',
      path: '/api/settings',
      handler: async ({ res, readBody }) => {
        const settings = cleanSettings(await readBody())
        writeUiFile(runs, { settings })
        sendJson(res, 200, settings)
      },
    },
    {
      method: 'GET',
      path: '/api/auth',
      handler: async ({ res }) => {
        sendJson(res, 200, await authState())
      },
    },
    {
      method: 'POST',
      path: '/api/runs/:id/answer',
      handler: async ({ res, params, readBody }) => {
        const body = asObject(await readBody())
        if (!runs.answer(params.id, Number(body.id), body.answer)) {
          throw new HttpError(409, 'this question is not waiting for an answer')
        }
        sendJson(res, 200, { ok: true })
      },
    },
    {
      method: 'POST',
      path: '/api/runs/:id/cancel',
      handler: ({ res, params }) => {
        if (!runs.cancel(params.id)) throw new HttpError(409, 'this run is not running')
        sendJson(res, 200, { ok: true })
      },
    },
    {
      method: 'POST',
      path: '/api/runs/:id/remove',
      handler: ({ res, params }) => {
        if (!runs.remove(params.id)) throw new HttpError(409, 'stop this run before removing it')
        sendJson(res, 200, { ok: true })
      },
    },
  ]

  function serveStatic(res, pathname) {
    const dir = state.staticDir
    if (!dir || !fs.existsSync(path.join(dir, 'index.html'))) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('The polyrepo UI is not built in this copy. Run "npm run build:ui" in the polyrepo-cli folder.')
      return
    }
    const root = path.resolve(dir)
    const wanted = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`)
    let file = wanted
    const inside = wanted === root || wanted.startsWith(root + path.sep)
    const exists = inside && fs.existsSync(wanted) && fs.statSync(wanted).isFile()
    if (!exists) {
      if (path.extname(pathname) !== '') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('not found')
        return
      }
      file = path.join(root, 'index.html')
    }
    const type = CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
    const bytes = fs.readFileSync(file)
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': bytes.length,
      'Cache-Control': file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
    })
    res.end(bytes)
  }

  async function handle(req, res) {
    const allowedHosts = new Set([
      `${state.host}:${state.port}`,
      `localhost:${state.port}`,
      `127.0.0.1:${state.port}`,
      `[::1]:${state.port}`,
    ])
    if (!allowedHosts.has((req.headers.host ?? '').toLowerCase())) throw new HttpError(403, 'unexpected Host header')
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
    const cookie = cookieName(state.port)

    if (req.method === 'GET' && url.pathname === '/' && url.searchParams.has('token')) {
      if (!sameToken(url.searchParams.get('token') ?? undefined, state.token)) throw new HttpError(403, 'wrong token')
      res.writeHead(302, {
        Location: '/',
        'Set-Cookie': `${cookie}=${state.token}; Path=/; HttpOnly; SameSite=Strict`,
        'Cache-Control': 'no-store',
      })
      res.end()
      return
    }

    const authorized = sameToken(readCookie(req, cookie), state.token)
    if (url.pathname.startsWith('/api/')) {
      if (!authorized) throw new HttpError(401, 'open the address that polyrepo ui printed')
      const origin = req.headers.origin
      if (origin !== undefined && !allowedHosts.has(origin.replace(/^https?:\/\//, '').toLowerCase())) {
        throw new HttpError(403, 'unexpected Origin header')
      }
      const found = matchRoute(routes, req.method ?? 'GET', url.pathname)
      if (!found) throw new HttpError(404, 'no such endpoint')
      await found.route.handler({
        req,
        res,
        url,
        params: found.params,
        readBody: () => readJsonBody(req),
      })
      return
    }

    if (req.method !== 'GET') throw new HttpError(405, 'method not allowed')
    if (!authorized) {
      res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Open the address that "polyrepo ui" printed in the terminal.')
      return
    }
    serveStatic(res, url.pathname)
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      if (res.headersSent) {
        res.end()
        return
      }
      if (error instanceof HttpError) {
        sendJson(res, error.status, { error: error.message })
        return
      }
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
    })
  })

  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(state.port, state.host, () => {
      server.off('error', rejectListen)
      resolveListen()
    })
  })
  state.port = server.address().port

  return {
    url: `http://${host === '::1' ? '[::1]' : host}:${state.port}/?token=${token}`,
    port: state.port,
    host,
    token,
    runs,
    close: () =>
      new Promise((resolveClose) => {
        runs.stopAll()
        server.closeAllConnections()
        server.close(() => resolveClose())
      }),
  }
}
