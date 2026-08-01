// M3 — Post CRUD + editor. Done when create → edit → save → list roundtrips
// with plain form posts (no JS), htmx endpoints answer HTML partials, and a
// day of draft edits triggers zero builds.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { tempDataDir, startApp } from './helpers.mjs'

let app, data, q, builds

before(async () => {
  data = tempDataDir()
  q = await import('../../server/queries.js')
  const auth = await import('../../server/auth.js')
  q.users.create({ email: 'admin@example.com', password_hash: auth.hashPassword('pw'), role: 'admin', display_name: 'Admin' })
  q.collections.create({ name: 'Blog', slug: 'blog' })
  builds = (await import('../../server/build/runner.js')).buildStats
  app = await startApp()
  await app.form('/admin/login', { email: 'admin@example.com', password: 'pw' })
})
after(async () => {
  await app.close()
  data.cleanup()
})

const blogId = () => String(2)

test('create → edit → save → list roundtrip without JS', async () => {
  const collection = q.collections.bySlug('blog')
  const created = await app.form('/admin/posts', {
    title: 'First post', slug: 'first-post', collection_id: String(collection.id),
    body_markdown: '# Hello', status: 'draft'
  })
  assert.equal(created.status, 302)
  const id = created.headers.get('location').match(/\/admin\/posts\/(\d+)/)[1]

  const edit = await app.request(`/admin/posts/${id}`)
  assert.equal(edit.status, 200)
  const html = await edit.text()
  assert.ok(html.includes('First post'))
  assert.ok(html.includes('# Hello'))

  await app.form(`/admin/posts/${id}`, {
    title: 'First post edited', slug: 'first-post', collection_id: String(collection.id),
    body_markdown: '# Hello again', status: 'draft'
  })
  assert.equal(q.posts.get(Number(id)).title, 'First post edited')

  const list = await app.request('/admin/posts')
  assert.ok((await list.text()).includes('First post edited'))
})

test('htmx requests get the table partial, not the whole page', async () => {
  const res = await app.request('/admin/posts?search=First', { headers: { 'HX-Request': 'true' } })
  const html = await res.text()
  assert.ok(!html.includes('<!DOCTYPE html>'), 'partial must not be a full page')
  assert.ok(html.includes('First post edited'))
})

test('search and status filters narrow the list', async () => {
  const empty = await app.request('/admin/posts?search=nothingmatchesthis', { headers: { 'HX-Request': 'true' } })
  assert.ok((await empty.text()).includes('No posts'))
  const published = await app.request('/admin/posts?status=published', { headers: { 'HX-Request': 'true' } })
  assert.ok((await published.text()).includes('No posts'))
})

test('invalid slugs are rejected server-side', async () => {
  for (const slug of ['Not Valid', '-leading', 'trailing-/../etc', 'ünicode']) {
    const res = await app.form('/admin/posts', { title: 'x', slug, body_markdown: '' })
    assert.equal(res.status, 422, `slug "${slug}" should be rejected`)
  }
})

test('duplicate slugs in one collection are rejected, not 500', async () => {
  const collection = q.collections.bySlug('blog')
  const res = await app.form('/admin/posts', {
    title: 'Dup', slug: 'first-post', collection_id: String(collection.id), body_markdown: ''
  })
  assert.equal(res.status, 422)
})

test('meta key/value rows become the meta JSON column', async () => {
  const collection = q.collections.bySlug('blog')
  const created = await app.form('/admin/posts', {
    title: 'With meta', slug: 'with-meta', collection_id: String(collection.id), body_markdown: '',
    meta_key: ['featured_image', 'tags'], meta_value: ['/uploads/a.jpg', '["a","b"]']
  })
  const id = Number(created.headers.get('location').match(/\/admin\/posts\/(\d+)/)[1])
  const post = q.posts.get(id)
  assert.equal(post.meta.featured_image, '/uploads/a.jpg')
  assert.deepEqual(post.meta.tags, ['a', 'b'], 'JSON-looking values are stored as JSON')
})

test('drafts and autosaves trigger zero builds; publishing triggers one', async () => {
  const collection = q.collections.bySlug('blog')
  const before = builds.requested
  const created = await app.form('/admin/posts', {
    title: 'Build trigger', slug: 'build-trigger', collection_id: String(collection.id), body_markdown: 'x'
  })
  const id = Number(created.headers.get('location').match(/\/admin\/posts\/(\d+)/)[1])

  for (let i = 0; i < 10; i++) {
    await app.form(`/admin/posts/${id}`, { body_markdown: `draft ${i}`, autosave: '1' }, { headers: { 'HX-Request': 'true' } })
  }
  assert.equal(builds.requested, before, 'draft saves must not build')

  const published = await app.form(`/admin/posts/${id}/publish`, {})
  assert.equal(published.status, 302)
  assert.equal(q.posts.get(id).status, 'published')
  assert.ok(q.posts.get(id).published_at, 'publishing stamps published_at')
  assert.equal(builds.requested, before + 1)

  await app.form(`/admin/posts/${id}/unpublish`, {})
  assert.equal(q.posts.get(id).status, 'draft')
  assert.equal(builds.requested, before + 2)
})

test('deleting a post removes it and requests a build only when it was published', async () => {
  const collection = q.collections.bySlug('blog')
  const draft = await app.form('/admin/posts', { title: 'Trash me', slug: 'trash-me', collection_id: String(collection.id), body_markdown: '' })
  const id = Number(draft.headers.get('location').match(/\/admin\/posts\/(\d+)/)[1])
  const before = builds.requested
  await app.form(`/admin/posts/${id}/delete`, {})
  assert.equal(q.posts.get(id), undefined)
  assert.equal(builds.requested, before, 'deleting a draft changes nothing public')
})

test('the JSON API mirrors the form routes', async () => {
  const collection = q.collections.bySlug('blog')
  const created = await app.json('/api/posts', { title: 'API post', slug: 'api-post', collection_id: collection.id, body_markdown: 'hi' })
  assert.equal(created.status, 201)
  const post = await created.json()
  assert.equal(post.slug, 'api-post')

  const updated = await app.json(`/api/posts/${post.id}`, { title: 'API post renamed' }, { method: 'PUT' })
  assert.equal((await updated.json()).title, 'API post renamed')

  const listed = await (await app.request('/api/posts?search=API')).json()
  assert.equal(listed.rows.length, 1)

  const removed = await app.request(`/api/posts/${post.id}`, { method: 'DELETE' })
  assert.equal(removed.status, 204)
})
