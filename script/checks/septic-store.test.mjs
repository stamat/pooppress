// The septic store as pooppress's data layer. Covered: access fails closed
// (anonymous and under-ranked callers), clearing a field through a whole-row
// update — the behaviour that retired this codebase's COALESCE updates, and the
// one whose absence let a blanked field silently keep its old value — and a
// reboot on an existing database adopting it without touching schema or data.
// Deliberately not covered here: CRUD roundtrips, constraint conflicts and
// validation — m1-database owns those; route-level policy (ownership, author
// status ceiling) — p2-roles.
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

// Unscheduling a post, moving it out of a collection and dropping its excerpt
// are all one write: the editor empties the control and saves the whole row.
test('a whole-row update clears the fields the editor emptied', () => {
  const collection = s.collection({ name: 'Clearable', slug: 'clearable' })
  const post = s.post({
    slug: 'clear-me', title: 'Clear me', collection_id: collection.id,
    excerpt: 'A summary', status: 'published', published_at: '2026-01-01 09:00:00'
  })
  const cleared = s.store.posts.update(post.id, {
    ...post, collection_id: null, excerpt: null, published_at: null
  }, { user: s.SYSTEM })

  assert.equal(cleared.collection_id, null, 'the post stayed in its collection')
  assert.equal(cleared.excerpt, null, 'the excerpt survived being cleared')
  assert.equal(cleared.published_at, null, 'the post stayed scheduled')
  assert.equal(cleared.title, 'Clear me', 'an untouched field was cleared along with them')
})

// title and body_markdown are NOT NULL DEFAULT '' in 001-init.sql, so a cleared
// one has to store '' — writing NULL there is a constraint failure on a save
// the editor is entitled to make.
test('emptying a NOT NULL text column stores the empty string, not a constraint failure', () => {
  const post = s.post({ slug: 'empty-body', title: 'Had a body', body_markdown: 'Some prose' })
  const emptied = s.store.posts.update(post.id, { ...post, body_markdown: '' }, { user: s.SYSTEM })
  assert.equal(emptied.body_markdown, '', 'an emptied body did not save')
})

test('alt text can be cleared, which is what the media screen posts when the box is emptied', () => {
  const row = s.media({ original_name: 'p.png', path: 'uploads/p.png', mime_type: 'image/png', size_bytes: 1, alt_text: 'A picture' })
  const cleared = s.store.media.update(row.id, { ...row, alt_text: '' }, { user: s.SYSTEM })
  assert.equal(cleared.alt_text, '', 'the old alt text stayed on the row')
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
