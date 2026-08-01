import { openSync, closeSync, unlinkSync, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { DATA_DIR, OUTPUT_DIR } from '../config.js'

const LOCK_PATH = path.join(DATA_DIR, 'build.lock')
const DEBOUNCE_MS = 2000
const STALE_LOCK_MS = 10 * 60 * 1000

// Observable so a check can assert "a day of draft edits triggers zero builds".
export const buildStats = { requested: 0, completed: 0, failed: 0 }
// finished_at survives a restart by reading output/ — swapOutput() renames the
// directory into place, so its mtime *is* the last build time.
export const buildState = { state: 'idle', error: null, finished_at: lastOutputTime(), reason: null }

function lastOutputTime() {
  try { return new Date(statSync(OUTPUT_DIR).mtimeMs).toISOString() } catch { return null }
}

let timer = null

// Called by publish/unpublish/delete-of-published/settings/theme changes.
// Draft saves and autosaves never call it — that is the whole point.
export function requestBuild(reason = 'change') {
  buildStats.requested++
  buildState.reason = reason
  // Queued counts as building: without this the status endpoint answers 'idle'
  // for the whole debounce window, so a Rebuild click looks like it did nothing.
  buildState.state = 'building'
  buildState.error = null
  clearTimeout(timer)
  timer = setTimeout(() => { runBuild(reason).catch(() => {}) }, DEBOUNCE_MS)
  timer.unref?.() // a pending build must not hold the process open
  return { queued: true }
}

// The lock is a file, not a variable: Passenger runs several workers against
// the same directory, so process memory can't be the authority.
function acquireLock() {
  try {
    closeSync(openSync(LOCK_PATH, 'wx'))
    return true
  } catch (err) {
    if (err.code !== 'EEXIST') throw err
    // ponytail: a crashed build leaves its lock behind; age it out rather than
    // tracking PIDs. Raise STALE_LOCK_MS if a site ever builds for 10 minutes.
    if (existsSync(LOCK_PATH) && Date.now() - statSync(LOCK_PATH).mtimeMs > STALE_LOCK_MS) {
      unlinkSync(LOCK_PATH)
      return acquireLock()
    }
    return false
  }
}

function releaseLock() {
  try { unlinkSync(LOCK_PATH) } catch { /* already gone */ }
}

export async function runBuild(reason = 'manual') {
  // The lock is the only concurrency guard — a state check here would refuse
  // every debounced build now that requestBuild() marks the queue 'building',
  // and would wedge the process forever on a stale lock.
  if (!acquireLock()) {
    buildState.state = 'building' // another worker holds it
    return buildState
  }
  buildState.state = 'building'
  buildState.error = null
  buildState.reason = reason
  try {
    const { buildSite } = await import('./bridge.js')
    await buildSite()
    buildStats.completed++
    buildState.state = 'idle'
  } catch (err) {
    buildStats.failed++
    buildState.state = 'error'
    buildState.error = err.message
    console.error('[build]', err)
  } finally {
    buildState.finished_at = new Date().toISOString()
    releaseLock()
  }
  return buildState
}
