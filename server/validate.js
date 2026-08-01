// Slugs become file paths at build, so they are validated server-side at save
// — the client-side suggestion is convenience, this is the boundary.
export const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/

export class ValidationError extends Error {
  constructor(message, field) {
    super(message)
    this.field = field
    this.status = 422
  }
}

export function requireSlug(slug, field = 'slug') {
  const value = String(slug || '').trim()
  if (!SLUG_RE.test(value)) {
    throw new ValidationError('Slug must be lowercase letters, numbers and dashes, starting with a letter or number.', field)
  }
  if (value.length > 200) throw new ValidationError('Slug is too long.', field)
  return value
}

export function requireOneOf(value, allowed, field) {
  if (!allowed.includes(value)) throw new ValidationError(`${field} must be one of: ${allowed.join(', ')}`, field)
  return value
}

// datetime-local gives "YYYY-MM-DDTHH:MM"; the database compares timestamps
// lexicographically, so everything is normalised to "YYYY-MM-DD HH:MM:SS".
export function toTimestamp(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new ValidationError('Invalid date.', 'published_at')
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

// Paired meta_key[]/meta_value[] form rows → the meta JSON object. Values that
// parse as JSON are stored as JSON (arrays of tags stay arrays in front matter).
export function metaFromForm(body) {
  const keys = [].concat(body.meta_key || [])
  const values = [].concat(body.meta_value || [])
  const meta = {}
  keys.forEach((key, i) => {
    const name = String(key).trim()
    if (!name) return
    const raw = values[i] ?? ''
    try {
      meta[name] = JSON.parse(raw)
    } catch {
      meta[name] = raw
    }
  })
  return meta
}
