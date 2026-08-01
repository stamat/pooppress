import { Router } from 'express'
import { posts, collections } from '../queries.js'
import { requireSlug, requireOneOf, toTimestamp, metaFromForm, ValidationError } from '../validate.js'
import { requestBuild } from '../build/runner.js'
import { nowSql } from '../db.js'
import { canPublish } from '../auth.js'

const STATUSES = ['draft', 'review', 'published', 'archived']
// What an author can save. Published work is out of an author's hands — no
// status past review, and a post that IS published is read-only to its author.
const AUTHOR_STATUSES = ['draft', 'review']
const isHtmx = (req) => req.get('HX-Request') === 'true'

const deny = (req, res) => req.originalUrl.startsWith('/api')
  ? res.status(403).json({ error: 'forbidden' })
  : res.status(403).render('403.html', { page: { title: 'Forbidden' } })

// True when this user may touch this existing post at all.
const mayTouch = (user, post) => canPublish(user) || (post.author_id === user.id && AUTHOR_STATUSES.includes(post.status))

// Throws when an author tries to save a status they cannot reach.
function guardStatus (user, fields) {
  if (canPublish(user)) return
  if (fields.status !== undefined && !AUTHOR_STATUSES.includes(fields.status)) {
    throw new ValidationError('Authors save drafts or submit for review — publishing is an editor call.', 'status')
  }
}

// Anything already public that changes shape must be rebuilt; drafts never are.
function rebuildIfPublic(post, reason) {
  if (post && post.status === 'published') requestBuild(reason)
}

function fieldsFromBody(rawBody, { partial = false } = {}) {
  const body = rawBody || {} // a request with no parseable body is still a request
  const fields = {}
  if (body.title !== undefined) fields.title = String(body.title).slice(0, 255)
  if (body.slug !== undefined) fields.slug = requireSlug(body.slug)
  if (body.body_markdown !== undefined) fields.body_markdown = String(body.body_markdown)
  if (body.excerpt !== undefined) fields.excerpt = String(body.excerpt).trim() || null
  if (body.status !== undefined) fields.status = requireOneOf(String(body.status), STATUSES, 'status')
  if (body.published_at !== undefined) fields.published_at = toTimestamp(body.published_at)
  if (body.collection_id !== undefined) {
    const id = body.collection_id === '' || body.collection_id === null ? null : Number(body.collection_id)
    if (id !== null && !collections.get(id)) throw new ValidationError('Unknown collection.', 'collection_id')
    fields.collection_id = id
  }
  if (body.meta !== undefined) fields.meta = body.meta
  else if (body.meta_key !== undefined) fields.meta = metaFromForm(body)

  if (!partial) {
    if (fields.slug === undefined) fields.slug = requireSlug(body.slug)
    fields.title = fields.title ?? ''
    fields.body_markdown = fields.body_markdown ?? ''
  }
  return fields
}

// SQLite reports a duplicate slug as a constraint failure; that is a user
// error (422), not a 500.
function asValidationError(err) {
  if (String(err.code || '').startsWith('SQLITE_CONSTRAINT')) {
    return new ValidationError('That slug is already used in this collection.', 'slug')
  }
  return err
}

function listView(req) {
  const { search = '', status = '', collection_id = '', page = 1 } = req.query
  // Authors see only their own posts — enforced here, not hidden in the UI.
  const author_id = canPublish(req.user) ? undefined : req.user.id
  const result = posts.list({ search, status, collection_id, author_id, page, limit: 20 })
  return {
    ...result,
    query: { search, status, collection_id, page: Number(page) },
    collections: collections.all(),
    statuses: STATUSES
  }
}

function editorView(req, post, extra = {}) {
  return {
    page: { title: post?.id ? `Edit: ${post.title || 'untitled'}` : 'New post', nav: 'posts' },
    post: post || { status: 'draft', meta: {}, body_markdown: '', title: '', slug: '', collection_id: null },
    collections: collections.all(),
    statuses: canPublish(req.user) ? STATUSES : AUTHOR_STATUSES,
    canPublish: canPublish(req.user),
    ...extra
  }
}

export function postRoutes() {
  const router = Router()

  router.get('/admin/posts', (req, res) => {
    const view = listView(req)
    if (isHtmx(req)) return res.render('posts/_table.html', view)
    res.render('posts/list.html', { page: { title: 'Posts', nav: 'posts' }, ...view })
  })

  router.get('/admin/posts/new', (req, res) => res.render('posts/edit.html', editorView(req, null)))

  router.get('/admin/posts/:id', (req, res, next) => {
    const post = posts.get(Number(req.params.id))
    if (!post) return next()
    if (!canPublish(req.user) && post.author_id !== req.user.id) return deny(req, res)
    res.render('posts/edit.html', editorView(req, post))
  })

  router.post('/admin/posts', (req, res) => {
    try {
      const fields = fieldsFromBody(req.body)
      guardStatus(req.user, fields)
      const post = posts.create({ ...fields, author_id: req.user.id })
      rebuildIfPublic(post, 'post created')
      res.redirect(`/admin/posts/${post.id}`)
    } catch (err) {
      const error = asValidationError(err)
      if (!(error instanceof ValidationError)) throw error
      res.status(422).render('posts/edit.html', editorView(req, { ...req.body, meta: metaFromForm(req.body) }, { error: error.message }))
    }
  })

  router.post('/admin/posts/:id', (req, res, next) => {
    const existing = posts.get(Number(req.params.id))
    if (!existing) return next()
    if (!mayTouch(req.user, existing)) return deny(req, res)
    try {
      // Autosave carries only the body and must never change status or build.
      const partial = req.body.autosave === '1'
      const fields = fieldsFromBody(req.body, { partial })
      if (partial) delete fields.status
      guardStatus(req.user, fields)
      const post = posts.update(existing.id, { ...existing, ...fields })
      if (!partial) rebuildIfPublic(post, 'post updated')
      if (partial) return res.status(204).end()
      if (isHtmx(req)) return res.status(204).set('HX-Redirect', `/admin/posts/${post.id}`).end()
      res.redirect(`/admin/posts/${post.id}`)
    } catch (err) {
      const error = asValidationError(err)
      if (!(error instanceof ValidationError)) throw error
      res.status(422).render('posts/edit.html', editorView(req, { ...existing, ...req.body, meta: metaFromForm(req.body) }, { error: error.message }))
    }
  })

  router.post('/admin/posts/:id/publish', (req, res, next) => {
    const post = posts.get(Number(req.params.id))
    if (!post) return next()
    if (!canPublish(req.user)) return deny(req, res)
    const published = posts.setStatus(post.id, 'published', post.published_at || nowSql())
    requestBuild('post published')
    res.redirect(`/admin/posts/${published.id}`)
  })

  router.post('/admin/posts/:id/unpublish', (req, res, next) => {
    const post = posts.get(Number(req.params.id))
    if (!post) return next()
    if (!canPublish(req.user)) return deny(req, res)
    posts.setStatus(post.id, 'draft', post.published_at)
    requestBuild('post unpublished')
    res.redirect(`/admin/posts/${post.id}`)
  })

  router.post('/admin/posts/:id/preview', async (req, res, next) => {
    const post = posts.get(Number(req.params.id))
    if (!post) return next()
    // Authors preview their own work — that's how "submit for review" gets
    // eyeballs on it — but only their own.
    if (!canPublish(req.user) && post.author_id !== req.user.id) return deny(req, res)
    try {
      const { token, page } = await import('../build/bridge.js').then((m) => m.buildPreview(post.id))
      res.redirect(`/preview/${token}/${page}`)
    } catch (err) {
      res.status(500).render('error.html', { page: { title: 'Preview failed' }, error: err.message })
    }
  })

  router.post('/admin/posts/:id/delete', (req, res, next) => {
    const post = posts.get(Number(req.params.id))
    if (!post) return next()
    if (!mayTouch(req.user, post)) return deny(req, res)
    posts.remove(post.id)
    rebuildIfPublic(post, 'post deleted')
    if (isHtmx(req)) return res.status(204).set('HX-Redirect', '/admin/posts').end()
    res.redirect('/admin/posts')
  })

  // --- JSON API ---------------------------------------------------------

  router.get('/api/posts', (req, res) => {
    const { search = '', status = '', collection_id = '', page = 1, limit = 20 } = req.query
    const author_id = canPublish(req.user) ? undefined : req.user.id
    res.json(posts.list({ search, status, collection_id, author_id, page, limit: Math.min(Math.max(Number(limit) || 20, 1), 100) }))
  })

  router.get('/api/posts/:id', (req, res) => {
    const post = posts.get(Number(req.params.id))
    if (!post) return res.status(404).json({ error: 'not found' })
    if (!canPublish(req.user) && post.author_id !== req.user.id) return deny(req, res)
    res.json(post)
  })

  router.post('/api/posts', (req, res) => {
    try {
      const fields = fieldsFromBody(req.body)
      guardStatus(req.user, fields)
      const post = posts.create({ ...fields, author_id: req.user.id })
      rebuildIfPublic(post, 'post created')
      res.status(201).json(post)
    } catch (err) {
      throw asValidationError(err)
    }
  })

  router.put('/api/posts/:id', (req, res) => {
    const existing = posts.get(Number(req.params.id))
    if (!existing) return res.status(404).json({ error: 'not found' })
    if (!mayTouch(req.user, existing)) return deny(req, res)
    try {
      const fields = fieldsFromBody(req.body, { partial: true })
      guardStatus(req.user, fields)
      const post = posts.update(existing.id, { ...existing, ...fields })
      if (post.status === 'published' || existing.status === 'published') requestBuild('post updated')
      res.json(post)
    } catch (err) {
      throw asValidationError(err)
    }
  })

  router.delete('/api/posts/:id', (req, res) => {
    const post = posts.get(Number(req.params.id))
    if (!post) return res.status(404).json({ error: 'not found' })
    if (!mayTouch(req.user, post)) return deny(req, res)
    posts.remove(post.id)
    rebuildIfPublic(post, 'post deleted')
    res.status(204).end()
  })

  router.post('/api/posts/:id/publish', (req, res) => {
    const post = posts.get(Number(req.params.id))
    if (!post) return res.status(404).json({ error: 'not found' })
    if (!canPublish(req.user)) return deny(req, res)
    const published = posts.setStatus(post.id, 'published', post.published_at || nowSql())
    requestBuild('post published')
    res.json(published)
  })

  router.post('/api/posts/:id/unpublish', (req, res) => {
    const post = posts.get(Number(req.params.id))
    if (!post) return res.status(404).json({ error: 'not found' })
    if (!canPublish(req.user)) return deny(req, res)
    const draft = posts.setStatus(post.id, 'draft', post.published_at)
    requestBuild('post unpublished')
    res.json(draft)
  })

  return router
}
