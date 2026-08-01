// M4 — Media. Done when a JPEG upload produces variants on disk and in the DB
// row, the gallery serves it back, and an .svg or .html upload is rejected.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { tempDataDir, startApp } from './helpers.mjs'

let app, data, q, uploadsDir

const jpeg = () => sharp({ create: { width: 1200, height: 800, channels: 3, background: '#3366ff' } }).jpeg().toBuffer()

async function upload(buffer, filename, type) {
  const form = new FormData()
  form.append('file', new Blob([buffer], { type }), filename)
  return app.request('/admin/media/upload', { method: 'POST', body: form })
}

before(async () => {
  data = tempDataDir()
  uploadsDir = path.join(data.dir, 'uploads')
  q = await import('../../server/queries.js')
  const auth = await import('../../server/auth.js')
  q.users.create({ email: 'admin@example.com', password_hash: auth.hashPassword('pw'), role: 'admin' })
  app = await startApp()
  await app.form('/admin/login', { email: 'admin@example.com', password: 'pw' })
})
after(async () => {
  await app.close()
  data.cleanup()
})

test('a JPEG upload lands under a generated name with variants on disk and in the row', async () => {
  const res = await upload(await jpeg(), 'My Photo.jpg', 'image/jpeg')
  assert.equal(res.status, 302)

  const row = q.media.list().rows[0]
  assert.match(row.path, /^uploads\/[0-9a-f-]{36}\.jpg$/, 'stored under a generated name')
  assert.equal(row.original_name, 'My Photo.jpg', 'original name is display-only')
  assert.equal(row.mime_type, 'image/jpeg')
  assert.equal(row.width, 1200)
  assert.ok(existsSync(path.join(data.dir, row.path)))

  assert.ok(row.variants.length > 0, 'poops-images wrote no variants')
  for (const variant of row.variants) {
    assert.ok(existsSync(path.join(data.dir, variant.path)), `missing variant ${variant.path}`)
    assert.ok(variant.width > 0)
  }
  // poops discovers variants by the {name}-{width}w.{ext} convention
  assert.ok(readdirSync(uploadsDir).some((f) => /-\d+w\.webp$/.test(f)))
})

test('the uploaded file is served at the same /uploads path the build will use', async () => {
  const row = q.media.list().rows[0]
  const res = await app.request(`/${row.path}`)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
})

test('SVG and HTML uploads are rejected and leave nothing behind', async () => {
  const beforeFiles = readdirSync(uploadsDir).length
  const svg = await upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'x.svg', 'image/svg+xml')
  assert.equal(svg.status, 422)
  const html = await upload(Buffer.from('<html><script>alert(1)</script></html>'), 'x.html', 'text/html')
  assert.equal(html.status, 422)
  // a JPEG mime on a non-image body must not get through either
  const liar = await upload(Buffer.from('<html>not an image</html>'), 'liar.jpg', 'image/jpeg')
  assert.equal(liar.status, 422)
  assert.equal(readdirSync(uploadsDir).length, beforeFiles, 'rejected uploads left files behind')
  assert.equal(q.media.list().total, 1)
})

test('the picker partial lists media as insertable markdown paths', async () => {
  const res = await app.request('/admin/media/picker', { headers: { 'HX-Request': 'true' } })
  const html = await res.text()
  assert.ok(!html.includes('<!DOCTYPE html>'))
  assert.ok(html.includes('/uploads/'))
})

test('deleting media removes the row, the original and every variant', async () => {
  const row = q.media.list().rows[0]
  const files = [row.path, ...row.variants.map((v) => v.path)]
  const res = await app.form(`/admin/media/${row.id}/delete`, {})
  assert.equal(res.status, 302)
  assert.equal(q.media.get(row.id), undefined)
  for (const file of files) assert.equal(existsSync(path.join(data.dir, file)), false, `${file} survived`)
})

test('media paths that escape the uploads directory are refused', async () => {
  const evil = q.media.create({
    original_name: 'evil', path: '../../etc/passwd', mime_type: 'image/jpeg', size_bytes: 1
  })
  const res = await app.form(`/admin/media/${evil.id}/delete`, {})
  assert.equal(res.status, 422)
})
