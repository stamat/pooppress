import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, rmSync, cpSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { OUTPUT_DIR } from './config.js'
import { settings } from './queries.js'

const run = promisify(execFile)

// Two methods, both a mirror of output/: copy (local path, no dependencies)
// and rsync (anything reachable over ssh). Everything else — S3, Netlify —
// stays parked until someone asks; `output/` is a plain directory, so any
// existing tool already deploys it.
export async function deploy(options = {}) {
  const config = { ...(settings.get('deploy') || {}), ...options }
  const method = config.method || 'copy'
  if (!existsSync(OUTPUT_DIR)) throw new Error('Nothing to deploy — run a build first.')

  if (method === 'copy') {
    const target = path.resolve(config.target || '')
    if (!config.target) throw new Error('deploy: a target directory is required.')
    if (target === path.resolve(OUTPUT_DIR)) throw new Error('deploy: target and output are the same directory.')
    // Mirror: whatever is no longer in output/ must stop being served.
    for (const entry of readdirSync(target)) rmSync(path.join(target, entry), { recursive: true, force: true })
    cpSync(OUTPUT_DIR, target, { recursive: true })
    return { method, target }
  }

  if (method === 'rsync') {
    const destination = config.host ? `${config.host}:${config.path}` : config.path
    if (!destination) throw new Error('deploy: rsync needs a host and path.')
    const { stdout } = await run('rsync', ['-az', '--delete', `${OUTPUT_DIR}/`, destination])
    return { method, destination, stdout }
  }

  throw new Error(`Unknown deploy method "${method}". Supported: copy, rsync.`)
}
