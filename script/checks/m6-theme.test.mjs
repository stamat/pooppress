// M6 — Default theme. Done when a fresh install with three posts produces a
// readable, styled blog with working pagination and RSS.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { tempDataDir, seed } from './helpers.mjs'

let data, q, s, runner, outputDir

before(async () => {
  data = tempDataDir()
  outputDir = path.join(data.dir, 'output')
  q = await import('../../server/queries.js')
  s = await seed()
  const blog = s.collection({ name: 'Blog', slug: 'blog', paginate: 2 })
  q.settings.set('site.title', 'Fresh Install')
  q.settings.set('site.description', 'A blog about things')
  q.settings.set('site.url', 'https://example.com')
  q.settings.set('theme.active', 'default') // the bundled theme, not a fixture

  const posts = [
    ['first', 'First post', '2024-01-01 09:00:00'],
    ['second', 'Second post', '2024-02-01 09:00:00'],
    ['third', 'Third post', '2024-03-01 09:00:00']
  ]
  for (const [slug, title, date] of posts) {
    s.post({
      collection_id: blog.id, slug, title,
      body_markdown: `# ${title}\n\nBody of ${title} with a [link](https://example.com).`,
      excerpt: `Excerpt of ${title}`,
      status: 'published', published_at: date,
      // "Static Site" exercises slugified multi-word terms; only two of the
      // three posts carry it, so the term page must not be the whole index.
      meta: slug === 'first' ? { tags: ['js'] } : { tags: ['js', 'Static Site'], categories: ['Notes'] }
    })
  }
  s.post({ collection_id: null, slug: 'about', title: 'About', body_markdown: 'About page.', status: 'published', published_at: '2024-01-01 09:00:00' })

  runner = await import('../../server/build/runner.js')
  await runner.runBuild('check')
  assert.equal(runner.buildState.state, 'idle', runner.buildState.error || '')
})
after(() => data.cleanup())

const read = (...parts) => readFileSync(path.join(outputDir, ...parts), 'utf8')

test('the collection index paginates', () => {
  const page1 = read('blog', 'index.html')
  assert.match(page1, /Third post/)
  assert.match(page1, /Second post/)
  assert.ok(!page1.includes('First post'), 'page 1 should hold only the newest two posts')
  assert.ok(existsSync(path.join(outputDir, 'blog', '2', 'index.html')), 'page 2 missing')
  assert.match(read('blog', '2', 'index.html'), /First post/)
})

test('a post page is readable: title, body, date, navigation', () => {
  const post = read('blog', 'third.html')
  assert.match(post, /Third post/)
  assert.match(post, /Body of Third post/)
  assert.match(post, /<a href="https:\/\/example\.com">link<\/a>/)
  assert.match(post, /Fresh Install/, 'site title (header) missing')
  assert.match(post, /<footer/, 'footer missing')
  assert.match(post, /<time/, 'post date missing')
})

test('every term gets a paginated page listing only its posts', () => {
  // three posts tagged js, page size 2 — so the term page paginates too
  const js = read('blog', 'tag', 'js', 'index.html')
  assert.match(js, /Tag: js/)
  assert.match(js, /Third post/)
  assert.ok(!js.includes('First post'), 'term page 1 should hold only the newest two')
  assert.match(read('blog', 'tag', 'js', '2', 'index.html'), /First post/)

  // multi-word term slugified into the URL, and scoped to its two posts
  const staticSite = read('blog', 'tag', 'static-site', 'index.html')
  assert.match(staticSite, /Tag: Static Site/)
  assert.ok(!staticSite.includes('First post'), 'untagged post leaked onto a term page')

  assert.match(read('blog', 'category', 'notes', 'index.html'), /Category: Notes/)
})

test('posts and the collection index link their terms', () => {
  assert.match(read('blog', 'third.html'), /href="\.\.\/blog\/tag\/static-site\/"/)
  const index = read('blog', 'index.html')
  assert.match(index, /href="\.\.\/blog\/tag\/js\/"/)
  assert.match(index, /Notes/)
})

test('term pages stay out of the nav tree', () => {
  const nav = JSON.parse(read('nav.json'))
  const urls = JSON.stringify(nav)
  assert.ok(!urls.includes('/tag/'), `term pages leaked into the nav: ${urls}`)
})

test('SEO meta and canonical are emitted', () => {
  const post = read('blog', 'third.html')
  assert.match(post, /<meta name="description"/)
  assert.match(post, /property="og:title"/)
  assert.match(post, /rel="canonical"/)
})

test('styles compile and are linked', () => {
  const cssPath = ['css', 'main.min.css']
  assert.ok(existsSync(path.join(outputDir, ...cssPath)), 'compiled css missing')
  assert.match(read('blog', 'third.html'), /css\/main\.min\.css/)
  assert.ok(read(...cssPath).length > 100)
})

test('RSS is generated and points at absolute URLs', () => {
  const feedPath = path.join(outputDir, 'blog', 'feed.xml')
  assert.ok(existsSync(feedPath), 'feed missing')
  const feed = readFileSync(feedPath, 'utf8')
  assert.match(feed, /<rss/)
  assert.match(feed, /https:\/\/example\.com\/blog\/third\.html/)
  assert.match(read('blog', 'third.html'), /application\/rss\+xml/, 'feed not discoverable from the page')
})

test('standalone pages use the page layout', () => {
  const page = read('about.html')
  assert.match(page, /About page\./)
  assert.match(page, /Fresh Install/)
})
