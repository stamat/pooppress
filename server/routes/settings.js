import { Router } from 'express'
import { readdirSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { settings } from '../queries.js'
import { requireAuth } from '../auth.js'
import { requestBuild } from '../build/runner.js'
import { SITE_ROOT, PKG_ROOT, themeDir } from '../config.js'

// Site-wide keys the settings screen owns. Anything else in the table (theme
// config, deploy config) is written by its own screen.
const SITE_KEYS = ['site.title', 'site.url', 'site.description', 'site.lang', 'site.author']

// Themes are directories with a manifest — the filesystem is the source of
// truth for what is installed, the settings table only records what is active.
function installedThemes() {
  const seen = new Map()
  for (const root of [path.join(PKG_ROOT, 'themes'), path.join(SITE_ROOT, 'themes')]) {
    if (!existsSync(root)) continue
    for (const slug of readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)) {
      const manifestPath = path.join(themeDir(slug), 'theme.json')
      const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {}
      seen.set(slug, { slug, name: manifest.name || slug, version: manifest.version || '', description: manifest.description || '', configSchema: manifest.configSchema || {}, config: manifest.config || {} })
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function settingsRoutes() {
  const router = Router()
  // Site settings, deploy config and themes shape the whole site — admin only.
  // Per-route (not router.use): this router sees every request passing through.
  const adminOnly = requireAuth('admin')

  router.get('/admin/settings', adminOnly, (req, res) => res.render('settings/index.html', {
    page: { title: 'Settings', nav: 'settings' },
    values: settings.all(),
    siteKeys: SITE_KEYS,
    deploy: settings.get('deploy') || {}
  }))

  router.post('/admin/settings', adminOnly, (req, res) => {
    for (const key of SITE_KEYS) {
      if (req.body[key] !== undefined) settings.set(key, String(req.body[key]).trim())
    }
    if (req.body['deploy.method'] !== undefined) {
      settings.set('deploy', {
        method: String(req.body['deploy.method'] || 'copy'),
        target: String(req.body['deploy.target'] || '').trim(),
        host: String(req.body['deploy.host'] || '').trim(),
        path: String(req.body['deploy.path'] || '').trim()
      })
    }
    requestBuild('settings changed') // site data is baked into every page
    res.redirect('/admin/settings')
  })

  router.get('/admin/themes', adminOnly, (req, res) => res.render('themes/list.html', {
    page: { title: 'Themes', nav: 'themes' },
    themes: installedThemes(),
    active: settings.get('theme.active', 'default'),
    config: settings.get('theme.config') || {}
  }))

  router.post('/admin/themes/:slug/activate', adminOnly, (req, res) => {
    const theme = installedThemes().find((t) => t.slug === req.params.slug)
    if (!theme) return res.status(404).render('error.html', { page: { title: 'Not found' }, error: 'No such theme.' })
    settings.set('theme.active', theme.slug)
    settings.set('theme.config', {}) // a new theme's schema owns its own values
    requestBuild('theme activated')
    res.redirect('/admin/themes')
  })

  router.post('/admin/themes/:slug/config', adminOnly, (req, res) => {
    const theme = installedThemes().find((t) => t.slug === req.params.slug)
    if (!theme) return res.status(404).render('error.html', { page: { title: 'Not found' }, error: 'No such theme.' })
    const config = {}
    for (const [key, field] of Object.entries(theme.configSchema)) {
      const raw = req.body[`config.${key}`]
      if (field.type === 'boolean') config[key] = raw === 'on' || raw === 'true'
      else if (field.type === 'number') config[key] = Number(raw)
      else if (raw !== undefined) config[key] = String(raw)
    }
    settings.set('theme.config', config)
    requestBuild('theme config changed')
    res.redirect('/admin/themes')
  })

  router.get('/api/settings', adminOnly, (req, res) => res.json(settings.all()))

  router.put('/api/settings', adminOnly, (req, res) => {
    for (const [key, value] of Object.entries(req.body)) settings.set(key, value)
    requestBuild('settings changed')
    res.json(settings.all())
  })

  router.get('/api/themes', adminOnly, (req, res) => res.json(installedThemes().map((theme) => ({ ...theme, active: theme.slug === settings.get('theme.active', 'default') }))))

  router.post('/api/themes/:slug/activate', adminOnly, (req, res) => {
    const theme = installedThemes().find((t) => t.slug === req.params.slug)
    if (!theme) return res.status(404).json({ error: 'not found' })
    settings.set('theme.active', theme.slug)
    requestBuild('theme activated')
    res.json({ active: theme.slug })
  })

  router.put('/api/themes/:slug/config', adminOnly, (req, res) => {
    settings.set('theme.config', req.body)
    requestBuild('theme config changed')
    res.json(settings.get('theme.config'))
  })

  return router
}
