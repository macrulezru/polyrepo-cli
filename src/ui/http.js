export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

const MAX_BODY_BYTES = 4 * 1024 * 1024

export function sendJson(res, status, data) {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

export async function readJsonBody(req) {
  const type = req.headers['content-type'] ?? ''
  if (!type.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'expected Content-Type: application/json')
  }
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'the request body is too large')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new HttpError(400, 'the request body is not valid JSON')
  }
}

export function asObject(value, what = 'the request body') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, `${what} must be a JSON object`)
  }
  return value
}

export function matchRoute(routes, method, pathname) {
  for (const route of routes) {
    if (route.method !== method) continue
    const want = route.path.split('/')
    const have = pathname.split('/')
    if (want.length !== have.length) continue
    const params = {}
    let ok = true
    for (let i = 0; i < want.length; i++) {
      if (want[i].startsWith(':')) params[want[i].slice(1)] = decodeURIComponent(have[i])
      else if (want[i] !== have[i]) {
        ok = false
        break
      }
    }
    if (ok) return { route, params }
  }
  return undefined
}
