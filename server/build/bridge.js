import { mkdirSync, writeFileSync, rmSync, renameSync, existsSync, readFileSync, cpSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import yaml from 'js-yaml'
import { posts, collections, settings } from '../queries.js'
import { SITE_ROOT, OUTPUT_DIR, UPLOADS_DIR, PREVIEWS_DIR, themeDir, themeManifest } from '../config.js'
import { randomBytes } from 'node:crypto'
import { stripRawHtml } from './sanitize.js'

const run = promisify(execFile)

const BUILD_DIR = path.join(SITE_ROOT, '.pooppress-build')
const MARKUP_DIR = path.join(BUILD_DIR, 'markup')
const OUTPUT_TMP = `${OUTPUT_DIR}.tmp`
const OUTPUT_OLD = `${OUTPUT_DIR}.old`

// poops is a CLI. Running it as a child process (rather than importing its
// pipeline classes) keeps its process.cwd()-relative path resolution away from
// the server process, and a crashing build can't take the admin down with it.
const POOPS_BIN = new URL(await import.meta.resolve('poops/poops.js')).pathname

export async function buildSite() {
  rmSync(BUILD_DIR, { recursive: true, force: true })
  rmSync(OUTPUT_TMP, { recursive: true, force: true })
  // Previews expire here: every site build clears them, so a stale token 404s.
  rmSync(PREVIEWS_DIR, { recursive: true, force: true })
  mkdirSync(MARKUP_DIR, { recursive: true })

  const site = siteData()
  const theme = loadTheme()
  const published = posts.published()

  exportInto({ buildDir: BUILD_DIR, markupDir: MARKUP_DIR, outDir: OUTPUT_TMP, site, theme, items: published })

  const { stdout, stderr } = await run(process.execPath, [POOPS_BIN, '--build', '-q', '-c', 'poops.json'], { cwd: BUILD_DIR })
    .catch((err) => { throw new Error(`poops build failed:\n${err.stderr || err.stdout || err.message}`) })
  if (process.env.POOPPRESS_VERBOSE) console.log(stdout || stderr)

  writeRedirectStubs(published, site, OUTPUT_TMP)
  swapOutput()
  rmSync(BUILD_DIR, { recursive: true, force: true })
  return { posts: published.length }
}

// One draft, built as if published, into data/previews/<token>/ — a capability
// URL: unguessable, shareable with a reviewer, gone on the next site build.
export async function buildPreview(postId) {
  const post = posts.forPreview(postId)
  if (!post) return null
  const token = randomBytes(16).toString('hex')
  const buildDir = path.join(PREVIEWS_DIR, `.build-${token}`)
  const markupDir = path.join(buildDir, 'markup')
  const outDir = path.join(PREVIEWS_DIR, token)
  mkdirSync(markupDir, { recursive: true })

  const site = siteData()
  const theme = loadTheme()
  // The draft rides along with the published site, so its collection index
  // and navigation look exactly as they would after publishing.
  const items = [...posts.published().filter((p) => p.id !== post.id), post]

  exportInto({ buildDir, markupDir, outDir, site, theme, items })

  await run(process.execPath, [POOPS_BIN, '--build', '-q', '-c', 'poops.json'], { cwd: buildDir })
    .catch((err) => { throw new Error(`preview build failed:\n${err.stderr || err.stdout || err.message}`) })
  rmSync(buildDir, { recursive: true, force: true })
  return { token, page: itemPath(post).replace(/\.md$/, '.html').split(path.sep).join('/') }
}

function exportInto({ buildDir, markupDir, outDir, site, theme, items }) {
  exportTheme(theme, { buildDir, markupDir })
  exportPosts(items, markupDir)
  exportCollections(items, markupDir)
  exportThemeConfig(theme, markupDir)
  exportMenu(markupDir)
  writeFileSync(path.join(buildDir, 'poops.json'), JSON.stringify(poopsConfig({ site, theme, buildDir, outDir }), null, 2))
}

function siteData() {
  const all = settings.all()
  const site = { title: 'pooppress', description: '', url: '' }
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith('site.')) site[key.slice(5)] = value
  }
  return site
}

function loadTheme() {
  const slug = settings.get('theme.active', 'default')
  const dir = themeDir(slug)
  if (!existsSync(dir)) throw new Error(`Active theme "${slug}" is not installed (looked in ${dir})`)
  return { slug, dir, manifest: themeManifest(slug) }
}

// Layouts and partials go to underscore dirs — poops skips those for output but
// the engine resolves includes from them (includePaths below).
function exportTheme({ dir, manifest }, { buildDir, markupDir }) {
  const copyInto = (from, to) => { if (existsSync(from)) cpSync(from, to, { recursive: true }) }
  copyInto(path.join(dir, manifest.layouts || 'layouts'), path.join(markupDir, '_layouts'))
  copyInto(path.join(dir, manifest.partials || 'partials'), path.join(markupDir, '_partials'))
  copyInto(path.join(dir, 'styles'), path.join(buildDir, 'theme', 'styles'))
  copyInto(path.join(dir, 'scripts'), path.join(buildDir, 'theme', 'scripts'))
  copyInto(path.join(dir, 'static'), path.join(buildDir, 'theme', 'static'))
}

// theme.json's `config` values reach templates as {{ theme.* }} — poops names a
// data file's variable after its basename.
function exportThemeConfig({ manifest }, markupDir) {
  const config = { ...(manifest.config || {}), ...(settings.get('theme.config') || {}) }
  const dir = path.join(markupDir, '_data')
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'theme.yaml'), yaml.dump(config))
}

// The admin-curated menu reaches templates as {{ menu }} — always written, []
// when unset, so a theme can fall back to the automatic nav tree.
function exportMenu(markupDir) {
  const dir = path.join(markupDir, '_data')
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'menu.yaml'), yaml.dump(settings.get('menu') || []))
}

// Body content stores uploads root-relative (/uploads/x.jpg — what the admin
// media picker inserts and what the admin's own /uploads route serves). The
// built site is relative-path based (relativePathPrefix everywhere), so at
// export the page's depth is known and the same prefix is applied here.
// ponytail: covers markdown ](...) and double-quoted src/href attrs; reference
// -style markdown links get a pass until someone writes one.
function relativizeUploads(body, itemFile) {
  const depth = itemFile.split(path.sep).length - 1
  const prefix = '../'.repeat(depth) || './'
  return body
    .replace(/(\]\(|src="|href=")\/uploads\//g, `$1${prefix}uploads/`)
    // srcset holds comma-separated candidates, each with its own URL
    .replace(/srcset="([^"]*)"/g, (m, val) => `srcset="${val.replace(/(^|,\s*)\/uploads\//g, `$1${prefix}uploads/`)}"`)
}

function exportPosts(published, markupDir) {
  for (const post of published) {
    const frontMatter = {
      layout: post.meta.layout || post.collection_layout || (post.collection_slug ? 'post' : 'page'),
      title: post.title,
      date: post.published_at || post.created_at,
      slug: post.slug,
      collection: post.collection_slug || undefined,
      author: post.author_name || undefined,
      excerpt: post.excerpt || undefined,
      ...post.meta
    }
    const itemFile = itemPath(post)
    const file = path.join(markupDir, itemFile)
    mkdirSync(path.dirname(file), { recursive: true })
    // Author-role content ships without raw HTML (ARCHITECTURE §Security).
    const body = post.author_role === 'author' ? stripRawHtml(post.body_markdown) : post.body_markdown
    writeFileSync(file, `---\n${yaml.dump(frontMatter)}---\n\n${relativizeUploads(body, itemFile)}\n`)
  }
}

// A post's path inside the markup dir. The collection directory is what makes
// a file a collection item in poops, so a permalink pattern is applied *inside*
// it: pattern "/:year/:month/:slug" on collection "blog" gives
// blog/2024/03/my-post.html.
// ponytail: that means a WP site keeps its structure but gains the collection
// prefix; the old bare URLs are covered by meta.redirect_from stubs (M9).
function itemPath(post) {
  if (!post.collection_slug) return `${post.slug}.md`
  const pattern = post.permalink
  if (!pattern) return path.join(post.collection_slug, `${post.slug}.md`)
  const date = new Date((post.published_at || post.created_at).replace(' ', 'T') + 'Z')
  const expanded = pattern
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    // dot segments would escape the build dir — a permalink pattern is user
    // input and must not become a path traversal
    .filter((segment) => segment && segment !== ':collection' && segment !== post.collection_slug && !/^\.+$/.test(segment))
    .map((segment) => segment
      .replace(':year', String(date.getUTCFullYear()))
      .replace(':month', String(date.getUTCMonth() + 1).padStart(2, '0'))
      .replace(':day', String(date.getUTCDate()).padStart(2, '0'))
      .replace(':slug', post.slug))
    .join('/')
  return path.join(post.collection_slug, `${expanded}.md`)
}

// Collection index pages are paginated here rather than by poops, for two
// reasons: poops keys its collection globals by directory name, and a dashed
// name ("dev-notes") is unreachable in a nunjucks expression; and the sort
// order lives in the collections row, which poops can't see. The item list
// travels as front matter, so a theme only reads page.pageItems.
function exportCollections(published, markupDir) {
  for (const collection of collections.all()) {
    const dir = path.join(markupDir, collection.slug)
    mkdirSync(dir, { recursive: true })

    const items = published
      .filter((post) => post.collection_id === collection.id)
      .sort(comparePosts(collection))
      .map((post) => ({
        title: post.title,
        url: itemPath(post).replace(/\.md$/, '.html').split(path.sep).join('/'),
        date: post.published_at || post.created_at,
        excerpt: post.excerpt || autoExcerpt(post.body_markdown),
        author: post.author_name || undefined,
        featured_image: post.meta.featured_image || undefined
      }))

    const perPage = collection.paginate || items.length || 1
    const totalPages = Math.max(1, Math.ceil(items.length / perPage))
    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
      const frontMatter = {
        layout: collection.index_layout || 'collection',
        title: collection.name,
        // Only page 1 carries `collection` — that key is how poops registers a
        // collection, and a nested page would register a bogus second one.
        ...(pageNumber === 1 ? { collection: collection.slug } : { collectionSlug: collection.slug }),
        pageItems: items.slice((pageNumber - 1) * perPage, pageNumber * perPage),
        pageNumber,
        totalPages,
        // Pages 2..N must not show up in the nav tree next to the landing page.
        ...(pageNumber > 1 ? { nav: false } : {}),
        prevPageUrl: pageNumber === 2 ? `${collection.slug}/` : (pageNumber > 2 ? `${collection.slug}/${pageNumber - 1}/` : null),
        nextPageUrl: pageNumber < totalPages ? `${collection.slug}/${pageNumber + 1}/` : null
      }
      const file = pageNumber === 1
        ? path.join(dir, 'index.html')
        : path.join(dir, String(pageNumber), 'index.html')
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, `---\n${yaml.dump(frontMatter)}---\n`)
    }
  }
}

function comparePosts(collection) {
  const direction = collection.sort_order === 'asc' ? 1 : -1
  const key = collection.sort_by === 'published_at' ? 'published_at' : collection.sort_by
  return (a, b) => {
    const left = a[key] ?? ''
    const right = b[key] ?? ''
    return left === right ? 0 : (left < right ? -1 : 1) * direction
  }
}

// Meta-description fallback: first paragraph, markdown syntax stripped.
function autoExcerpt(markdown) {
  const paragraph = String(markdown).split(/\n\s*\n/).find((block) => block.trim() && !block.trim().startsWith('#')) || ''
  return paragraph
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#]/g, '')
    .trim()
    .slice(0, 200)
}

function poopsConfig({ site, theme, buildDir, outDir }) {
  const styles = theme.manifest.styles
  const scripts = theme.manifest.scripts
  const config = {
    markup: {
      in: 'markup',
      out: outDir,
      options: {
        site,
        data: ['_data/theme.yaml', '_data/menu.yaml'],
        includePaths: ['_layouts', '_partials'],
        sitemap: 'sitemap.xml',
        feed: true, // RSS per collection — core dogfooding the engine's own generators
        // Header menu: top-level pages + one leaf per collection landing.
        // home:false — the site title already links home. Also writes nav.json
        // into the output for client-side consumers.
        nav: { out: 'nav.json', collections: 'index', home: false }
      }
    },
    copy: [],
    includePaths: ['node_modules']
  }
  if (styles?.in) {
    config.styles = [{
      in: path.posix.join('theme', styles.in),
      out: path.join(outDir, styles.out || 'css'),
      options: { minify: true }
    }]
  }
  if (scripts?.in) {
    config.scripts = [{
      in: path.posix.join('theme', scripts.in),
      out: path.join(outDir, scripts.out || 'js'),
      options: { minify: true, format: 'iife' }
    }]
  }
  if (existsSync(UPLOADS_DIR)) config.copy.push({ in: UPLOADS_DIR, out: outDir })
  if (existsSync(path.join(buildDir, 'theme', 'static'))) config.copy.push({ in: 'theme/static', out: outDir })
  if (!config.copy.length) delete config.copy
  return config
}

// meta.redirect_from: old URLs that must keep resolving after a migration.
// A meta-refresh plus a canonical link is the whole story on a static host.
function writeRedirectStubs(published, site, outDir) {
  for (const post of published) {
    const from = [].concat(post.meta.redirect_from || [])
    if (!from.length) continue
    const target = postUrl(post, site)
    for (const oldUrl of from) {
      const clean = String(oldUrl).replace(/^https?:\/\/[^/]+/, '').replace(/^\/+|\/+$/g, '')
      if (!clean || clean.includes('..')) continue
      const dir = path.join(outDir, clean)
      mkdirSync(dir, { recursive: true })
      writeFileSync(path.join(dir, 'index.html'), `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=${escapeAttr(target)}">
<link rel="canonical" href="${escapeAttr(target)}">
<title>Moved</title>
</head><body><p>This page moved to <a href="${escapeAttr(target)}">${escapeHtml(target)}</a>.</p></body></html>
`)
    }
  }
}

function postUrl(post, site) {
  const relative = itemPath(post).replace(/\.md$/, '.html')
  const base = String(site.url || '').replace(/\/+$/, '')
  return `${base}/${relative.split(path.sep).join('/')}`
}

const escapeHtml = (value) => String(value).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
const escapeAttr = (value) => escapeHtml(value).replace(/"/g, '&quot;')

// Two renames, not one: renaming over an existing directory fails on Windows.
// Every build starts from an empty tree, so pages of unpublished or deleted
// posts disappear by construction — and no half-built site is ever visible.
function swapOutput() {
  rmSync(OUTPUT_OLD, { recursive: true, force: true })
  if (existsSync(OUTPUT_DIR)) renameSync(OUTPUT_DIR, OUTPUT_OLD)
  renameSync(OUTPUT_TMP, OUTPUT_DIR)
  rmSync(OUTPUT_OLD, { recursive: true, force: true })
}
