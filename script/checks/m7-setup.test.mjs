// M7 — Setup wizard + CLI. Done when an empty directory reaches a deployable
// output/ with no manual steps skipped.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, statSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tempDataDir, startApp } from './helpers.mjs'

let data, setup, q, app

before(async () => {
  data = tempDataDir()
  setup = await import('../../server/setup.js')
  q = await import('../../server/queries.js')
})
after(async () => {
  if (app) await app.close()
  data.cleanup()
})

test('init creates the database, the admin user, settings and a default collection', async () => {
  const result = await setup.initSite({
    title: 'My Blog',
    url: 'https://myblog.example',
    description: 'A blog about things',
    email: 'me@example.com',
    password: 'correct horse battery'
  })
  assert.equal(result.created, true)

  assert.ok(existsSync(path.join(data.dir, 'pooppress.db')))
  assert.equal(q.users.count(), 1)
  const user = q.users.byEmail('me@example.com')
  assert.equal(user.role, 'admin')

  assert.equal(q.settings.get('site.title'), 'My Blog')
  assert.equal(q.settings.get('site.url'), 'https://myblog.example')
  assert.equal(q.settings.get('theme.active'), 'default')
  assert.ok(q.collections.bySlug('blog'), 'a blog collection to write into')
})

test('data/ is private and init leaves no stray files', () => {
  assert.equal(statSync(data.dir).mode & 0o777, 0o700)
  assert.equal(existsSync(path.join(data.dir, '.env')), false, 'nothing reads a .env, so init must not write one')
})

test('init refuses to clobber an existing install', async () => {
  await assert.rejects(() => setup.initSite({ title: 'x', email: 'other@example.com', password: 'x' }), /already/i)
})

test('the new admin can log in and publish, and the CLI build produces output/', async () => {
  app = await startApp()
  const login = await app.form('/admin/login', { email: 'me@example.com', password: 'correct horse battery' })
  assert.equal(login.status, 302)

  const blog = q.collections.bySlug('blog')
  const created = await app.form('/admin/posts', {
    title: 'Hello', slug: 'hello', collection_id: String(blog.id), body_markdown: 'First post.'
  })
  const id = created.headers.get('location').match(/\/admin\/posts\/(\d+)/)[1]
  await app.form(`/admin/posts/${id}/publish`, {})

  const { runBuild, buildState } = await import('../../server/build/runner.js')
  await runBuild('cli')
  assert.equal(buildState.state, 'idle', buildState.error || '')
  assert.ok(existsSync(path.join(data.dir, 'output', 'blog', 'hello.html')))
})

test('deploy copies output/ to a target directory', async () => {
  const target = path.join(data.dir, 'deployed')
  mkdirSync(target, { recursive: true })
  writeFileSync(path.join(target, 'stale.html'), 'old file')
  const { deploy } = await import('../../server/deploy.js')
  await deploy({ method: 'copy', target })
  assert.ok(existsSync(path.join(target, 'blog', 'hello.html')))
  assert.equal(existsSync(path.join(target, 'stale.html')), false, 'a deploy mirrors, it does not accumulate')
})
