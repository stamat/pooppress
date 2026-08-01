// M9 — WordPress importer. Done when a WXR export imports and builds a
// browsable site where every old post URL resolves, directly or via a stub.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import sharp from 'sharp'
import { tempDataDir } from './helpers.mjs'

let data, q, importer, media, outputDir, origin, server

// A WXR export with two posts, a page, two authors, an attachment and a
// category — the shapes a real export mixes.
function wxr(base) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:wp="http://wordpress.org/export/1.2/"
  xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
  <title>Old Blog</title>
  <link>${base}</link>
  <description>Migrated</description>
  <wp:base_site_url>${base}</wp:base_site_url>
  <wp:author><wp:author_login>jane</wp:author_login><wp:author_email>jane@example.com</wp:author_email><wp:author_display_name>Jane Doe</wp:author_display_name></wp:author>
  <wp:author><wp:author_login>bob</wp:author_login><wp:author_email>bob@example.com</wp:author_email><wp:author_display_name>Bob</wp:author_display_name></wp:author>
  <item>
    <title>Hello WordPress</title>
    <link>${base}/2019/07/hello-wordpress/</link>
    <dc:creator>jane</dc:creator>
    <content:encoded><![CDATA[<p>An old post with an <img src="${base}/wp-content/uploads/2019/07/photo.jpg" srcset="${base}/wp-content/uploads/2019/07/photo-300x200.jpg 300w" alt="a photo"> inside.</p>]]></content:encoded>
    <excerpt:encoded xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/"><![CDATA[Old summary]]></excerpt:encoded>
    <wp:post_id>11</wp:post_id>
    <wp:post_date>2019-07-04 10:11:12</wp:post_date>
    <wp:post_name>hello-wordpress</wp:post_name>
    <wp:status>publish</wp:status>
    <wp:post_type>post</wp:post_type>
    <category domain="category" nicename="notes"><![CDATA[Notes]]></category>
    <category domain="post_tag" nicename="legacy"><![CDATA[Legacy]]></category>
  </item>
  <item>
    <title>Unfinished</title>
    <link>${base}/?p=12</link>
    <dc:creator>bob</dc:creator>
    <content:encoded><![CDATA[<p>Draft body.</p>]]></content:encoded>
    <wp:post_id>12</wp:post_id>
    <wp:post_date>2020-01-01 00:00:00</wp:post_date>
    <wp:post_name>unfinished</wp:post_name>
    <wp:status>draft</wp:status>
    <wp:post_type>post</wp:post_type>
  </item>
  <item>
    <title>About</title>
    <link>${base}/about/</link>
    <dc:creator>jane</dc:creator>
    <content:encoded><![CDATA[<p>About this blog.</p>]]></content:encoded>
    <wp:post_id>13</wp:post_id>
    <wp:post_date>2019-01-01 00:00:00</wp:post_date>
    <wp:post_name>about</wp:post_name>
    <wp:status>publish</wp:status>
    <wp:post_type>page</wp:post_type>
  </item>
  <item>
    <title>photo</title>
    <link>${base}/hello-wordpress/photo/</link>
    <wp:post_id>14</wp:post_id>
    <wp:post_type>attachment</wp:post_type>
    <wp:attachment_url>${base}/wp-content/uploads/2019/07/photo.jpg</wp:attachment_url>
  </item>
</channel>
</rss>`
}

before(async () => {
  data = tempDataDir()
  outputDir = path.join(data.dir, 'output')
  q = await import('../../server/queries.js')
  media = q.media
  const setup = await import('../../server/setup.js')
  await setup.initSite({ title: 'Migrated', url: 'https://new.example', email: 'me@example.com', password: 'passwordpassword' })
  importer = await import('../../server/import/wxr.js')

  const jpeg = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#888' } }).jpeg().toBuffer()
  server = createServer((req, res) => {
    if (req.url.endsWith('photo.jpg')) {
      res.writeHead(200, { 'content-type': 'image/jpeg' })
      return res.end(jpeg)
    }
    res.writeHead(404).end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${server.address().port}`
})
after(async () => {
  await new Promise((resolve) => server.close(resolve))
  data.cleanup()
})

test('importing a WXR brings over posts, pages, authors, taxonomy and media', async () => {
  const file = path.join(data.dir, 'export.xml')
  writeFileSync(file, wxr(origin))
  const result = await importer.importWxr(file, { collection: 'blog' })

  assert.equal(result.posts, 2)
  assert.equal(result.pages, 1)
  assert.equal(result.users, 2)
  assert.equal(result.media, 1)

  const blog = q.collections.bySlug('blog')
  const hello = q.posts.list({ search: 'Hello WordPress' }).rows[0]
  assert.equal(hello.collection_id, blog.id)
  assert.equal(hello.status, 'published')
  assert.equal(hello.published_at, '2019-07-04 10:11:12')
  assert.equal(hello.excerpt, 'Old summary')
  assert.deepEqual(hello.meta.categories, ['notes'])
  assert.deepEqual(hello.meta.tags, ['legacy'])

  const draft = q.posts.list({ search: 'Unfinished' }).rows[0]
  assert.equal(draft.status, 'draft')

  const about = q.posts.list({ search: 'About' }).rows[0]
  assert.equal(about.collection_id, null, 'pages are standalone')

  const jane = q.users.byEmail('jane@example.com')
  assert.equal(jane.display_name, 'Jane Doe')
  assert.equal(hello.author_id, jane.id)
})

test('imported users cannot log in until an admin resets them', async () => {
  const auth = await import('../../server/auth.js')
  const jane = q.users.byEmail('jane@example.com')
  assert.equal(auth.verifyPassword('', jane.password_hash), false)
  assert.equal(auth.verifyPassword('password', jane.password_hash), false)
  assert.match(jane.password_hash, /^scrypt\$/, 'still a real hash, just of an unguessable value')
})

test('attachments are downloaded and body URLs rewritten', () => {
  const row = media.list().rows[0]
  assert.match(row.path, /^uploads\/[0-9a-f-]{36}\.jpg$/)
  assert.ok(existsSync(path.join(data.dir, row.path)))

  const hello = q.posts.list({ search: 'Hello WordPress' }).rows[0]
  assert.ok(!hello.body_markdown.includes(origin), 'old absolute URL survived the rewrite')
  assert.ok(hello.body_markdown.includes(`/${row.path}`), 'body does not point at the imported file')
  // WordPress srcset variants (photo-300x200.jpg) map to the same imported file
  assert.ok(!hello.body_markdown.includes('photo-300x200'), 'sized srcset variant survived the rewrite')
})

test('old permalinks are preserved as redirect stubs', () => {
  const hello = q.posts.list({ search: 'Hello WordPress' }).rows[0]
  assert.deepEqual(hello.meta.redirect_from, ['/2019/07/hello-wordpress/'])
  const about = q.posts.list({ search: 'About' }).rows[0]
  assert.deepEqual(about.meta.redirect_from, ['/about/'])
  // "?p=12" is not a path — nothing to redirect from
  const draft = q.posts.list({ search: 'Unfinished' }).rows[0]
  assert.equal(draft.meta.redirect_from, undefined)
})

test('the imported site builds and every old URL resolves', async () => {
  const { runBuild, buildState } = await import('../../server/build/runner.js')
  await runBuild('import')
  assert.equal(buildState.state, 'idle', buildState.error || '')

  assert.ok(existsSync(path.join(outputDir, 'blog', 'hello-wordpress.html')))
  assert.ok(existsSync(path.join(outputDir, 'about.html')))

  const stub = path.join(outputDir, '2019', '07', 'hello-wordpress', 'index.html')
  assert.ok(existsSync(stub), 'old post URL does not resolve')
  assert.match(readFileSync(stub, 'utf8'), /https:\/\/new\.example\/blog\/hello-wordpress\.html/)

  const page = readFileSync(path.join(outputDir, 'blog', 'hello-wordpress.html'), 'utf8')
  assert.match(page, /<img[^>]+src="\.\.\/uploads\//, 'the migrated image is not referenced relative in the built page')
  assert.match(page, /srcset="\.\.\/uploads\//, 'srcset URLs should be page-relative too')
})

test('rerunning the import does not duplicate content', async () => {
  const before = q.posts.list({ limit: 1 }).total
  await importer.importWxr(path.join(data.dir, 'export.xml'), { collection: 'blog' })
  assert.equal(q.posts.list({ limit: 1 }).total, before, 'a second run should update, not duplicate')
})
