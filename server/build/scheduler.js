// Scheduled publishing. The build already exports only posts with
// published_at <= now (M5), so a scheduled post needs no status flip — just a
// rebuild once its time arrives. A sweep asks "did anything come due since the
// last sweep?" and requests a build if so.
import { posts } from '../queries.js'
import { requestBuild } from './runner.js'

const toSql = (d) => d.toISOString().slice(0, 19).replace('T', ' ')

// ponytail: lastSweep starts at the epoch, so the first sweep after boot
// requests one rebuild if any dated published post exists — that also covers
// posts that came due while the server was down. Persist the last build time
// if that redundant boot build ever hurts.
let lastSweep = '1970-01-01 00:00:00'

export function sweepScheduled(now = new Date()) {
  const till = toSql(now)
  const due = posts.dueBetween(lastSweep, till)
  lastSweep = till
  if (due > 0) requestBuild('scheduled')
  return due > 0
}

export function startScheduler(intervalMs = 60_000) {
  const timer = setInterval(() => sweepScheduled(), intervalMs)
  timer.unref?.() // the scheduler must not hold the process open
  return timer
}
