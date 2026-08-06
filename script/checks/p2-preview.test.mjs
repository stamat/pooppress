// Phase 2 — draft preview. Done when previewing a draft yields a token URL
// that renders the draft with the real theme, nothing lands in output/, and
// the next site build expires every preview.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { tempDataDir, startApp, seed } from './helpers.mjs'

let app, data, q, s

function writeFixtureTheme(root) {
  const dir = path.join(root, 'themes', 'fixture')
  mkdirSync(path.join(dir, 'layouts'), { recursive: true })
  writeFileSync(path.join(dir, 'theme.json'), JSON.stringify({ name: 'Fixture', version: '1.0.0', layouts: 'layouts/' }))
  writeFileSync(path.join(dir, 'layouts', 'default.html'), `<!DOCTYPE html>
<html><head><title>{{ page.title }}</title></head><body>{% block main %}{% block content %}{% endblock %}{% endblock %}</body></html>`)
  writeFileSync(path.join(dir, 'layouts', 'post.html'), `{% extends "default.html" %}
{% block main %}<article><h1>{{ page.title }}</h1>{% block content %}{% endblock %}</article>{% endblock %}`)
  writeFileSync(path.join(dir, 'layouts', 'collection.html'), `{% extends "default.html" %}
{% block main %}<ul>{% for post in page.pageItems %}<li>{{ post.title }}</li>{% endfor %}</ul>{% endblock %}`)
}

before(async () => {
  data = tempDataDir()
  writeFixtureTheme(data.dir)
  q = await import('../../server/queries.js')
  s = await seed()
  const auth = await import('../../server/auth.js')
  q.users.create({ email: 'admin@example.com', password_hash: auth.hashPassword('pw'), role: 'admin', display_name: 'Admin' })
  s.collection({ name: 'Blog', slug: 'blog' })
  q.settings.set('theme.active', 'fixture')
  app = await startApp()
  await app.form('/admin/login', { email: 'admin@example.com', password: 'pw' })
})
after(async () => {
  await app.close()
  data.cleanup()
})

test('a draft previews at a token URL and never reaches output/', async (t) => {
  const blog = q.collections.bySlug('blog')
  const created = await app.form('/admin/posts', {
    title: 'Secret draft', slug: 'secret-draft', collection_id: String(blog.id),
    body_markdown: '# Not public yet', status: 'draft'
  })
  const id = created.headers.get('location').match(/(\d+)/)[1]

  const preview = await app.request(`/admin/posts/${id}/preview`, { method: 'POST' })
  assert.equal(preview.status, 302)
  const url = preview.headers.get('location')
  assert.match(url, /^\/preview\/[0-9a-f]{32}\/blog\/secret-draft\.html$/)

  const page = await app.request(url)
  assert.equal(page.status, 200)
  const html = await page.text()
  assert.ok(html.includes('Secret draft'), 'the draft renders')

  assert.ok(!existsSync(path.join(data.dir, 'output', 'blog', 'secret-draft.html')), 'output/ untouched')

  // The next site build expires every preview token.
  const { runBuild } = await import('../../server/build/runner.js')
  await runBuild('check')
  assert.equal((await app.request(url)).status, 404, 'token dead after a build')
})
