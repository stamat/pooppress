import { Router } from 'express'
import { posts, collections } from '../queries.js'
import { requireSlug, requireOneOf, toTimestamp, metaFromForm, ValidationError } from '../validate.js'
import { requestBuild } from '../build/runner.js'
import { nowSql } from '../db.js'

const STATUSES = ['draft', 'review', 'published', 'archived']
const isHtmx = (req) => req.get('HX-Request') === 'true'

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
  const result = posts.list({ search, status, collection_id, page, limit: 20 })
  return {
    ...result,
    query: { search, status, collection_id, page: Number(page) },
    collections: collections.all(),
    statuses: STATUSES
  }
}

function editorView(post, extra = {}) {
  return {
    page: { title: post?.id ? `Edit: ${post.title || 'untitled'}` : 'New post', nav: 'posts' },
    post: post || { status: 'draft', meta: {}, body_markdown: '', title: '', slug: '', collection_id: null },
    collections: collections.all(),
    statuses: STATUSES,
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

  router.get('/admin/posts/new', (req, res) => res.render('posts/edit.html', editorView(null)))

  router.get('/admin/posts/:id', (req, res, next) => {
    const post = posts.get(Number(req.params.id))
    if (!post) return next()
    res.render('posts/edit.html', editorView(post))
  })

  router.post('/admin/posts', (req, res) => {
    try {
      const fields = fieldsFromBody(req.body)
      const post = posts.create({ ...fields, author_id: req.user.id })
      rebuildIfPublic(post, 'post created')
      res.redirect(`/admin/posts/${post.id}`)
    } catch (err) {
      const error = asValidationError(err)
      if (!(error instanceof ValidationError)) throw error
      res.status(422).render('posts/edit.html', editorView({ ...req.body, meta: metaFromForm(req.body) }, { error: error.message }))
    }
  })

  router.post('/admin/posts/:id', (req, res, next) => {
    const existing = posts.get(Number(req.params.id))
    if (!existing) return next()
    try {
      // Autosave carries only the body and must never change status or build.
      const partial = req.body.autosave === '1'
      const fields = fieldsFromBody(req.body, { partial })
      if (partial) delete fields.status
      const post = posts.update(existing.id, { ...existing, ...fields })
      if (!partial) rebuildIfPublic(post, 'post updated')
      if (partial) return res.status(204).end()
      if (isHtmx(req)) return res.status(204).set('HX-Redirect', `/admin/posts/${post.id}`).end()
      res.redirect(`/admin/posts/${post.id}`)
    } catch (err) {
      const error = asValidationError(err)
      if (!(error instanceof ValidationError)) throw error
      res.status(422).render('posts/edit.html', editorView({ ...existing, ...req.body, meta: metaFromForm(req.body) }, { error: error.message }))
    }
  })

  router.post('/admin/posts/:id/publish', (req, res, next) => {
    const post = posts.get(Number(req.params.id))
    if (!post) return next()
    const published = posts.setStatus(post.id, 'published', post.published_at || nowSql())
    requestBuild('post published')
    res.redirect(`/admin/posts/${published.id}`)
  })

  router.post('/admin/posts/:id/unpublish', (req, res, next) => {
    const post = posts.get(Number(req.params.id))
    if (!post) return next()
    posts.setStatus(post.id, 'draft', post.published_at)
    requestBuild('post unpublished')
    res.redirect(`/admin/posts/${post.id}`)
  })

  router.post('/admin/posts/:id/delete', (req, res, next) => {
    const post = posts.get(Number(req.params.id))
    if (!post) return next()
    posts.remove(post.id)
    rebuildIfPublic(post, 'post deleted')
    if (isHtmx(req)) return res.status(204).set('HX-Redirect', '/admin/posts').end()
    res.redirect('/admin/posts')
  })

  // --- JSON API ---------------------------------------------------------

  router.get('/api/posts', (req, res) => {
    const { search = '', status = '', collection_id = '', page = 1, limit = 20 } = req.query
    res.json(posts.list({ search, status, collection_id, page, limit: Math.min(Math.max(Number(limit) || 20, 1), 100) }))
  })

  router.get('/api/posts/:id', (req, res) => {
    const post = posts.get(Number(req.params.id))
    if (!post) return res.status(404).json({ error: 'not found' })
    res.json(post)
  })

  router.post('/api/posts', (req, res) => {
    try {
      const post = posts.create({ ...fieldsFromBody(req.body), author_id: req.user.id })
      rebuildIfPublic(post, 'post created')
      res.status(201).json(post)
    } catch (err) {
      throw asValidationError(err)
    }
  })

  router.put('/api/posts/:id', (req, res) => {
    const existing = posts.get(Number(req.params.id))
    if (!existing) return res.status(404).json({ error: 'not found' })
    try {
      const post = posts.update(existing.id, { ...existing, ...fieldsFromBody(req.body, { partial: true }) })
      if (post.status === 'published' || existing.status === 'published') requestBuild('post updated')
      res.json(post)
    } catch (err) {
      throw asValidationError(err)
    }
  })

  router.delete('/api/posts/:id', (req, res) => {
    const post = posts.get(Number(req.params.id))
    if (!post) return res.status(404).json({ error: 'not found' })
    posts.remove(post.id)
    rebuildIfPublic(post, 'post deleted')
    res.status(204).end()
  })

  router.post('/api/posts/:id/publish', (req, res) => {
    const post = posts.get(Number(req.params.id))
    if (!post) return res.status(404).json({ error: 'not found' })
    const published = posts.setStatus(post.id, 'published', post.published_at || nowSql())
    requestBuild('post published')
    res.json(published)
  })

  router.post('/api/posts/:id/unpublish', (req, res) => {
    const post = posts.get(Number(req.params.id))
    if (!post) return res.status(404).json({ error: 'not found' })
    const draft = posts.setStatus(post.id, 'draft', post.published_at)
    requestBuild('post unpublished')
    res.json(draft)
  })

  return router
}
