import express from 'express'
import nunjucks from 'nunjucks'
import path from 'node:path'
import { ADMIN_DIST, ADMIN_VIEWS, UPLOADS_DIR, PORT } from './config.js'
import { sessionMiddleware, originCheck, requireAuth } from './auth.js'
import { authRoutes } from './routes/auth.js'
import { postRoutes } from './routes/posts.js'
import { mediaRoutes } from './routes/media.js'
import { buildRoutes } from './routes/build.js'
import { collectionRoutes } from './routes/collections.js'
import { settingsRoutes } from './routes/settings.js'
import { userRoutes } from './routes/users.js'
import { ValidationError } from './validate.js'
import { posts, media, collections, settings } from './queries.js'

// Admin templates are rendered per request (htmx swaps need live data), so
// nunjucks runs here rather than in the admin's poops build. poops only
// compiles the admin's CSS/JS into admin/dist.
export function configureViews(app) {
  const env = nunjucks.configure([ADMIN_VIEWS, path.join(ADMIN_VIEWS, '_layouts'), path.join(ADMIN_VIEWS, '_partials')], {
    autoescape: true, // never turn this off — `| safe` is a per-use review flag
    express: app,
    noCache: process.env.NODE_ENV !== 'production'
  })
  env.addFilter('date', (value, format) => {
    if (!value) return ''
    // Timestamps are stored as UTC "YYYY-MM-DD HH:MM:SS"; without the Z, V8
    // reads them as local time and the displayed date drifts.
    const d = new Date(/^\d{4}-\d{2}-\d{2} /.test(value) ? `${value.replace(' ', 'T')}Z` : value)
    if (Number.isNaN(d.getTime())) return String(value)
    return format === 'input' ? d.toISOString().slice(0, 16) : d.toISOString().slice(0, 10)
  })
  return env
}

// 'unsafe-eval' is what stock Alpine needs; 'unsafe-inline' for styles is what
// CodeMirror/EasyMDE and Alpine's x-show need (they write style attributes).
// Ceiling: swap to Alpine's CSP build and drop both.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "frame-ancestors 'none'"
].join('; ')

function securityHeaders(req, res, next) {
  res.setHeader('Content-Security-Policy', CSP)
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'same-origin')
  next()
}

export function createApp() {
  const app = express()
  app.set('trust proxy', process.env.TRUST_PROXY || 'loopback')
  app.disable('x-powered-by')
  configureViews(app)

  app.use(securityHeaders)
  app.use(express.json({ limit: '5mb' }))
  app.use(express.urlencoded({ extended: false, limit: '5mb' }))
  // Express 5 leaves req.body undefined when nothing parsed; handlers should
  // read an empty object, not crash on a bodyless POST.
  app.use((req, res, next) => { req.body ??= {}; next() })

  app.get('/api/health', (req, res) => res.json({ ok: true }))

  app.use('/admin/assets', express.static(ADMIN_DIST, { fallthrough: true }))
  app.use('/uploads', express.static(UPLOADS_DIR, { setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff') }))

  app.use(sessionMiddleware)
  app.use(originCheck)
  app.use((req, res, next) => {
    res.locals.site = { title: settings.get('site.title', 'pooppress'), url: settings.get('site.url', '/') }
    next()
  })
  app.use(authRoutes())

  // Everything past here needs a session.
  app.use(['/admin', '/api'], requireAuth())

  app.get('/admin', (req, res) => res.render('dashboard.html', {
    page: { title: 'Dashboard', nav: 'dashboard' },
    stats: [
      { label: 'Posts', value: posts.list({ limit: 1 }).total, href: '/admin/posts' },
      { label: 'Media', value: media.count(), href: '/admin/media' },
      { label: 'Collections', value: collections.all().length, href: '/admin/collections' }
    ],
    recent: posts.recent(5)
  }))

  app.use(postRoutes())
  app.use(mediaRoutes())
  app.use(buildRoutes())
  app.use(collectionRoutes())
  app.use(settingsRoutes())
  app.use(userRoutes())

  // API routes answer JSON, including when they don't exist — an HTML 404 body
  // in a fetch() is worse than useless.
  app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }))
  app.use((req, res) => res.status(404).render('404.html', { page: { title: 'Not found' } }))

  // Validation failures are user errors, not crashes — answer in the caller's
  // own format.
  app.use((err, req, res, next) => {
    if (err instanceof ValidationError) {
      if (req.originalUrl.startsWith('/api')) return res.status(422).json({ error: err.message, field: err.field })
      return res.status(422).render('error.html', { page: { title: 'Invalid' }, error: err.message })
    }
    console.error(err)
    if (req.originalUrl.startsWith('/api')) return res.status(500).json({ error: 'server error' })
    res.status(500).render('error.html', { page: { title: 'Error' }, error: 'Something broke. Check the server log.' })
  })

  return app
}

export function start(port = PORT) {
  return createApp().listen(port, () => console.log(`pooppress → http://localhost:${port}/admin`))
}
