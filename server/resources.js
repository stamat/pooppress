// pooppress's schema as a septic resource config — the authority for CRUD
// validation and per-call access. Column names mirror migrations/001-init.sql
// because live databases predate this file: prepareDb adopts them untouched
// (CREATE IF NOT EXISTS no-ops, ALTER ADD covers future additive columns).
// Non-additive changes still go through migrations/ — septic refuses those.
//
// Deliberately not resources: settings (TEXT primary key — the store needs an
// id column) and sessions (app-owned; septic's own auth is stateless).
//
// No unique/indexes blocks: the migration already created them, including the
// COALESCE slug index, and declaring them here would add duplicate indexes
// next to the column-level ones on existing databases.
//
// posts has no fieldAccess on status: authors may reach draft and review but
// not published, and that subset is not expressible in a binary write rule —
// guardStatus in routes/posts.js owns the ceiling.
import { DB_PATH } from './config.js'

const ALL_ROLES = ['author', 'editor', 'admin']
const EDITORS = ['editor', 'admin']

export const septicConfig = {
  dbPath: DB_PATH,
  resources: {
    users: {
      // password_hash stays undeclared: reads are shaped to declared fields,
      // so it cannot leave the database through the store. Login and password
      // writes go through the raw helpers in queries.js.
      access: { read: 'admin', write: 'admin' },
      fields: {
        email: 'email required',
        role: 'enum(admin,editor,author)',
        display_name: 'string',
        avatar_url: 'string',
        created_at: 'datetime = now',
        updated_at: 'datetime = now!'
      }
    },
    collections: {
      access: { read: ALL_ROLES, write: EDITORS },
      fields: {
        name: 'string required',
        slug: 'slug required',
        sort_by: 'string = published_at',
        sort_order: 'enum(asc,desc) = desc',
        paginate: 'integer',
        permalink: 'string',
        layout: 'string = post',
        index_layout: 'string = collection',
        created_at: 'datetime = now',
        updated_at: 'datetime = now!'
      }
    },
    posts: {
      access: { read: ALL_ROLES, write: ALL_ROLES },
      fields: {
        collection_id: 'ref:collections ondelete=restrict',
        author_id: 'ref:users ondelete=setnull',
        slug: 'slug required',
        title: 'string',
        body_markdown: 'text',
        excerpt: 'text',
        status: 'enum(draft,review,published,archived) = draft',
        published_at: 'datetime',
        meta: 'json = {}',
        created_at: 'datetime = now',
        updated_at: 'datetime = now!'
      }
    },
    media: {
      access: { read: ALL_ROLES, write: ALL_ROLES },
      fields: {
        uploaded_by: 'ref:users ondelete=setnull',
        original_name: 'string required',
        path: 'string required',
        mime_type: 'string',
        size_bytes: 'integer',
        width: 'integer',
        height: 'integer',
        alt_text: 'string',
        variants: 'json = []',
        created_at: 'datetime = now'
      }
    }
  }
}
