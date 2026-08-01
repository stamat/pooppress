// M0 — Scaffold. Done when the server boots and serves a Tailwind-styled
// admin shell plus a health endpoint.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { tempDataDir, startApp } from './helpers.mjs'

let app, data

before(async () => {
  data = tempDataDir()
  app = await startApp()
})
after(async () => {
  await app.close()
  data.cleanup()
})

test('GET /api/health returns ok', async () => {
  const res = await app.request('/api/health')
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: true })
})

test('admin assets are served from admin/dist', async () => {
  const res = await app.request('/admin/assets/styles/tailwind.css')
  assert.equal(res.status, 200)
  const css = await res.text()
  assert.ok(css.length > 0, 'compiled tailwind css is empty — run npm run admin:build')
})

test('unknown API route answers JSON, not an HTML page', async () => {
  const res = await app.request('/api/nope')
  assert.ok(res.status >= 400)
  assert.equal(res.headers.get('content-type')?.split(';')[0], 'application/json')
})
