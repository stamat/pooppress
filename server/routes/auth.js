import { Router } from 'express'
import { login, issueSession, clearSession, rateLimit, recordFailure, clearFailures } from '../auth.js'

// One message for every failure mode — a different string for "unknown email"
// is a user enumeration oracle.
const GENERIC_ERROR = 'Wrong email or password.'

export function authRoutes() {
  const router = Router()

  router.get('/admin/login', (req, res) => {
    if (req.user) return res.redirect('/admin')
    res.render('login.html', { page: { title: 'Log in' }, next: req.query.next })
  })

  router.post('/admin/login', (req, res) => {
    const result = attempt(req, res)
    if (result.limited) return res.status(429).render('login.html', { page: { title: 'Log in' }, error: 'Too many attempts. Try again in 15 minutes.' })
    if (!result.user) return res.status(401).render('login.html', { page: { title: 'Log in' }, error: GENERIC_ERROR })
    const next = typeof req.body.next === 'string' && req.body.next.startsWith('/admin') ? req.body.next : '/admin'
    res.redirect(next)
  })

  router.post('/api/auth/login', (req, res) => {
    const result = attempt(req, res)
    if (result.limited) return res.status(429).json({ error: 'too many attempts' })
    if (!result.user) return res.status(401).json({ error: GENERIC_ERROR })
    res.json({ id: result.user.id, email: result.user.email, role: result.user.role, display_name: result.user.display_name })
  })

  router.post('/admin/logout', (req, res) => {
    clearSession(req, res)
    res.redirect('/admin/login')
  })

  router.post('/api/auth/logout', (req, res) => {
    clearSession(req, res)
    res.json({ ok: true })
  })

  router.get('/api/auth/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' })
    res.json(req.user)
  })

  return router
}

function attempt(req, res) {
  const email = String(req.body.email || '')
  const key = `${req.ip}|${email.toLowerCase().trim()}`
  if (rateLimit(key).limited) return { limited: true }

  const user = login(email, String(req.body.password || ''))
  if (!user) {
    recordFailure(key)
    return { user: null }
  }
  clearFailures(key)
  issueSession(res, user, req.secure)
  return { user }
}
