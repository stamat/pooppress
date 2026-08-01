-- Six tables. Timestamps are UTC TEXT ('YYYY-MM-DD HH:MM:SS') so they compare
-- lexicographically — that is what makes `published_at <= now` scheduling work
-- without a date type.

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'author' CHECK (role IN ('admin', 'editor', 'author')),
  display_name  TEXT NOT NULL DEFAULT '',
  avatar_url    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The cookie holds the raw token; this holds its SHA-256, so a leaked database
-- copy contains no usable sessions.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE collections (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL UNIQUE,
  sort_by      TEXT NOT NULL DEFAULT 'published_at',
  sort_order   TEXT NOT NULL DEFAULT 'desc' CHECK (sort_order IN ('asc', 'desc')),
  paginate     INTEGER,
  permalink    TEXT,
  layout       TEXT NOT NULL DEFAULT 'post',
  index_layout TEXT NOT NULL DEFAULT 'collection',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE posts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_id INTEGER REFERENCES collections(id) ON DELETE RESTRICT,
  author_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  slug          TEXT NOT NULL,
  title         TEXT NOT NULL DEFAULT '',
  body_markdown TEXT NOT NULL DEFAULT '',
  excerpt       TEXT,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'published', 'archived')),
  published_at  TEXT,
  meta          TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- COALESCE, not a plain UNIQUE: SQL treats NULLs as distinct, so two standalone
-- pages could share a slug and silently overwrite each other at build.
CREATE UNIQUE INDEX idx_posts_slug ON posts(COALESCE(collection_id, 0), slug);
CREATE INDEX idx_posts_status ON posts(status, published_at);
CREATE INDEX idx_posts_collection ON posts(collection_id);

CREATE TABLE media (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  uploaded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  original_name TEXT NOT NULL,
  path          TEXT NOT NULL UNIQUE,
  mime_type     TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  width         INTEGER,
  height        INTEGER,
  alt_text      TEXT NOT NULL DEFAULT '',
  variants      TEXT NOT NULL DEFAULT '[]',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
