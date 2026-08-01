import { Router } from 'express'
import multer from 'multer'
import { media } from '../queries.js'
import { storeUpload, deleteFiles, regenerateVariants } from '../media.js'
import { ValidationError } from '../validate.js'
import { requestBuild } from '../build/runner.js'
import { requireAuth } from '../auth.js'

// Memory storage: the file is validated by parsing it before anything is
// written, so it never touches disk under an untrusted name.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } })
const isHtmx = (req) => req.get('HX-Request') === 'true'

export function mediaRoutes() {
  const router = Router()
  // Deleting media can break other people's posts — editor territory. Upload
  // and alt text stay open to authors, who need them for their own drafts.
  const editorOnly = requireAuth('editor')

  router.get('/admin/media', (req, res) => {
    res.render('media/list.html', { page: { title: 'Media', nav: 'media' }, ...media.list({ page: req.query.page || 1 }) })
  })

  router.get('/admin/media/picker', (req, res) => {
    res.render('media/_grid.html', { picker: true, ...media.list({ limit: 60 }) })
  })

  router.post('/admin/media/upload', upload.single('file'), async (req, res, next) => {
    try {
      if (!req.file) throw new ValidationError('No file received.', 'file')
      const row = media.create(await storeUpload(req.file.buffer, req.file.originalname, req.user.id))
      if (isHtmx(req)) return res.render('media/_grid.html', { picker: false, ...media.list({}) })
      res.redirect(`/admin/media#media-${row.id}`)
    } catch (err) {
      next(err)
    }
  })

  // Rebuilds every upload's variants against the current theme's sizes —
  // the catch-up path after switching to a theme that declares different ones.
  // Synchronous on purpose: a library needs thousands of images before this
  // outlives a request. ponytail: move onto the build scheduler if it ever does.
  router.post('/admin/media/regenerate', editorOnly, async (req, res, next) => {
    try {
      for (const row of media.list({ limit: media.count() || 1 }).rows) {
        media.setVariants(row.id, await regenerateVariants(row))
      }
      requestBuild('media variants regenerated')
      res.redirect('/admin/media')
    } catch (err) {
      next(err)
    }
  })

  router.post('/admin/media/:id/delete', editorOnly, (req, res, next) => {
    const row = media.get(Number(req.params.id))
    if (!row) return next()
    try {
      deleteFiles(row)
    } catch (err) {
      return next(err)
    }
    media.remove(row.id)
    // A deleted image may still be referenced by a published post; the build
    // copies uploads/, so it has to run again.
    requestBuild('media deleted')
    if (isHtmx(req)) return res.render('media/_grid.html', { picker: false, ...media.list({}) })
    res.redirect('/admin/media')
  })

  router.post('/admin/media/:id/alt', (req, res, next) => {
    const row = media.get(Number(req.params.id))
    if (!row) return next()
    media.setAlt(row.id, String(req.body.alt_text || '').slice(0, 500))
    res.redirect('/admin/media')
  })

  // --- JSON API ---------------------------------------------------------

  // clamped both ways: SQLite reads LIMIT -1 as "no limit"
  router.get('/api/media', (req, res) => res.json(media.list({ page: req.query.page || 1, limit: Math.min(Math.max(Number(req.query.limit) || 40, 1), 100) })))

  router.get('/api/media/:id/variants', (req, res) => {
    const row = media.get(Number(req.params.id))
    if (!row) return res.status(404).json({ error: 'not found' })
    res.json(row.variants)
  })

  router.post('/api/media/upload', upload.single('file'), async (req, res, next) => {
    try {
      if (!req.file) throw new ValidationError('No file received.', 'file')
      res.status(201).json(media.create(await storeUpload(req.file.buffer, req.file.originalname, req.user.id)))
    } catch (err) {
      next(err)
    }
  })

  router.delete('/api/media/:id', editorOnly, (req, res, next) => {
    const row = media.get(Number(req.params.id))
    if (!row) return res.status(404).json({ error: 'not found' })
    try {
      deleteFiles(row)
    } catch (err) {
      return next(err)
    }
    media.remove(row.id)
    requestBuild('media deleted')
    res.status(204).end()
  })

  return router
}
