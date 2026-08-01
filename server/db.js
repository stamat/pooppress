import Database from 'better-sqlite3'
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DATA_DIR, DB_PATH } from './config.js'

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')

// Migrations are numbered files applied in order, tracked with PRAGMA
// user_version. Append-only once tagged. Returns the files it applied, so
// "rerunning is a no-op" is observable.
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

export function getDb() {
  if (db) return db
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })
  db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000') // Passenger runs several workers against one file
  migrate(db)
  return db
}

export function closeDb() {
  if (db) db.close()
  db = null
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
