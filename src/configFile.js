import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.join(__dirname, '..')
export const DEFAULT_CONFIG_PATH = path.join(PROJECT_ROOT, 'polyrepo.config.json')

// Same --config / POLYREPO_CONFIG / default resolution `loadConfig` uses, split
// out so `polyrepo setup` can find "the file to edit" without also pulling in
// loadConfig's read-side behavior (POLYREPO_ROOT override, resolving every path
// to absolute) — setup edits the file's own raw, possibly-relative paths.
export function resolveConfigFilePath(configPath) {
  if (configPath) return path.resolve(configPath)
  if (process.env.POLYREPO_CONFIG) return path.resolve(process.env.POLYREPO_CONFIG)
  return DEFAULT_CONFIG_PATH
}

// Raw (possibly relative, exactly as a person typed them) roots/packages —
// no existence checks, no POLYREPO_ROOT override. Returns an empty config if the
// file doesn't exist yet, so `polyrepo setup` can start from scratch at a new
// --config path instead of erroring.
export function readConfigFile(filePath) {
  if (!fs.existsSync(filePath)) return { roots: [], packages: [] }
  const text = fs.readFileSync(filePath, 'utf8')
  const parsed = JSON.parse(text)
  return {
    roots: Array.isArray(parsed.roots) ? parsed.roots : [],
    packages: Array.isArray(parsed.packages) ? parsed.packages : [],
  }
}

export function writeConfigFile(filePath, data) {
  const text = JSON.stringify({ roots: data.roots, packages: data.packages }, null, 2) + '\n'
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, text)
}
