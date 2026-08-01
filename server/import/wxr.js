import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { XMLParser } from 'fast-xml-parser'
import { users, posts, collections, media, settings } from '../queries.js'
import { hashPassword } from '../auth.js'
import { storeUpload } from '../media.js'
import { SLUG_RE } from '../validate.js'

// WordPress statuses → ours. Anything unknown lands as a draft: an import
// should never publish something the old site didn't.
const STATUS = { publish: 'published', draft: 'draft', pending: 'review', private: 'draft', future: 'published', inherit: 'draft' }

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  cdataPropName: '__cdata',
  trimValues: true
})

const text = (value) => {
  if (value === undefined || value === null) return ''
  if (typeof value === 'object') return String(value.__cdata ?? value['#text'] ?? '')
  return String(value)
}
const list = (value) => (value === undefined ? [] : [].concat(value))

export async function importWxr(file, options = {}) {
  const parsed = parser.parse(readFileSync(file, 'utf8'))
  const channel = parsed?.rss?.channel
  if (!channel) throw new Error('That does not look like a WordPress WXR export.')

  const oldBase = String(text(channel['wp:base_site_url']) || text(channel.link) || '').replace(/\/+$/, '')
  const collection = ensureCollection(options.collection || 'blog')
  const authors = importAuthors(channel)
  const items = list(channel.item)

  const attachments = options.skipMedia ? new Map() : await importAttachments(items, authors)
  const counts = { posts: 0, pages: 0, users: authors.size, media: attachments.size, skipped: [] }

  for (const item of items) {
    const type = text(item['wp:post_type'])
    if (type !== 'post' && type !== 'page') continue

    const slug = safeSlug(text(item['wp:post_name']) || text(item.title), text(item['wp:post_id']))
    const isPage = type === 'page'
    const body = rewriteUrls(text(item['content:encoded']), attachments, oldBase)
    const status = STATUS[text(item['wp:status'])] || 'draft'
    const meta = {}

    const categories = taxonomy(item, 'category')
    const tags = taxonomy(item, 'post_tag')
    if (categories.length) meta.categories = categories
    if (tags.length) meta.tags = tags

    // The old permalink keeps working through a stub, unless it was an
    // unresolvable query URL (?p=12) or already matches the new path.
    const oldPath = permalinkPath(text(item.link), oldBase)
    const newPath = isPage ? `/${slug}.html` : `/${collection.slug}/${slug}.html`
    if (oldPath && oldPath !== newPath) meta.redirect_from = [oldPath]

    const fields = {
      collection_id: isPage ? null : collection.id,
      author_id: authors.get(text(item['dc:creator'])) ?? null,
      slug,
      title: text(item.title) || slug,
      // Bodies stay HTML: markdown is a superset, so they render as-is.
      // Converting to markdown (turndown) is parked until authors ask to edit
      // imported posts as markdown.
      body_markdown: body,
      excerpt: text(item['excerpt:encoded']) || null,
      status,
      published_at: status === 'published' ? wpDate(item) : null,
      meta
    }

    const existing = posts.bySlug(fields.collection_id, slug)
    if (existing) posts.update(existing.id, { ...existing, ...fields })
    else posts.create(fields)

    if (isPage) counts.pages++
    else counts.posts++
  }

  settings.set('import.last', { file, at: new Date().toISOString(), ...counts })
  return counts
}

function ensureCollection(slug) {
  return collections.bySlug(slug) || collections.create({ name: slug.replace(/(^|-)(\w)/g, (m, d, c) => (d ? ' ' : '') + c.toUpperCase()), slug, paginate: 10 })
}

// Imported authors get a locked password: a random value nobody holds, so the
// account exists (posts keep their author) but can't be logged into until an
// admin sets a real one.
function importAuthors(channel) {
  const map = new Map()
  for (const author of list(channel['wp:author'])) {
    const login = text(author['wp:author_login'])
    const email = text(author['wp:author_email']) || `${login}@imported.invalid`
    const existing = users.byEmail(email)
    const user = existing || users.create({
      email,
      password_hash: hashPassword(randomBytes(32).toString('hex')),
      role: 'author',
      display_name: text(author['wp:author_display_name']) || login
    })
    map.set(login, user.id)
  }
  return map
}

async function importAttachments(items, authors) {
  const downloaded = new Map()
  for (const item of items) {
    if (text(item['wp:post_type']) !== 'attachment') continue
    const url = text(item['wp:attachment_url'])
    if (!url) continue
    const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'image')
    // A re-import must not re-download what is already here.
    const known = media.list({ limit: 1000 }).rows.find((row) => row.original_name === name)
    if (known) {
      downloaded.set(url, `/${known.path}`)
      continue
    }
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const buffer = Buffer.from(await response.arrayBuffer())
      const row = media.create(await storeUpload(buffer, name, authors.values().next().value ?? null))
      downloaded.set(url, `/${row.path}`)
    } catch (err) {
      // A dead attachment URL is normal in an old export — report it and keep
      // going rather than failing the whole import.
      console.warn(`[import] could not fetch ${url}: ${err.message}`)
    }
  }
  return downloaded
}

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function rewriteUrls(body, attachments, oldBase) {
  let out = body
  for (const [url, replacement] of attachments) {
    out = out.split(url).join(replacement)
    // WordPress srcset entries are sized variants of the same file
    // (photo-300x200.jpg): escape the whole url first, then widen the match
    // in front of the (already escaped) extension.
    const sized = escapeRegex(url).replace(/(\\\.[a-z0-9]+)$/i, '-\\d+x\\d+$1')
    out = out.replace(new RegExp(sized, 'gi'), replacement)
  }
  if (oldBase) out = out.split(`${oldBase}/`).join('/')
  return out
}

function taxonomy(item, domain) {
  return list(item.category)
    .filter((entry) => typeof entry === 'object' && entry['@_domain'] === domain)
    .map((entry) => entry['@_nicename'] || text(entry))
    .filter(Boolean)
}

function wpDate(item) {
  const value = text(item['wp:post_date_gmt']) || text(item['wp:post_date'])
  if (!value || value.startsWith('0000')) return null
  return value.slice(0, 19)
}

// Only a real path can become a redirect stub; "?p=12" has nothing to write.
function permalinkPath(link, oldBase) {
  if (!link) return null
  const path = link.replace(oldBase, '').replace(/^https?:\/\/[^/]+/, '')
  if (!path.startsWith('/') || path.includes('?')) return null
  return path
}

function safeSlug(raw, id) {
  const slug = String(raw)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200)
  return SLUG_RE.test(slug) ? slug : `post-${id || randomBytes(4).toString('hex')}`
}
