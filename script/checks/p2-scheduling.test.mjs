// Phase 2 — scheduled publishing. Done when a post published with a future
// date triggers exactly one build request once its time arrives, and drafts
// never do. The sweep is called directly with a fake clock — the 60s interval
// is just plumbing around it.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { tempDataDir } from './helpers.mjs'

let data, q, builds, sweep

const sqlTime = (d) => d.toISOString().slice(0, 19).replace('T', ' ')

before(async () => {
  data = tempDataDir()
  q = await import('../../server/queries.js')
  q.collections.create({ name: 'Blog', slug: 'blog' })
  builds = (await import('../../server/build/runner.js')).buildStats
  sweep = (await import('../../server/build/scheduler.js')).sweepScheduled
})
after(() => data.cleanup())

test('a scheduled post builds when it comes due, not before', () => {
  const now = new Date()
  const inOneHour = new Date(now.getTime() + 60 * 60 * 1000)
  const blog = q.collections.bySlug('blog')
  q.posts.create({ collection_id: blog.id, slug: 'later', title: 'Later', status: 'published', published_at: sqlTime(inOneHour) })

  // The boot sweep may fire for already-published dated posts; none exist here.
  assert.equal(sweep(now), false, 'nothing is due yet')
  const before = builds.requested

  assert.equal(sweep(new Date(now.getTime() + 30 * 60 * 1000)), false, 'still not due at +30m')
  assert.equal(builds.requested, before, 'no build requested early')

  assert.equal(sweep(new Date(now.getTime() + 61 * 60 * 1000)), true, 'due at +61m')
  assert.equal(builds.requested, before + 1, 'one build requested')

  assert.equal(sweep(new Date(now.getTime() + 62 * 60 * 1000)), false, 'not requested twice')
  assert.equal(builds.requested, before + 1)
})

test('drafts and undated posts never trigger the scheduler', () => {
  const blog = q.collections.bySlug('blog')
  q.posts.create({ collection_id: blog.id, slug: 'draft', title: 'Draft', status: 'draft' })
  q.posts.create({ collection_id: blog.id, slug: 'undated', title: 'Undated', status: 'published', published_at: null })
  const before = builds.requested
  assert.equal(sweep(new Date(Date.now() + 90 * 60 * 1000)), false)
  assert.equal(builds.requested, before)
})
