import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync, unlinkSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import ImageProcessor from 'poops-images'
import { UPLOADS_DIR, DATA_DIR, themeManifest } from './config.js'
import { settings } from './queries.js'
import { ValidationError } from './validate.js'

// No SVG: SVG executes scripts. Add it only if a sanitizer ever earns its place.
const ALLOWED = {
  jpeg: { ext: 'jpg', mime: 'image/jpeg' },
  png: { ext: 'png', mime: 'image/png' },
  gif: { ext: 'gif', mime: 'image/gif' },
  webp: { ext: 'webp', mime: 'image/webp' },
  avif: { ext: 'avif', mime: 'image/avif' }
}

// Defaults when the active theme doesn't declare its own. A theme knows its
// layout widths, so theme.json may override: "images": { "sizes": [480, 960],
// "formats": ["webp", "avif"] } — same option shapes poops-images takes.
const SIZES = [{ width: 480 }, { width: 960 }, { width: 1600 }]
const FORMATS = ['webp']

function imageConfig() {
  let images
  try {
    images = themeManifest(settings.get('theme.active', 'default')).images
  } catch { /* unreadable manifest — fall back to defaults */ }
  const sizes = (images?.sizes || [])
    .map((s) => (typeof s === 'number' ? { width: s } : s))
    .filter((s) => Number(s?.width) > 0)
  const formats = (images?.formats || []).filter((f) => typeof f === 'string')
  return { sizes: sizes.length ? sizes : SIZES, formats: formats.length ? formats : FORMATS }
}

// The stored path is derived from what sharp actually parsed, never from the
// client's filename or its claimed content-type.
export async function storeUpload(buffer, originalName, userId) {
  let meta
  try {
    meta = await sharp(buffer).metadata()
  } catch {
    throw new ValidationError('That file is not an image we accept (jpeg, png, gif, webp, avif).', 'file')
  }
  const allowed = ALLOWED[meta.format]
  if (!allowed) throw new ValidationError(`Unsupported image format: ${meta.format}.`, 'file')

  mkdirSync(UPLOADS_DIR, { recursive: true })
  const name = `${randomUUID()}.${allowed.ext}`
  const absolute = path.join(UPLOADS_DIR, name)
  writeFileSync(absolute, buffer)

  return {
    original_name: originalName,
    path: path.posix.join('uploads', name),
    mime_type: allowed.mime,
    size_bytes: buffer.length,
    width: meta.width ?? null,
    height: meta.height ?? null,
    uploaded_by: userId,
    variants: await makeVariants(name)
  }
}

// One processor run scoped to the single new file (`include` is a glob), so
// generated variants are never rediscovered as sources on the next upload.
async function makeVariants(name) {
  const { sizes, formats } = imageConfig()
  await new ImageProcessor({
    in: UPLOADS_DIR,
    out: UPLOADS_DIR,
    include: name,
    sizes,
    format: formats,
    cache: false,
    verbose: false
  }).processAll()

  // processAll() reports stats, not paths — the variants it just wrote are the
  // files next to the original following the {name}-{width}w.{ext} convention
  // that poops' {% image %} tag discovers.
  const base = path.basename(name, path.extname(name))
  return readdirSync(UPLOADS_DIR)
    .filter((file) => file.startsWith(`${base}-`) && /-\d+w\.[a-z0-9]+$/i.test(file))
    .map((file) => ({
      path: path.posix.join('uploads', file),
      width: Number(file.match(/-(\d+)w\./)[1]),
      format: path.extname(file).slice(1)
    }))
    .sort((a, b) => a.width - b.width)
}

// Media deletion resolves the stored path and refuses anything that doesn't
// sit inside data/uploads/ — a path column is not a permission to unlink.
export function resolveInUploads(storedPath) {
  const absolute = path.resolve(DATA_DIR, storedPath)
  const root = path.resolve(UPLOADS_DIR)
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    throw new ValidationError('Refusing to touch a file outside the uploads directory.', 'path')
  }
  return absolute
}

export function deleteFiles(row) {
  for (const file of [row.path, ...(row.variants || []).map((v) => v.path)]) {
    const absolute = resolveInUploads(file)
    if (existsSync(absolute)) unlinkSync(absolute)
  }
}

// Re-runs variant generation for an existing upload against the current
// config — how a theme switch with different sizes reaches old media. Old
// variant files go first: makeVariants discovers by filename convention, and a
// stale 320w from a previous theme would otherwise survive into the new list.
export async function regenerateVariants(row) {
  for (const variant of row.variants || []) {
    const absolute = resolveInUploads(variant.path)
    if (existsSync(absolute)) unlinkSync(absolute)
  }
  return makeVariants(path.basename(row.path))
}
