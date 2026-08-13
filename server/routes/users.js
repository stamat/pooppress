import { Router } from 'express'
import { users, sessions } from '../queries.js'
import { hashPassword, requireAuth } from '../auth.js'
import { requireOneOf, ValidationError } from '../validate.js'
import { store } from '../db.js'

const ROLES = ['admin', 'editor', 'author']

// Store reads are shaped to declared fields, so the rows reaching the template
// carry no password_hash. ponytail: the 10k limit outlives any admin screen —
// paginate the day a site has that many accounts.
const allUsers = (req) => store.users.list({ user: req.user, sort: 'display_name', order: 'asc', limit: 10000 })

const view = (req, extra = {}) => ({ page: { title: 'Users', nav: 'users' }, rows: allUsers(req), roles: ROLES, ...extra })

function validEmail(value) {
  const email = String(value || '').trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) throw new ValidationError('That does not look like an email address.', 'email')
  return email
}

// A store update without `partial` is the whole row: what the body does not
// carry comes off the stored user, so an edit of one field leaves the rest
// standing and the required email is always present. An empty display_name is
// kept as '' rather than dropped — clearing it is a thing an admin may do, and
// the column is NOT NULL.
function userFields (stored, body) {
  const fields = { ...stored }
  if (body.email) fields.email = validEmail(body.email)
  if (body.role) fields.role = requireOneOf(String(body.role), ROLES, 'role')
  if (body.display_name !== undefined) fields.display_name = String(body.display_name).trim()
  return fields
}

function checkPassword(value) {
  const password = String(value || '')
  if (password.length < 8) throw new ValidationError('Passwords must be at least 8 characters.', 'password')
  return password
}

export function userRoutes() {
  const router = Router()
  const adminOnly = requireAuth('admin')

  router.get('/admin/users', adminOnly, (req, res) => res.render('users/list.html', view(req)))

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
      res.status(422).render('users/list.html', view(req, { error: message(err), form: req.body }))
    }
  })

  router.post('/admin/users/:id', adminOnly, (req, res) => {
    const user = store.users.get(Number(req.params.id), { user: req.user })
    try {
      // display_name tested for presence, not truth: '' is how the form clears
      // it, and the falsy test skipped the save that would have.
      if (req.body.email || req.body.role || req.body.display_name !== undefined) {
        store.users.update(user.id, userFields(user, req.body), { user: req.user })
      }
      if (req.body.password) {
        users.updatePassword(user.id, hashPassword(checkPassword(req.body.password)))
        // A password change revokes every other session for that user — the
        // point of changing it is that the old credential stops working.
        sessions.removeForUser(user.id)
      }
      res.redirect('/admin/users')
    } catch (err) {
      res.status(422).render('users/list.html', view(req, { error: message(err), form: req.body }))
    }
  })

  router.post('/admin/users/:id/delete', adminOnly, (req, res) => {
    const user = store.users.get(Number(req.params.id), { user: req.user })
    if (user.role === 'admin' && store.users.count({ user: req.user, where: { role: 'admin' } }) === 1) {
      return res.status(422).render('users/list.html', view(req, { error: 'That is the last admin — promote someone else first.' }))
    }
    store.users.remove(user.id, { user: req.user }) // sessions cascade; posts keep their content, author goes null
    res.redirect('/admin/users')
  })

  router.get('/api/users', adminOnly, (req, res) => res.json(allUsers(req).map(publicUser)))

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
    const user = store.users.get(Number(req.params.id), { user: req.user })
    if (req.body.password) {
      users.updatePassword(user.id, hashPassword(checkPassword(req.body.password)))
      sessions.removeForUser(user.id)
    }
    const updated = store.users.update(user.id, userFields(user, req.body), { user: req.user })
    res.json(publicUser(updated))
  })

  router.delete('/api/users/:id', adminOnly, (req, res) => {
    const user = store.users.get(Number(req.params.id), { user: req.user })
    if (user.role === 'admin' && store.users.count({ user: req.user, where: { role: 'admin' } }) === 1) {
      return res.status(422).json({ error: 'cannot delete the last admin' })
    }
    store.users.remove(user.id, { user: req.user })
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
