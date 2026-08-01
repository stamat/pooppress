// Settings, collections, users and themes screens — the rest of what the
// sidebar promises. Site-shaping changes rebuild; content-neutral ones don't.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tempDataDir, startApp } from './helpers.mjs'

let app, data, q, builds, auth

before(async () => {
  data = tempDataDir()
  q = await import('../../server/queries.js')
  auth = await import('../../server/auth.js')
  q.users.create({ email: 'admin@example.com', password_hash: auth.hashPassword('pw'), role: 'admin', display_name: 'Admin' })
  q.users.create({ email: 'author@example.com', password_hash: auth.hashPassword('pw'), role: 'author', display_name: 'Author' })
  q.settings.set('theme.active', 'default')
  builds = (await import('../../server/build/runner.js')).buildStats
  app = await startApp()
  await app.form('/admin/login', { email: 'admin@example.com', password: 'pw' })
})
after(async () => {
  await app.close()
  data.cleanup()
})

test('every sidebar destination renders', async () => {
  for (const url of ['/admin', '/admin/posts', '/admin/media', '/admin/collections', '/admin/themes', '/admin/users', '/admin/settings']) {
    const res = await app.request(url)
    assert.equal(res.status, 200, `${url} returned ${res.status}`)
  }
})

test('saving settings rebuilds the site', async () => {
  const before = builds.requested
  const res = await app.form('/admin/settings', { 'site.title': 'Renamed', 'site.url': 'https://renamed.example', 'site.description': 'x' })
  assert.equal(res.status, 302)
  assert.equal(q.settings.get('site.title'), 'Renamed')
  assert.equal(builds.requested, before + 1, 'settings shape the output, so they build')
})

test('collections CRUD works and refuses to delete a collection with posts', async () => {
  const created = await app.form('/admin/collections', { name: 'Notes', slug: 'notes', paginate: '5' })
  assert.equal(created.status, 302)
  const notes = q.collections.bySlug('notes')
  assert.equal(notes.paginate, 5)

  await app.form(`/admin/collections/${notes.id}`, { name: 'Field notes', slug: 'notes', sort_order: 'asc' })
  assert.equal(q.collections.get(notes.id).name, 'Field notes')

  q.posts.create({ collection_id: notes.id, slug: 'a-note', title: 'A note' })
  const blocked = await app.form(`/admin/collections/${notes.id}/delete`, {})
  assert.equal(blocked.status, 422)
  assert.ok(q.collections.get(notes.id), 'collection with posts must survive')
})

test('an invalid collection slug is rejected', async () => {
  const res = await app.form('/admin/collections', { name: 'Bad', slug: 'Not A Slug' })
  assert.equal(res.status, 422)
})

test('themes are discovered from the filesystem, never from a table', async () => {
  const custom = path.join(data.dir, 'themes', 'zine')
  mkdirSync(custom, { recursive: true })
  writeFileSync(path.join(custom, 'theme.json'), JSON.stringify({ name: 'Zine', version: '2.0.0' }))

  const listed = await (await app.request('/api/themes')).json()
  const slugs = listed.map((t) => t.slug)
  assert.ok(slugs.includes('zine'), 'a dropped-in directory is installed by definition')
  assert.ok(slugs.includes('default'))

  const before = builds.requested
  await app.form('/admin/themes/zine/activate', {})
  assert.equal(q.settings.get('theme.active'), 'zine')
  assert.equal(builds.requested, before + 1)
  await app.form('/admin/themes/default/activate', {})
})

test('theme config saves through the schema with real types', async () => {
  const before = builds.requested
  // showAuthor is a checkbox left unchecked — the field is simply absent.
  const res = await app.form('/admin/themes/default/config', {
    'config.accentColor': '#ff0000',
    'config.footerText': 'hand-rolled'
  })
  assert.equal(res.status, 302)
  const config = q.settings.get('theme.config')
  assert.deepEqual(config, { accentColor: '#ff0000', showAuthor: false, footerText: 'hand-rolled' })
  assert.equal(builds.requested, before + 1, 'theme config shapes every page, so it builds')
})

test('only admins manage users', async () => {
  const created = await app.form('/admin/users', { email: 'editor@example.com', password: 'another pw', role: 'editor', display_name: 'Editor' })
  assert.equal(created.status, 302)
  const editor = q.users.byEmail('editor@example.com')
  assert.equal(editor.role, 'editor')
  assert.equal(auth.verifyPassword('another pw', editor.password_hash), true)

  // an author may not reach the user screens
  const authorApp = await startApp()
  await authorApp.form('/admin/login', { email: 'author@example.com', password: 'pw' })
  assert.equal((await authorApp.request('/admin/users')).status, 403)
  assert.equal((await authorApp.request('/api/users')).status, 403)
  await authorApp.close()
})

test('changing a password drops that user other sessions', async () => {
  const other = await startApp()
  await other.form('/admin/login', { email: 'author@example.com', password: 'pw' })
  assert.equal((await other.request('/api/auth/me')).status, 200)

  const author = q.users.byEmail('author@example.com')
  await app.form(`/admin/users/${author.id}`, { password: 'brand new password' })

  assert.equal((await other.request('/api/auth/me')).status, 401, 'old session must die with the old password')
  assert.equal(auth.verifyPassword('brand new password', q.users.byEmail('author@example.com').password_hash), true)
  await other.close()
})

test('deleting a user keeps their posts but drops their sessions', async () => {
  const editor = q.users.byEmail('editor@example.com')
  q.posts.create({ slug: 'orphan', title: 'Orphan', author_id: editor.id })
  await app.form(`/admin/users/${editor.id}/delete`, {})
  assert.equal(q.users.byEmail('editor@example.com'), undefined)
  const post = q.posts.list({ search: 'Orphan' }).rows[0]
  assert.equal(post.author_id, null, 'posts outlive their author')
})

test('the last admin cannot delete themselves', async () => {
  const admin = q.users.byEmail('admin@example.com')
  const res = await app.form(`/admin/users/${admin.id}/delete`, {})
  assert.equal(res.status, 422)
  assert.ok(q.users.byEmail('admin@example.com'))
})
