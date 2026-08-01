// M1 — Database. Done when a post roundtrips and rerunning migrations is a no-op.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { tempDataDir } from './helpers.mjs'

let data, db, migrate, q

before(async () => {
  data = tempDataDir()
  const mod = await import('../../server/db.js')
  db = mod.getDb()
  migrate = mod.migrate
  q = await import('../../server/queries.js')
})
after(() => data.cleanup())

test('migrations create the schema and set user_version', () => {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name)
  for (const t of ['collections', 'media', 'posts', 'sessions', 'settings', 'users']) {
    assert.ok(tables.includes(t), `missing table ${t}`)
  }
  assert.ok(db.pragma('user_version', { simple: true }) > 0)
})

test('rerunning migrations is a no-op', () => {
  const before = db.pragma('user_version', { simple: true })
  const applied = migrate(db)
  assert.deepEqual(applied, [])
  assert.equal(db.pragma('user_version', { simple: true }), before)
})

test('pragmas: WAL, foreign keys, busy timeout', () => {
  assert.equal(db.pragma('journal_mode', { simple: true }), 'wal')
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1)
})

test('a post roundtrips through the query helpers', () => {
  const user = q.users.create({ email: 'a@example.com', password_hash: 'x', role: 'admin', display_name: 'A' })
  const collection = q.collections.create({ name: 'Blog', slug: 'blog' })
  const post = q.posts.create({
    collection_id: collection.id,
    author_id: user.id,
    slug: 'hello-world',
    title: 'Hello world',
    body_markdown: '# Hi',
    meta: { tags: ['intro'] }
  })
  const read = q.posts.get(post.id)
  assert.equal(read.title, 'Hello world')
  assert.equal(read.body_markdown, '# Hi')
  assert.deepEqual(read.meta, { tags: ['intro'] })
  assert.equal(read.status, 'draft')
})

test('slug uniqueness is scoped per collection, and NULL collections collide', () => {
  const other = q.collections.create({ name: 'Notes', slug: 'notes' })
  const blog = q.collections.bySlug('blog')
  // same slug in another collection is fine
  q.posts.create({ collection_id: other.id, slug: 'hello-world', title: 'Other' })
  assert.throws(() => q.posts.create({ collection_id: blog.id, slug: 'hello-world', title: 'Dup' }), /UNIQUE/)
  // two standalone pages with the same slug would overwrite each other at build
  q.posts.create({ collection_id: null, slug: 'about', title: 'About' })
  assert.throws(() => q.posts.create({ collection_id: null, slug: 'about', title: 'About again' }), /UNIQUE/)
})

test('status is constrained', () => {
  assert.throws(() => q.posts.create({ slug: 'bad-status', title: 'x', status: 'whatever' }), /CHECK/)
})

test('settings store JSON values', () => {
  q.settings.set('site.title', 'My Blog')
  q.settings.set('theme.config', { primaryColor: '#333' })
  assert.equal(q.settings.get('site.title'), 'My Blog')
  assert.deepEqual(q.settings.get('theme.config'), { primaryColor: '#333' })
  assert.deepEqual(q.settings.all()['site.title'], 'My Blog')
})

test('post list filters by status and search', () => {
  q.posts.create({ slug: 'findme', title: 'Findable thing', status: 'published', published_at: '2024-01-01 00:00:00' })
  const published = q.posts.list({ status: 'published' })
  assert.ok(published.rows.every((p) => p.status === 'published'))
  const found = q.posts.list({ search: 'Findable' })
  assert.equal(found.rows.length, 1)
  // LIKE wildcards in user input must not widen the search
  assert.equal(q.posts.list({ search: '%' }).rows.length, 0)
})

test("collection_id 'none' lists standalone pages only", () => {
  const pages = q.posts.list({ collection_id: 'none' })
  assert.ok(pages.total > 0)
  assert.ok(pages.rows.every((p) => p.collection_id === null))
  // and it must not be read as a collection id
  assert.notEqual(pages.total, q.posts.list({}).total)
})
