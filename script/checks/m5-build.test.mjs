// M5 — Build bridge. Done when publishing produces correct HTML in output/
// within a few seconds, the uploaded image resolves there, ten rapid saves
// cause one build, and unpublishing removes the page.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { tempDataDir, startApp } from './helpers.mjs'

let app, data, q, runner, outputDir

// A two-file fixture theme — the real one is M6.
function writeFixtureTheme(root) {
  const dir = path.join(root, 'themes', 'fixture')
  mkdirSync(path.join(dir, 'layouts'), { recursive: true })
  mkdirSync(path.join(dir, 'styles'), { recursive: true })
  writeFileSync(path.join(dir, 'theme.json'), JSON.stringify({
    name: 'Fixture', version: '1.0.0',
    layouts: 'layouts/', partials: 'partials/',
    styles: { in: 'styles/main.scss', out: 'css' }
  }))
  // poops wraps a page's body in `{% block content %}`, so layouts put their
  // own chrome in `{% block main %}` and leave `content` for the body.
  writeFileSync(path.join(dir, 'layouts', 'default.html'), `<!DOCTYPE html>
<html><head><title>{{ page.title }} — {{ site.title }}</title></head>
<body><main>{% block main %}{% block content %}{% endblock %}{% endblock %}</main></body></html>`)
  writeFileSync(path.join(dir, 'layouts', 'post.html'), `{% extends "default.html" %}
{% block main %}<article><h1>{{ page.title }}</h1>{% block content %}{% endblock %}</article>{% endblock %}`)
  writeFileSync(path.join(dir, 'layouts', 'collection.html'), `{% extends "default.html" %}
{% block main %}<ul>{% for post in blog.pageItems %}<li><a href="{{ relativePathPrefix }}{{ post.url }}">{{ post.title }}</a></li>{% endfor %}</ul>{% endblock %}`)
  writeFileSync(path.join(dir, 'layouts', 'page.html'), `{% extends "default.html" %}
{% block main %}<div class="page">{% block content %}{% endblock %}</div>{% endblock %}`)
  writeFileSync(path.join(dir, 'styles', 'main.scss'), 'body { color: #123456; }')
}

before(async () => {
  data = tempDataDir()
  outputDir = path.join(data.dir, 'output')
  writeFixtureTheme(data.dir)
  q = await import('../../server/queries.js')
  const auth = await import('../../server/auth.js')
  q.users.create({ email: 'admin@example.com', password_hash: auth.hashPassword('pw'), role: 'admin', display_name: 'Admin' })
  q.collections.create({ name: 'Blog', slug: 'blog', paginate: 5 })
  q.settings.set('site.title', 'Test Site')
  q.settings.set('site.url', 'https://example.com')
  q.settings.set('theme.active', 'fixture')
  runner = await import('../../server/build/runner.js')
  app = await startApp()
  await app.form('/admin/login', { email: 'admin@example.com', password: 'pw' })
})
after(async () => {
  await app.close()
  data.cleanup()
})

test('publishing produces the post, the collection index and a sitemap', async (t) => {
  const blog = q.collections.bySlug('blog')
  q.posts.create({
    collection_id: blog.id, slug: 'hello-world', title: 'Hello world',
    body_markdown: '## A heading\n\nSome *body* text.',
    status: 'published', published_at: '2024-03-15 10:00:00'
  })
  q.posts.create({ collection_id: null, slug: 'about', title: 'About', body_markdown: 'About us.', status: 'published', published_at: '2024-03-01 10:00:00' })
  q.posts.create({ collection_id: blog.id, slug: 'still-a-draft', title: 'Draft', body_markdown: 'nope', status: 'draft' })

  await runner.runBuild('check')
  assert.equal(runner.buildState.state, 'idle', runner.buildState.error || '')

  const post = path.join(outputDir, 'blog', 'hello-world.html')
  assert.ok(existsSync(post), 'post page missing')
  const html = readFileSync(post, 'utf8')
  assert.match(html, /<h1>Hello world<\/h1>/)
  assert.match(html, /<h2[^>]*>A heading/, 'markdown was not rendered')
  assert.match(html, /<em>body<\/em>/)
  assert.match(html, /Test Site/, 'site settings did not reach the templates')

  assert.ok(existsSync(path.join(outputDir, 'blog', 'index.html')), 'collection index missing')
  assert.match(readFileSync(path.join(outputDir, 'blog', 'index.html'), 'utf8'), /hello-world/)

  assert.ok(existsSync(path.join(outputDir, 'about.html')), 'standalone page missing')
  assert.ok(existsSync(path.join(outputDir, 'sitemap.xml')), 'sitemap missing')
  assert.ok(existsSync(path.join(outputDir, 'css', 'main.css')) || existsSync(path.join(outputDir, 'css', 'main.min.css')), 'theme styles missing')
})

test('drafts and future-dated posts never reach output/', async () => {
  assert.equal(existsSync(path.join(outputDir, 'blog', 'still-a-draft.html')), false)

  const blog = q.collections.bySlug('blog')
  q.posts.create({
    collection_id: blog.id, slug: 'from-the-future', title: 'Future', body_markdown: 'x',
    status: 'published', published_at: '2999-01-01 00:00:00'
  })
  await runner.runBuild('check')
  assert.equal(existsSync(path.join(outputDir, 'blog', 'from-the-future.html')), false)
})

test('uploads are copied into output/ under the same path the admin serves', async () => {
  const uploads = path.join(data.dir, 'uploads')
  mkdirSync(uploads, { recursive: true })
  writeFileSync(path.join(uploads, 'photo.jpg'), 'not-really-a-jpeg')
  await runner.runBuild('check')
  assert.ok(existsSync(path.join(outputDir, 'uploads', 'photo.jpg')))
})

test('meta.redirect_from becomes a redirect stub', async () => {
  const blog = q.collections.bySlug('blog')
  q.posts.create({
    collection_id: blog.id, slug: 'moved', title: 'Moved', body_markdown: 'here now',
    status: 'published', published_at: '2024-04-01 10:00:00',
    meta: { redirect_from: ['/2024/04/old-url'] }
  })
  await runner.runBuild('check')
  const stub = path.join(outputDir, '2024', '04', 'old-url', 'index.html')
  assert.ok(existsSync(stub), 'redirect stub missing')
  const html = readFileSync(stub, 'utf8')
  assert.match(html, /http-equiv="refresh"/)
  assert.match(html, /rel="canonical"/)
})

test('ten rapid saves cause one build, and the queue reports as building', async () => {
  const before = runner.buildStats.completed
  for (let i = 0; i < 10; i++) runner.requestBuild('rapid save')
  // The whole point of the Rebuild button: something visible happens before
  // the debounce window elapses.
  assert.equal(runner.buildState.state, 'building', 'a queued build must not report idle')
  await new Promise((resolve) => setTimeout(resolve, 4000))
  assert.equal(runner.buildStats.completed, before + 1)
  assert.equal(runner.buildState.state, 'idle', runner.buildState.error || '')
})

test('unpublishing removes the page from output/', async () => {
  const post = q.posts.list({ search: 'Hello world' }).rows[0]
  q.posts.setStatus(post.id, 'draft', post.published_at)
  await runner.runBuild('check')
  assert.equal(existsSync(path.join(outputDir, 'blog', 'hello-world.html')), false, 'stale page survived the swap')
  assert.ok(existsSync(path.join(outputDir, 'blog', 'index.html')), 'the rest of the site should still be there')
})
