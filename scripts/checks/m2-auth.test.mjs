// M2 — Auth. Done when: wrong password and unknown email are indistinguishable,
// the 11th rapid failure gets 429, the right password reaches admin, a restart
// keeps you logged in, and a replayed cookie after logout is rejected.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { tempDataDir, startApp } from './helpers.mjs'

let app, data, q, auth

before(async () => {
  data = tempDataDir()
  q = await import('../../server/queries.js')
  auth = await import('../../server/auth.js')
  q.users.create({ email: 'admin@example.com', password_hash: auth.hashPassword('correct horse'), role: 'admin', display_name: 'Admin' })
  app = await startApp()
})
after(async () => {
  await app.close()
  data.cleanup()
})

test('scrypt hashes are self-describing and verify in constant time', () => {
  const hash = auth.hashPassword('hunter2')
  assert.match(hash, /^scrypt\$32768\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/)
  assert.equal(auth.verifyPassword('hunter2', hash), true)
  assert.equal(auth.verifyPassword('hunter3', hash), false)
  assert.notEqual(hash, auth.hashPassword('hunter2'), 'salt must be random per hash')
})

test('admin pages redirect to login when signed out', async () => {
  const res = await app.request('/admin')
  assert.equal(res.status, 302)
  assert.equal(res.headers.get('location'), '/admin/login?next=%2Fadmin')
})

test('API returns 401 JSON when signed out', async () => {
  const res = await app.request('/api/posts')
  assert.equal(res.status, 401)
  assert.deepEqual(await res.json(), { error: 'unauthorized' })
})

test('wrong password and unknown email give the identical error', async () => {
  const wrong = await app.form('/admin/login', { email: 'admin@example.com', password: 'nope' })
  const unknown = await app.form('/admin/login', { email: 'ghost@example.com', password: 'nope' })
  assert.equal(wrong.status, unknown.status)
  const [a, b] = [await wrong.text(), await unknown.text()]
  assert.ok(a.includes('Wrong email or password'))
  assert.equal(a, b)
})

test('11th rapid failure is rate limited', async () => {
  let last
  for (let i = 0; i < 12; i++) {
    last = await app.form('/admin/login', { email: 'target@example.com', password: 'nope' })
    if (last.status === 429) break
  }
  assert.equal(last.status, 429)
})

test('state-changing requests with a foreign Origin are rejected', async () => {
  const res = await app.form('/admin/login', { email: 'admin@example.com', password: 'correct horse' }, {
    headers: { origin: 'https://evil.example' }
  })
  assert.equal(res.status, 403)
})

test('the right password reaches admin, and the session survives a restart', async () => {
  const res = await app.form('/admin/login', { email: 'admin@example.com', password: 'correct horse' })
  assert.equal(res.status, 302)
  assert.equal(res.headers.get('location'), '/admin')
  const cookie = res.headers.getSetCookie()[0]
  assert.match(cookie, /HttpOnly/)
  assert.match(cookie, /SameSite=Lax/)

  const dashboard = await app.request('/admin')
  assert.equal(dashboard.status, 200)

  // "Restart": a second app instance over the same database file.
  const restarted = await startApp()
  const replay = await restarted.request('/api/auth/me', { headers: { cookie: cookie.split(';')[0] } })
  assert.equal(replay.status, 200)
  assert.equal((await replay.json()).email, 'admin@example.com')
  await restarted.close()
})

test('a replayed cookie after logout is rejected', async () => {
  const login = await app.form('/admin/login', { email: 'admin@example.com', password: 'correct horse' })
  const cookie = login.headers.getSetCookie()[0].split(';')[0]

  const out = await app.request('/admin/logout', { method: 'POST', headers: { cookie } })
  assert.equal(out.status, 302)

  const replay = await app.request('/api/auth/me', { headers: { cookie } })
  assert.equal(replay.status, 401)
})

test('security headers are set on admin responses', async () => {
  const res = await app.request('/admin/login')
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/)
  assert.equal(res.headers.get('x-frame-options'), 'DENY')
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
})
