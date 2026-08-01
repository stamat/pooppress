import { Router } from 'express'
import { users, sessions } from '../queries.js'
import { hashPassword, requireAuth } from '../auth.js'
import { requireOneOf, ValidationError } from '../validate.js'

const ROLES = ['admin', 'editor', 'author']

const view = (extra = {}) => ({ page: { title: 'Users', nav: 'users' }, rows: users.all(), roles: ROLES, ...extra })

function validEmail(value) {
  const email = String(value || '').trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) throw new ValidationError('That does not look like an email address.', 'email')
  return email
}

function checkPassword(value) {
  const password = String(value || '')
  if (password.length < 8) throw new ValidationError('Passwords must be at least 8 characters.', 'password')
  return password
}

export function userRoutes() {
  const router = Router()
  const adminOnly = requireAuth('admin')

  router.get('/admin/users', adminOnly, (req, res) => res.render('users/list.html', view()))

  router.post('/admin/users', adminOnly, (req, res) => {
    try {
      users.create({
        email: validEmail(req.body.email),
        password_hash: hashPassword(checkPassword(req.body.password)),
        role: requireOneOf(String(req.body.role || 'author'), ROLES, 'role'),
        display_name: String(req.body.display_name || '').trim()
      })
      res.redirect('/admin/users')
    } catch (err) {
      res.status(422).render('users/list.html', view({ error: message(err), form: req.body }))
    }
  })

  router.post('/admin/users/:id', adminOnly, (req, res, next) => {
    const user = users.get(Number(req.params.id))
    if (!user) return next()
    try {
      if (req.body.email || req.body.role || req.body.display_name) {
        users.update(user.id, {
          email: req.body.email ? validEmail(req.body.email) : undefined,
          role: req.body.role ? requireOneOf(String(req.body.role), ROLES, 'role') : undefined,
          display_name: req.body.display_name
        })
      }
      if (req.body.password) {
        users.updatePassword(user.id, hashPassword(checkPassword(req.body.password)))
        // A password change revokes every other session for that user — the
        // point of changing it is that the old credential stops working.
        sessions.removeForUser(user.id)
      }
      res.redirect('/admin/users')
    } catch (err) {
      res.status(422).render('users/list.html', view({ error: message(err), form: req.body }))
    }
  })

  router.post('/admin/users/:id/delete', adminOnly, (req, res, next) => {
    const user = users.get(Number(req.params.id))
    if (!user) return next()
    if (user.role === 'admin' && users.all().filter((u) => u.role === 'admin').length === 1) {
      return res.status(422).render('users/list.html', view({ error: 'That is the last admin — promote someone else first.' }))
    }
    users.remove(user.id) // sessions cascade; posts keep their content, author goes null
    res.redirect('/admin/users')
  })

  router.get('/api/users', adminOnly, (req, res) => res.json(users.all().map(publicUser)))

  router.post('/api/users', adminOnly, (req, res) => {
    const user = users.create({
      email: validEmail(req.body.email),
      password_hash: hashPassword(checkPassword(req.body.password)),
      role: requireOneOf(String(req.body.role || 'author'), ROLES, 'role'),
      display_name: String(req.body.display_name || '').trim()
    })
    res.status(201).json(publicUser(user))
  })

  router.put('/api/users/:id', adminOnly, (req, res) => {
    const user = users.get(Number(req.params.id))
    if (!user) return res.status(404).json({ error: 'not found' })
    if (req.body.password) {
      users.updatePassword(user.id, hashPassword(checkPassword(req.body.password)))
      sessions.removeForUser(user.id)
    }
    const updated = users.update(user.id, {
      email: req.body.email ? validEmail(req.body.email) : undefined,
      role: req.body.role ? requireOneOf(String(req.body.role), ROLES, 'role') : undefined,
      display_name: req.body.display_name
    })
    res.json(publicUser(updated))
  })

  router.delete('/api/users/:id', adminOnly, (req, res) => {
    const user = users.get(Number(req.params.id))
    if (!user) return res.status(404).json({ error: 'not found' })
    if (user.role === 'admin' && users.all().filter((u) => u.role === 'admin').length === 1) {
      return res.status(422).json({ error: 'cannot delete the last admin' })
    }
    users.remove(user.id)
    res.status(204).end()
  })

  return router
}

const publicUser = ({ id, email, role, display_name, created_at }) => ({ id, email, role, display_name, created_at })

function message(err) {
  if (err instanceof ValidationError) return err.message
  if (String(err.code || '').startsWith('SQLITE_CONSTRAINT')) return 'That email is already registered.'
  throw err
}
