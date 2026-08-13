// What SQL remains after the septic store took the plain CRUD. Two things keep
// a query here, and each entry names its reason:
//
// - the store cannot express it — LIKE search, json_each taxonomy filters,
//   multi-table joins, aggregates, two-key ordering, upsert-by-key;
// - it touches what the config deliberately leaves undeclared — password_hash,
//   the sessions table, the id-less settings table.
//
// Writing an empty value is no longer one of them: a store update without
// `partial` is a whole-row edit, and clears a field that arrives blank — '' for
// the text types, NULL for the rest. That is what retired the COALESCE updates
// this file used to carry for posts, collections, users and media alt text.
//
// Everything else goes through `store` from db.js, which enforces access and
// validation per call. JSON columns are parsed on the way out and stringified
// on the way in, so callers only ever see objects — same shape the store's
// hydrated reads have.
import { sql, likeEscape, nowSql } from './db.js'

const parsePost = (row) => row && { ...row, meta: JSON.parse(row.meta || '{}') }
const parseMedia = (row) => row && { ...row, variants: JSON.parse(row.variants || '[]') }

export const users = {
  // password_hash is undeclared in resources.js, so creating a user with a
  // credential has to happen here.
  create ({ email, password_hash, role = 'author', display_name = '' }) {
    const info = sql('INSERT INTO users (email, password_hash, role, display_name) VALUES (?, ?, ?, ?)')
      .run(email.toLowerCase().trim(), password_hash, role, display_name)
    return sql('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)
  },
  // Login needs the hash; store reads never carry it.
  byEmail: (email) => sql('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase().trim()),
  count: () => sql('SELECT COUNT(*) AS n FROM users').get().n,
  updatePassword (id, password_hash) {
    sql('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(password_hash, nowSql(), id)
  }
}

// The whole table is app-owned: septic's own sessions are stateless cookies,
// and pooppress keeps a table exactly for what those can't do — revocation.
export const sessions = {
  create: (token_hash, user_id, expires_at) =>
    sql('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(token_hash, user_id, expires_at),
  // One lookup returns both session and user — auth runs on every request.
  getWithUser: (token_hash) => sql(`
    SELECT s.token_hash, s.expires_at, u.id, u.email, u.role, u.display_name, u.avatar_url
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?`).get(token_hash, nowSql()),
  touch: (token_hash, expires_at) => sql('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(expires_at, token_hash),
  remove: (token_hash) => sql('DELETE FROM sessions WHERE token_hash = ?').run(token_hash),
  removeForUser: (user_id, exceptTokenHash = '') =>
    sql('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(user_id, exceptTokenHash),
  purgeExpired: () => sql('DELETE FROM sessions WHERE expires_at <= ?').run(nowSql())
}

export const collections = {
  // Existence pre-checks in validation and the raw update path — contexts
  // where the store's get would demand a user that none belongs to.
  get: (id) => sql('SELECT * FROM collections WHERE id = ?').get(id),
  // Unbounded on purpose — the build bridge and the post editor want every
  // collection, and the store's list wants a limit.
  all: () => sql('SELECT * FROM collections ORDER BY name').all(),
  bySlug: (slug) => sql('SELECT * FROM collections WHERE slug = ?').get(slug),
  withCounts: () => sql(`
    SELECT c.*, (SELECT COUNT(*) FROM posts p WHERE p.collection_id = c.id) AS post_count
    FROM collections c ORDER BY c.name`).all()
}

export const posts = {
  // COALESCE mirrors idx_posts_slug, so "same slug, no collection" is one row.
  bySlug: (collection_id, slug) => parsePost(
    sql('SELECT * FROM posts WHERE COALESCE(collection_id, 0) = COALESCE(?, 0) AND slug = ?').get(collection_id ?? null, slug)),

  // Admin listing: filters + LIKE search, at most a few thousand rows.
  // Ceiling: swap LIKE for FTS5 when it gets slow, not before.
  list ({ status, collection_id, author_id, search, taxonomy, term, page = 1, limit = 20 } = {}) {
    const where = []
    const params = []
    if (status) { where.push('p.status = ?'); params.push(status) }
    // Taxonomy terms live in the meta JSON, so the filter is a json_each scan.
    // `taxonomy` is checked against TAXONOMIES by the caller — it builds the
    // JSON path, and an arbitrary one would be a malformed-path error.
    if (taxonomy && term) {
      where.push('EXISTS (SELECT 1 FROM json_each(p.meta, ?) WHERE json_each.value = ?)')
      params.push(`$."${taxonomy}"`, term)
    }
    // 'none' means standalone pages — the rows a collection filter can never reach.
    if (collection_id === 'none') where.push('p.collection_id IS NULL')
    else if (collection_id !== undefined && collection_id !== null && collection_id !== '') {
      where.push('p.collection_id = ?'); params.push(Number(collection_id))
    }
    if (author_id) { where.push('p.author_id = ?'); params.push(author_id) }
    if (search) {
      where.push("(p.title LIKE ? ESCAPE '\\' OR p.body_markdown LIKE ? ESCAPE '\\')")
      const pattern = `%${likeEscape(search)}%`
      params.push(pattern, pattern)
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = sql(`SELECT COUNT(*) AS n FROM posts p ${clause}`).get(...params).n
    const offset = (Math.max(1, Number(page)) - 1) * limit
    const rows = sql(`
      SELECT p.*, c.slug AS collection_slug, c.name AS collection_name, u.display_name AS author_name
      FROM posts p
      LEFT JOIN collections c ON c.id = p.collection_id
      LEFT JOIN users u ON u.id = p.author_id
      ${clause}
      ORDER BY COALESCE(p.published_at, p.updated_at) DESC, p.id DESC
      LIMIT ? OFFSET ?`).all(...params, limit, offset).map(parsePost)
    return { rows, total, page: Math.max(1, Number(page)), pages: Math.max(1, Math.ceil(total / limit)) }
  },

  // Every term already used in one taxonomy field — the editor's autocomplete,
  // so a second post gets "JavaScript" and not a near-miss "Javascript".
  // json_each yields one row per array element, and the scalar itself when the
  // field was saved as a bare string.
  terms: (field) => sql(`
    SELECT DISTINCT json_each.value AS term FROM posts, json_each(posts.meta, ?)
    WHERE json_type(posts.meta, ?) IS NOT NULL ORDER BY term`)
    .all(`$."${field}"`, `$."${field}"`).map((row) => String(row.term)),

  // The build's one source of truth for what is public.
  published: () => sql(`
    SELECT p.*, c.slug AS collection_slug, c.name AS collection_name, c.permalink, c.layout AS collection_layout,
           u.display_name AS author_name, u.role AS author_role
    FROM posts p
    LEFT JOIN collections c ON c.id = p.collection_id
    LEFT JOIN users u ON u.id = p.author_id
    WHERE p.status = 'published' AND (p.published_at IS NULL OR p.published_at <= ?)
    ORDER BY p.published_at DESC`).all(nowSql()).map(parsePost),

  // Scheduling (Phase 2) asks this: has anything come due since the last build?
  nextScheduled: () => sql(`
    SELECT MIN(published_at) AS at FROM posts WHERE status = 'published' AND published_at > ?`).get(nowSql()).at,

  dueBetween: (a, b) => sql(`
    SELECT COUNT(*) AS n FROM posts WHERE status = 'published' AND published_at > ? AND published_at <= ?`).get(a, b).n,

  // A single post with the same joins the build gets — any status, for the
  // draft-preview build.
  forPreview: (id) => parsePost(sql(`
    SELECT p.*, c.slug AS collection_slug, c.name AS collection_name, c.permalink, c.layout AS collection_layout,
           u.display_name AS author_name, u.role AS author_role
    FROM posts p
    LEFT JOIN collections c ON c.id = p.collection_id
    LEFT JOIN users u ON u.id = p.author_id
    WHERE p.id = ?`).get(id))
}

export const media = {
  // Unbounded on purpose — variant regeneration and the WXR import walk every
  // row.
  all: () => sql('SELECT * FROM media').all().map(parseMedia),
  // Two-key order: created_at ties are broken by id, which the store's
  // single-column sort can't promise.
  list ({ page = 1, limit = 40 } = {}) {
    const total = sql('SELECT COUNT(*) AS n FROM media').get().n
    const rows = sql('SELECT * FROM media ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?')
      .all(limit, (Math.max(1, Number(page)) - 1) * limit).map(parseMedia)
    return { rows, total, page: Math.max(1, Number(page)), pages: Math.max(1, Math.ceil(total / limit)) }
  }
}

// The table has a TEXT primary key and no id column, which the store cannot
// address; the upsert stays SQL.
export const settings = {
  get (key, fallback = undefined) {
    const row = sql('SELECT value FROM settings WHERE key = ?').get(key)
    return row ? JSON.parse(row.value) : fallback
  },
  set: (key, value) => sql('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value)),
  all () {
    return Object.fromEntries(sql('SELECT key, value FROM settings').all().map((r) => [r.key, JSON.parse(r.value)]))
  }
}
