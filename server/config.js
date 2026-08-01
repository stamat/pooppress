// Every path pooppress touches, resolved once.
//
// Two roots on purpose: PKG_ROOT is where pooppress itself lives (bundled admin
// assets, bundled themes) — read-only when installed globally. SITE_ROOT is the
// directory the user runs it in: data/, output/, and their own themes/plugins.
import path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const PKG_ROOT = path.resolve(fileURLToPath(import.meta.url), '../..')
export const SITE_ROOT = path.resolve(process.env.POOPPRESS_ROOT || process.cwd())

export const DATA_DIR = path.resolve(process.env.POOPPRESS_DATA || path.join(SITE_ROOT, 'data'))
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads')
export const DB_PATH = path.join(DATA_DIR, 'pooppress.db')
export const OUTPUT_DIR = path.resolve(process.env.POOPPRESS_OUTPUT || path.join(SITE_ROOT, 'output'))
// Draft previews build here — under data/, never under output/, so a deploy
// can't ship a draft.
export const PREVIEWS_DIR = path.join(DATA_DIR, 'previews')

export const ADMIN_DIST = path.join(PKG_ROOT, 'admin', 'dist')
export const ADMIN_VIEWS = path.join(PKG_ROOT, 'admin', 'src', 'markup')

// A theme dropped in the site's own themes/ wins over the bundled one, so
// `themes/default/` can be customised without editing the install.
export function themeDir(slug) {
  const local = path.join(SITE_ROOT, 'themes', slug)
  return existsSync(local) ? local : path.join(PKG_ROOT, 'themes', slug)
}

export const PORT = Number(process.env.PORT) || 3000
