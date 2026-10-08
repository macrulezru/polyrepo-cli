import pc from 'picocolors'
import { openBrowser } from './open-browser.js'
import { startUiServer } from './server.js'

export async function uiCommand({ configPath, host, port, open = true, token, version } = {}) {
  const wanted = Number(port ?? 0)
  if (!Number.isInteger(wanted) || wanted < 0 || wanted > 65535) {
    console.error(`--port must be a whole number from 0 to 65535 (got "${port}")`)
    process.exitCode = 2
    return
  }
  let handle
  try {
    handle = await startUiServer({
      configPath,
      host: host ?? '127.0.0.1',
      port: wanted,
      ...(token ? { token } : {}),
      version,
    })
  } catch (error) {
    console.error(
      error?.code === 'EADDRINUSE'
        ? `Port ${wanted} is already in use — pick another with --port, or leave it out.`
        : `Could not start the interface: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exitCode = 1
    return
  }
  console.log(`${pc.green('polyrepo ui')} is running at ${pc.cyan(handle.url)}`)
  console.log(pc.dim('Press Ctrl+C to stop.'))
  if (open && !openBrowser(handle.url)) {
    console.log(pc.yellow('Could not open the browser — open the address above yourself.'))
  }
  await new Promise((done) => {
    const stop = () => {
      void handle.close().then(done)
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
}
