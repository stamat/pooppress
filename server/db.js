import { readdirSync, readFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb, prepareDb, createStore } from 'septic'
import { DATA_DIR } from './config.js'
import { septicConfig } from './resources.js'

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')

// Migrations are numbered files applied in order, tracked with PRAGMA
// user_version. Append-only once tagged. Returns the files it applied, so
// "rerunning is a no-op" is observable. septic's schema sync only ever adds
// (CREATE IF NOT EXISTS, ALTER ADD COLUMN) — renames, drops and constraint
// changes live here.
export function migrate(db) {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
  const current = db.pragma('user_version', { simple: true })
  const applied = []
  for (const file of files) {
    const version = Number(file.split('-')[0])
    if (!Number.isInteger(version) || version <= current) continue
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
    db.transaction(() => {
      db.exec(sql)
      db.pragma(`user_version = ${version}`) // pragma values can't be bound
    })()
    applied.push(file)
  }
  return applied
}

let db = null
let dataStore = null

export function getDb() {
  if (db) return db
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })
  // Migrations run before prepareDb: 001-init.sql uses bare CREATE TABLE, so
  // on a fresh database pooppress's DDL must land first — septic's
  // IF-NOT-EXISTS pass then no-ops against it. The other order would build
  // septic-shaped tables and crash the migration.
  const boot = openDb(septicConfig.dbPath) // WAL, FKs, busy_timeout — the same pragmas this file used to set
  migrate(boot)
  boot.close()
  const prepared = prepareDb(septicConfig)
  db = prepared.db
  dataStore = createStore(db, prepared.resources)
  return db
}

// The septic store: per-call access rules, field validation, reads shaped to
// declared fields. Lazy for the same reason getDb is — `pooppress --help`
// must not create data/. Every method takes { user }; omitting it reads as
// anonymous and fails closed.
export const store = new Proxy({}, {
  get(_, resource) {
    if (!dataStore) getDb()
    return dataStore[resource]
  }
})

// Trusted internal callers — the build bridge, scheduler, setup wizard and
// WXR import act on their own authority, not a request's.
export const SYSTEM = { id: 0, role: 'admin' }

export function closeDb() {
  if (db) db.close()
  db = null
  dataStore = null
  cache.clear() // prepared statements belong to the closed connection
}

// Statements are prepared per call site and cached by better-sqlite3 internally
// only when reused, so hold them here. All of them use ? placeholders — string
// interpolation into SQL is a review-blocker.
const cache = new Map()
export function sql(statement) {
  let prepared = cache.get(statement)
  if (!prepared) {
    prepared = getDb().prepare(statement)
    cache.set(statement, prepared)
  }
  return prepared
}

// LIKE has its own wildcards; user input must not carry them into the pattern.
export function likeEscape(value) {
  return String(value).replace(/[\\%_]/g, '\\$&')
}

export function nowSql() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}
