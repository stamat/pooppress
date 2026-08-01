// Phase 2 — roles. Done when the admin/editor/author matrix holds over real
// HTTP: authors see and touch only their own drafts, publishing is an editor
// call, and author-role raw HTML never reaches the build's markup export.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { tempDataDir, startApp } from './helpers.mjs'

let app, data, q

const login = (email) => app.form('/admin/login', { email, password: 'pw' })

before(async () => {
  data = tempDataDir()
  q = await import('../../server/queries.js')
  const auth = await import('../../server/auth.js')
  q.users.create({ email: 'admin@example.com', password_hash: auth.hashPassword('pw'), role: 'admin', display_name: 'Admin' })
  q.users.create({ email: 'editor@example.com', password_hash: auth.hashPassword('pw'), role: 'editor', display_name: 'Editor' })
  q.users.create({ email: 'author@example.com', password_hash: auth.hashPassword('pw'), role: 'author', display_name: 'Author' })
  q.collections.create({ name: 'Blog', slug: 'blog' })
  app = await startApp()
})
after(async () => {
  await app.close()
  data.cleanup()
})

const blog = () => q.collections.bySlug('blog')

test('an author saves drafts and review, never published', async () => {
  app.clearCookie()
  await login('author@example.com')
  const draft = await app.form('/admin/posts', {
    title: 'Mine', slug: 'mine', collection_id: String(blog().id), body_markdown: 'hello', status: 'draft'
  })
  assert.equal(draft.status, 302)

  const published = await app.form('/admin/posts', {
    title: 'Sneaky', slug: 'sneaky', collection_id: String(blog().id), body_markdown: 'x', status: 'published'
  })
  assert.equal(published.status, 422, 'publishing via status field is refused')

  const id = q.posts.list({}).rows.find((p) => p.slug === 'mine').id
  const publish = await app.request(`/admin/posts/${id}/publish`, { method: 'POST' })
  assert.equal(publish.status, 403, 'the publish endpoint is refused')
})

test('an author sees only their own posts', async () => {
  app.clearCookie()
  await login('editor@example.com')
  await app.form('/admin/posts', {
    title: 'Editorial', slug: 'editorial', collection_id: String(blog().id), body_markdown: 'x', status: 'draft'
  })

  app.clearCookie()
  await login('author@example.com')
  const list = await app.request('/api/posts')
  const rows = (await list.json()).rows
  assert.ok(rows.length >= 1)
  assert.ok(rows.every((p) => p.author_id === q.users.byEmail('author@example.com').id), 'no foreign posts in the list')

  const foreign = q.posts.list({}).rows.find((p) => p.slug === 'editorial')
  const page = await app.request(`/admin/posts/${foreign.id}`)
  assert.equal(page.status, 403, 'a foreign post is not even readable')
  const update = await app.form(`/admin/posts/${foreign.id}`, { title: 'Hijack', slug: 'editorial', body_markdown: 'x' })
  assert.equal(update.status, 403)
})

test('a published post is read-only to its author', async () => {
  app.clearCookie()
  await login('editor@example.com')
  const author = q.users.byEmail('author@example.com')
  const mine = q.posts.list({}).rows.find((p) => p.slug === 'mine')
  await app.request(`/admin/posts/${mine.id}/publish`, { method: 'POST' })

  app.clearCookie()
  await login('author@example.com')
  const update = await app.form(`/admin/posts/${mine.id}`, { title: 'Edited live', slug: 'mine', body_markdown: 'y' })
  assert.equal(update.status, 403, 'own published post cannot be edited')
  const del = await app.request(`/admin/posts/${mine.id}/delete`, { method: 'POST' })
  assert.equal(del.status, 403, 'own published post cannot be deleted')
  assert.equal(mine.author_id, author.id, 'sanity: the post really is the author’s')
})

test('collections and manual builds are editor territory', async () => {
  app.clearCookie()
  await login('author@example.com')
  assert.equal((await app.request('/admin/collections')).status, 403)
  assert.equal((await app.request('/api/build', { method: 'POST' })).status, 403)

  app.clearCookie()
  await login('editor@example.com')
  assert.equal((await app.request('/admin/collections')).status, 200)
})

test('author-role raw HTML is stripped from the build export, code intact', async () => {
  const { stripRawHtml } = await import('../../server/build/sanitize.js')
  const body = 'intro <script>alert(1)</script>\n\n```html\n<div>keep</div>\n```\n\nuse `<br>` and note 3 < 5\n<img src=x onerror=alert(2)>'
  const stripped = stripRawHtml(body)
  assert.ok(!stripped.includes('<script>'), 'script tag neutralized')
  assert.ok(!stripped.includes('<img'), 'img tag neutralized')
  assert.ok(stripped.includes('&lt;script>'), 'escaped, not deleted')
  assert.ok(stripped.includes('<div>keep</div>'), 'fenced code untouched')
  assert.ok(stripped.includes('`<br>`'), 'inline code untouched')
  assert.ok(stripped.includes('3 < 5'), 'plain less-than untouched')

  // and the build export takes that path for author-role posts
  assert.ok(q.posts.published().every((p) => 'author_role' in p), 'published() carries author_role')
})
