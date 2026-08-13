import { Router } from 'express'
import { ConflictError } from 'septic'
import { posts, collections } from '../queries.js'
import { requireSlug, requireOneOf, toTimestamp, isoUtc, metaFromForm, termList, TAXONOMIES, ValidationError } from '../validate.js'
import { requestBuild } from '../build/runner.js'
import { store, nowSql } from '../db.js'
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

// Publishing keeps an existing timestamp — by not resending it, since a store
// round trip would shift it — and stamps a fresh ISO-Z one otherwise.
const publishFields = (post) => post.published_at
  ? { status: 'published' }
  : { status: 'published', published_at: new Date().toISOString() }

// What a store create takes: same fields, timestamp carrying its Z.
const forStore = (fields) => fields.published_at
  ? { ...fields, published_at: isoUtc(fields.published_at) }
  : fields

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

  // The edit form's featured-image control posts outside the meta rows but the
  // value lives in the meta column (same key the WXR import writes).
  if (body.featured_image !== undefined) {
    const meta = { ...(fields.meta || {}) }
    const src = String(body.featured_image).trim()
    if (src) meta.featured_image = src
    else delete meta.featured_image
    fields.meta = meta
  }

  // Same deal for the taxonomy fields: their own form controls, but the value
  // lives in meta, which is what puts them in front matter for poops to group on.
  for (const { field } of TAXONOMIES) {
    if (body[field] === undefined) continue
    const meta = { ...(fields.meta || {}) }
    const terms = termList(body[field])
    if (terms.length) meta[field] = terms
    else delete meta[field]
    fields.meta = meta
  }

  if (!partial) {
    if (fields.slug === undefined) fields.slug = requireSlug(body.slug)
    fields.title = fields.title ?? ''
    fields.body_markdown = fields.body_markdown ?? ''
  }
  return fields
}

// A constraint failure is a user error (422), not a 500. It arrives as septic's
// ConflictError — 409 for a duplicate, 422 for a dangling reference — from
// every write now that they all go through the store. The raw-SQLite branch
// below stays for the constraints septic does not map: the CHECK on status is
// the one this schema has.
function asValidationError(err) {
  if (err instanceof ConflictError) {
    return err.status === 409
      ? new ValidationError('That slug is already used in this collection.', 'slug')
      : new ValidationError('Unknown collection.', 'collection_id')
  }
  if (String(err.code || '').startsWith('SQLITE_CONSTRAINT')) {
    return new ValidationError('That slug is already used in this collection.', 'slug')
  }
  return err
}

// The taxonomy filter travels as one "field:term" param so it fits one <select>
// (and one pagination link) the way status and collection already do. An
// unknown field drops the filter rather than erroring — it can only come from
// a hand-edited URL, and "everything" is the honest answer to a meaningless one.
function termFilter(value) {
  const [field, ...rest] = String(value || '').split(':')
  const term = rest.join(':')
  if (!term || !TAXONOMIES.some((tax) => tax.field === field)) return {}
  return { taxonomy: field, term }
}

// The list's Terms column: every term on a post, flattened across taxonomies,
// each carrying the filter value that shows the rest of its term.
function rowTerms(post) {
  return TAXONOMIES.flatMap((tax) => termList(post.meta?.[tax.field])
    .map((term) => ({ term, filter: `${tax.field}:${term}` })))
}

function listView(req) {
  const { search = '', status = '', collection_id = '', term = '', page = 1 } = req.query
  // Authors see only their own posts — enforced here, not hidden in the UI.
  const author_id = canPublish(req.user) ? undefined : req.user.id
  const result = posts.list({ search, status, collection_id, author_id, page, limit: 20, ...termFilter(term) })
  return {
    ...result,
    rows: result.rows.map((post) => ({ ...post, terms: rowTerms(post) })),
    query: { search, status, collection_id, term, page: Number(page) },
    collections: collections.all(),
    taxonomies: TAXONOMIES.map((tax) => ({ ...tax, known: posts.terms(tax.field) })),
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
    // `value` falls back to the raw body field so a 422 re-render doesn't drop
    // what the user typed — on that path meta hasn't been rebuilt yet.
    taxonomies: TAXONOMIES.map((tax) => ({
      ...tax,
      known: posts.terms(tax.field),
      value: termList(post?.meta?.[tax.field] ?? post?.[tax.field]).join(', ')
    })),
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

  router.get('/admin/posts/:id', (req, res) => {
    const post = store.posts.get(Number(req.params.id), { user: req.user })
    if (!canPublish(req.user) && post.author_id !== req.user.id) return deny(req, res)
    res.render('posts/edit.html', editorView(req, post))
  })

  router.post('/admin/posts', (req, res) => {
    try {
      const fields = fieldsFromBody(req.body)
      guardStatus(req.user, fields)
      const post = store.posts.create(forStore({ ...fields, author_id: req.user.id }), { user: req.user })
      rebuildIfPublic(post, 'post created')
      res.redirect(`/admin/posts/${post.id}`)
    } catch (err) {
      const error = asValidationError(err)
      if (!(error instanceof ValidationError)) throw error
      res.status(422).render('posts/edit.html', editorView(req, { ...req.body, meta: metaFromForm(req.body) }, { error: error.message }))
    }
  })

  router.post('/admin/posts/:id', (req, res) => {
    const existing = store.posts.get(Number(req.params.id), { user: req.user })
    if (!mayTouch(req.user, existing)) return deny(req, res)
    try {
      // Autosave carries only the body and must never change status or build.
      const partial = req.body.autosave === '1'
      const fields = fieldsFromBody(req.body, { partial })
      if (partial) delete fields.status
      guardStatus(req.user, fields)
      const post = store.posts.update(existing.id, { ...existing, ...fields }, { user: req.user })
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

  router.post('/admin/posts/:id/publish', (req, res) => {
    const post = store.posts.get(Number(req.params.id), { user: req.user })
    if (!canPublish(req.user)) return deny(req, res)
    const published = store.posts.update(post.id, publishFields(post), { user: req.user, partial: true })
    requestBuild('post published')
    res.redirect(`/admin/posts/${published.id}`)
  })

  router.post('/admin/posts/:id/unpublish', (req, res) => {
    const post = store.posts.get(Number(req.params.id), { user: req.user })
    if (!canPublish(req.user)) return deny(req, res)
    // Only status: published_at is not resent, so the schedule survives the
    // unpublish, as before.
    store.posts.update(post.id, { status: 'draft' }, { user: req.user, partial: true })
    requestBuild('post unpublished')
    res.redirect(`/admin/posts/${post.id}`)
  })

  router.post('/admin/posts/:id/preview', async (req, res) => {
    const post = store.posts.get(Number(req.params.id), { user: req.user })
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

  router.post('/admin/posts/:id/delete', (req, res) => {
    const post = store.posts.get(Number(req.params.id), { user: req.user })
    if (!mayTouch(req.user, post)) return deny(req, res)
    store.posts.remove(post.id, { user: req.user })
    rebuildIfPublic(post, 'post deleted')
    if (isHtmx(req)) return res.status(204).set('HX-Redirect', '/admin/posts').end()
    res.redirect('/admin/posts')
  })

  // --- JSON API ---------------------------------------------------------

  router.get('/api/posts', (req, res) => {
    const { search = '', status = '', collection_id = '', term = '', page = 1, limit = 20 } = req.query
    const author_id = canPublish(req.user) ? undefined : req.user.id
    res.json(posts.list({ search, status, collection_id, author_id, page, ...termFilter(term), limit: Math.min(Math.max(Number(limit) || 20, 1), 100) }))
  })

  router.get('/api/posts/:id', (req, res) => {
    const post = store.posts.get(Number(req.params.id), { user: req.user })
    if (!canPublish(req.user) && post.author_id !== req.user.id) return deny(req, res)
    res.json(post)
  })

  router.post('/api/posts', (req, res) => {
    try {
      const fields = fieldsFromBody(req.body)
      guardStatus(req.user, fields)
      const post = store.posts.create(forStore({ ...fields, author_id: req.user.id }), { user: req.user })
      rebuildIfPublic(post, 'post created')
      res.status(201).json(post)
    } catch (err) {
      throw asValidationError(err)
    }
  })

  router.put('/api/posts/:id', (req, res) => {
    const existing = store.posts.get(Number(req.params.id), { user: req.user })
    if (!mayTouch(req.user, existing)) return deny(req, res)
    try {
      const fields = fieldsFromBody(req.body, { partial: true })
      guardStatus(req.user, fields)
      const post = store.posts.update(existing.id, { ...existing, ...fields }, { user: req.user })
      if (post.status === 'published' || existing.status === 'published') requestBuild('post updated')
      res.json(post)
    } catch (err) {
      throw asValidationError(err)
    }
  })

  router.delete('/api/posts/:id', (req, res) => {
    const post = store.posts.get(Number(req.params.id), { user: req.user })
    if (!mayTouch(req.user, post)) return deny(req, res)
    store.posts.remove(post.id, { user: req.user })
    rebuildIfPublic(post, 'post deleted')
    res.status(204).end()
  })

  router.post('/api/posts/:id/publish', (req, res) => {
    const post = store.posts.get(Number(req.params.id), { user: req.user })
    if (!canPublish(req.user)) return deny(req, res)
    const published = store.posts.update(post.id, publishFields(post), { user: req.user, partial: true })
    requestBuild('post published')
    res.json(published)
  })

  router.post('/api/posts/:id/unpublish', (req, res) => {
    const post = store.posts.get(Number(req.params.id), { user: req.user })
    if (!canPublish(req.user)) return deny(req, res)
    const draft = store.posts.update(post.id, { status: 'draft' }, { user: req.user, partial: true })
    requestBuild('post unpublished')
    res.json(draft)
  })

  return router
}
