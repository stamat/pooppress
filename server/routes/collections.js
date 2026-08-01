import { Router } from 'express'
import { collections, posts } from '../queries.js'
import { requireSlug, requireOneOf, ValidationError } from '../validate.js'
import { requestBuild } from '../build/runner.js'
import { requireAuth } from '../auth.js'

const SORT_ORDERS = ['asc', 'desc']

function fieldsFromBody(body) {
  const fields = {
    name: String(body.name || '').trim().slice(0, 255),
    slug: requireSlug(body.slug),
    sort_by: String(body.sort_by || 'published_at').slice(0, 100),
    sort_order: requireOneOf(String(body.sort_order || 'desc'), SORT_ORDERS, 'sort_order'),
    paginate: body.paginate ? Number(body.paginate) : null,
    permalink: String(body.permalink || '').trim() || null,
    layout: String(body.layout || 'post').trim(),
    index_layout: String(body.index_layout || 'collection').trim()
  }
  if (!fields.name) throw new ValidationError('A collection needs a name.', 'name')
  if (fields.paginate !== null && (!Number.isInteger(fields.paginate) || fields.paginate < 1)) {
    throw new ValidationError('Posts per page must be a whole number.', 'paginate')
  }
  return fields
}

const view = (extra = {}) => ({ page: { title: 'Collections', nav: 'collections' }, rows: collections.withCounts(), ...extra })

export function collectionRoutes() {
  const router = Router()
  // Collections shape the whole site — editor territory (the role matrix in
  // ARCHITECTURE.md: "editor — manage all posts and collections").
  const editorOnly = requireAuth('editor')

  router.get('/admin/collections', editorOnly, (req, res) => res.render('collections/list.html', view()))

  router.post('/admin/collections', editorOnly, (req, res) => {
    try {
      collections.create(fieldsFromBody(req.body))
      requestBuild('collection created')
      res.redirect('/admin/collections')
    } catch (err) {
      res.status(422).render('collections/list.html', view({ error: message(err), form: req.body }))
    }
  })

  router.post('/admin/collections/:id', editorOnly, (req, res, next) => {
    const collection = collections.get(Number(req.params.id))
    if (!collection) return next()
    try {
      collections.update(collection.id, fieldsFromBody(req.body))
      requestBuild('collection updated')
      res.redirect('/admin/collections')
    } catch (err) {
      res.status(422).render('collections/list.html', view({ error: message(err), form: req.body }))
    }
  })

  router.post('/admin/collections/:id/delete', editorOnly, (req, res, next) => {
    const collection = collections.get(Number(req.params.id))
    if (!collection) return next()
    // Reassigning posts is the author's decision, not a cascade we make for them.
    if (posts.list({ collection_id: collection.id, limit: 1 }).total > 0) {
      return res.status(422).render('collections/list.html', view({ error: 'That collection still has posts. Move them first.' }))
    }
    collections.remove(collection.id)
    requestBuild('collection deleted')
    res.redirect('/admin/collections')
  })

  router.get('/api/collections', editorOnly, (req, res) => res.json(collections.withCounts()))

  router.post('/api/collections', editorOnly, (req, res) => {
    const collection = collections.create(fieldsFromBody(req.body))
    requestBuild('collection created')
    res.status(201).json(collection)
  })

  router.put('/api/collections/:id', editorOnly, (req, res) => {
    const collection = collections.get(Number(req.params.id))
    if (!collection) return res.status(404).json({ error: 'not found' })
    const updated = collections.update(collection.id, fieldsFromBody(req.body))
    requestBuild('collection updated')
    res.json(updated)
  })

  router.delete('/api/collections/:id', editorOnly, (req, res) => {
    const collection = collections.get(Number(req.params.id))
    if (!collection) return res.status(404).json({ error: 'not found' })
    if (posts.list({ collection_id: collection.id, limit: 1 }).total > 0) {
      return res.status(422).json({ error: 'collection still has posts' })
    }
    collections.remove(collection.id)
    requestBuild('collection deleted')
    res.status(204).end()
  })

  return router
}

function message(err) {
  if (err instanceof ValidationError) return err.message
  if (String(err.code || '').startsWith('SQLITE_CONSTRAINT')) return 'That slug is already taken.'
  throw err
}
