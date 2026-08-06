// Shared helpers for milestone checks. Each check boots the real app on an
// ephemeral port against a throwaway data dir, so checks never touch data/.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function tempDataDir() {
  const dir = mkdtempSync(join(tmpdir(), 'pooppress-check-'))
  process.env.POOPPRESS_DATA = dir
  process.env.POOPPRESS_ROOT = dir // output/ and themes/ land here too
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

// Data seeding for checks: the septic store under SYSTEM authority. Seeded
// published_at timestamps get their Z back via isoUtc — a bare
// "YYYY-MM-DD HH:MM:SS" would shift through the store's local-time parse and
// make a check pass or fail with the machine's timezone.
export async function seed() {
  const { store, SYSTEM } = await import('../../server/db.js')
  const { isoUtc } = await import('../../server/validate.js')
  return {
    store,
    SYSTEM,
    post: (f) => store.posts.create({ ...f, published_at: isoUtc(f.published_at) }, { user: SYSTEM }),
    collection: (f) => store.collections.create(f, { user: SYSTEM }),
    media: (f) => store.media.create(f, { user: SYSTEM })
  }
}

// Boots the app on port 0 and returns { url, close, cookieFetch }.
export async function startApp() {
  const { createApp } = await import('../../server/index.js')
  const app = createApp()
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  const url = `http://127.0.0.1:${server.address().port}`

  // A one-cookie jar — enough for a session cookie, no dependency.
  let cookie = null
  const request = async (path, options = {}) => {
    const headers = { ...options.headers }
    if (cookie) headers.cookie = cookie
    if (options.method && options.method !== 'GET' && !headers.origin) headers.origin = url
    const res = await fetch(url + path, { ...options, headers, redirect: 'manual' })
    const setCookie = res.headers.getSetCookie?.()[0] || res.headers.get('set-cookie')
    if (setCookie) cookie = setCookie.split(';')[0]
    return res
  }

  return {
    url,
    request,
    form: (path, fields, options = {}) => {
      // Repeated keys (meta_key/meta_value rows) must stay repeated, not join
      // into "a,b" — that is what URLSearchParams(object) would do.
      const body = new URLSearchParams()
      for (const [key, value] of Object.entries(fields)) {
        for (const item of [].concat(value)) body.append(key, item)
      }
      return request(path, {
        ...options,
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', ...options.headers },
        body: body.toString()
      })
    },
    json: (path, body, options = {}) => request(path, {
      method: options.method || 'POST',
      headers: { 'content-type': 'application/json', ...options.headers },
      body: JSON.stringify(body)
    }),
    clearCookie: () => { cookie = null },
    close: () => new Promise((resolve) => server.close(resolve))
  }
}
