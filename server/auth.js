import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto'
import { users, sessions } from './queries.js'

// Pinned scrypt params, stored self-describing so they can be raised later
// without a flag day.
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, saltlen: 16 }
const SESSION_DAYS = 14
const COOKIE = 'pooppress_session'

export function hashPassword(password, salt = randomBytes(SCRYPT.saltlen)) {
  const key = scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 256 * 1024 * 1024 })
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('hex')}$${key.toString('hex')}`
}

export function verifyPassword(password, stored) {
  const [scheme, N, r, p, salt, key] = String(stored).split('$')
  if (scheme !== 'scrypt') return false
  const expected = Buffer.from(key, 'hex')
  const actual = scryptSync(password, Buffer.from(salt, 'hex'), expected.length,
    { N: Number(N), r: Number(r), p: Number(p), maxmem: 256 * 1024 * 1024 })
  return timingSafeEqual(expected, actual)
}

// Unknown emails hash this so response timing can't enumerate users.
const DUMMY_HASH = hashPassword('dummy-password-for-timing-parity')

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const expiryFrom = (date) => new Date(date.getTime() + SESSION_DAYS * 86400_000).toISOString().slice(0, 19).replace('T', ' ')

export function login(email, password) {
  const user = users.byEmail(email)
  if (!user) {
    verifyPassword(password, DUMMY_HASH)
    return null
  }
  if (!verifyPassword(password, user.password_hash)) return null
  sessions.purgeExpired()
  return user
}

export function issueSession(res, user, secure) {
  const token = randomBytes(32).toString('hex')
  sessions.create(sha256(token), user.id, expiryFrom(new Date()))
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: SESSION_DAYS * 86400_000
  })
  return token
}

export function clearSession(req, res) {
  const token = req.cookies?.[COOKIE]
  if (token) sessions.remove(sha256(token))
  res.clearCookie(COOKIE, { path: '/' })
}

// Populates req.user from the session cookie, sliding the expiry. Runs before
// every route so templates and API handlers see the same user.
export function sessionMiddleware(req, res, next) {
  req.cookies = parseCookies(req.headers.cookie)
  const token = req.cookies[COOKIE]
  if (token) {
    const session = sessions.getWithUser(sha256(token))
    if (session) {
      req.user = { id: session.id, email: session.email, role: session.role, display_name: session.display_name }
      sessions.touch(session.token_hash, expiryFrom(new Date()))
    }
  }
  res.locals.user = req.user
  next()
}

function parseCookies(header) {
  const out = {}
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim())
  }
  return out
}

const ROLES = { admin: 3, editor: 2, author: 1 }

// requireAuth() guards a page; requireAuth('editor') also demands a role rank.
// API paths get JSON, admin pages get a redirect back to where they were going.
export function requireAuth(minRole = 'author') {
  return (req, res, next) => {
    if (!req.user) {
      if (req.path.startsWith('/api') || req.originalUrl.startsWith('/api')) return res.status(401).json({ error: 'unauthorized' })
      return res.redirect(`/admin/login?next=${encodeURIComponent(req.originalUrl)}`)
    }
    // ?? 0: an unknown role must rank below everything, not skate past on NaN
    if ((ROLES[req.user.role] ?? 0) < ROLES[minRole]) {
      if (req.originalUrl.startsWith('/api')) return res.status(403).json({ error: 'forbidden' })
      return res.status(403).render('403.html', { page: { title: 'Forbidden' } })
    }
    next()
  }
}

// CSRF layer two (SameSite=Lax is layer one): a state-changing request whose
// Origin disagrees with ours is refused. No token machinery.
// Corollary, enforced in review: GET handlers never mutate.
export function originCheck(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next()
  const origin = req.get('origin')
  if (origin) {
    const expected = `${req.protocol}://${req.get('host')}`
    if (origin !== expected) return res.status(403).json({ error: 'bad origin' })
  } else if (req.get('sec-fetch-site') && req.get('sec-fetch-site') !== 'same-origin') {
    return res.status(403).json({ error: 'bad origin' })
  }
  next()
}

// 10 failures / 15 min / IP+email, fixed window in process memory.
// Documented ceiling: under Passenger this is per worker, so N workers allow
// N × the rate. Move to a SQLite table if distributed abuse ever shows up.
const attempts = new Map()
const WINDOW_MS = 15 * 60 * 1000
const MAX_ATTEMPTS = 10

export function rateLimit(key) {
  const now = Date.now()
  const entry = attempts.get(key)
  if (!entry || now - entry.start > WINDOW_MS) {
    attempts.set(key, { start: now, count: 0 })
    return { limited: false }
  }
  return { limited: entry.count >= MAX_ATTEMPTS }
}

export function recordFailure(key) {
  const now = Date.now()
  // Sweep lapsed windows here or the map grows one entry per ip|email forever.
  for (const [k, v] of attempts) if (now - v.start > WINDOW_MS) attempts.delete(k)
  const entry = attempts.get(key) || { start: now, count: 0 }
  entry.count++
  attempts.set(key, entry)
}

export function clearFailures(key) {
  attempts.delete(key)
}

export const SESSION_COOKIE = COOKIE
