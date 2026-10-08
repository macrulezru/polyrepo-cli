import { createServer } from 'vite'
import { startUiServer } from '../src/ui/server.js'

const token = process.env.POLYREPO_UI_API_TOKEN ?? 'dev'
const wantedPort = Number(process.env.POLYREPO_UI_API_PORT ?? 4478)

let api
try {
  api = await startUiServer({ port: wantedPort, token, version: 'dev', staticDir: null })
} catch {
  api = await startUiServer({ port: 0, token, version: 'dev', staticDir: null })
}

process.env.POLYREPO_UI_API_PORT = String(api.port)
process.env.POLYREPO_UI_API_TOKEN = token

const vite = await createServer({
  configFile: new URL('./vite.config.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
})
await vite.listen()

console.log(`API  http://127.0.0.1:${api.port}  (the interface proxies /api to it)`)
vite.printUrls()

async function stop() {
  await vite.close()
  await api.close()
  process.exit(0)
}

process.once('SIGINT', () => void stop())
process.once('SIGTERM', () => void stop())
