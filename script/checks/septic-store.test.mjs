// The septic store as pooppress's data layer. Covered: access fails closed
// (anonymous and under-ranked callers), and a reboot on an existing database
// adopts it without touching schema or data. Deliberately not covered here:
// CRUD roundtrips, constraint conflicts and validation — m1-database owns
// those; route-level policy (ownership, author status ceiling) — p2-roles.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { tempDataDir, seed } from './helpers.mjs'

let data, db, s

before(async () => {
  data = tempDataDir()
  db = await import('../../server/db.js')
  db.getDb()
  s = await seed()
  s.collection({ name: 'Blog', slug: 'blog' })
})
after(() => data.cleanup())

test('a store call without a user is denied, not defaulted open', () => {
  assert.throws(() => s.store.posts.list({}), { name: 'AccessError', status: 401 }, 'an anonymous read of posts')
  assert.throws(() => s.store.posts.create({ slug: 'nope' }, {}), { name: 'AccessError', status: 401 }, 'an anonymous write of posts')
})

test('collections are editor territory in the store itself, not only in the routes', () => {
  const author = { id: 99, role: 'author' }
  assert.throws(() => s.store.collections.create({ name: 'Sneaky', slug: 'sneaky' }, { user: author }),
    { name: 'AccessError', status: 403 }, 'an author writing a collection')
  const editor = { id: 98, role: 'editor' }
  assert.ok(s.store.collections.create({ name: 'Fine', slug: 'fine' }, { user: editor }).id)
})

test('a store read is shaped to declared fields — password_hash cannot leave the users table', async () => {
  const q = await import('../../server/queries.js')
  q.users.create({ email: 'shaped@example.com', password_hash: 'hash-that-must-not-leak', role: 'admin' })
  const rows = s.store.users.list({ user: s.SYSTEM, limit: 10 })
  assert.ok(rows.length > 0)
  for (const row of rows) assert.equal('password_hash' in row, false, 'a shaped read carried password_hash')
})

test('rebooting on the existing database adopts it: schema, version and rows survive', () => {
  const post = s.post({ slug: 'survivor', title: 'Survivor' })
  const version = db.getDb().pragma('user_version', { simple: true })
  const columns = db.getDb().prepare("PRAGMA table_info('posts')").all().map((c) => c.name)

  db.closeDb()
  db.getDb() // migrate() no-ops, prepareDb adopts — the other order would crash on CREATE TABLE

  assert.equal(db.getDb().pragma('user_version', { simple: true }), version)
  assert.deepEqual(db.getDb().prepare("PRAGMA table_info('posts')").all().map((c) => c.name), columns, 'a reboot altered the posts table')
  assert.equal(s.store.posts.get(post.id, { user: s.SYSTEM }).title, 'Survivor')
})
