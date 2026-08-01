import 'htmx.org'
import Alpine from 'alpinejs'
import EasyMDE from 'easymde'

// Same rule the server validates against (^[a-z0-9][a-z0-9-]*$), so a
// suggested slug never fails save.
function slugify (title) {
  return String(title)
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200)
}

// Client twin of server/build/sanitize.js: the editor preview renders with
// raw HTML neutralized for everyone (ARCHITECTURE §Security) — keep the two
// in sync by hand, they are the same ~20 lines.
function stripRawHtml (markdown) {
  const out = []
  let fence = null
  for (const line of String(markdown).split('\n')) {
    const open = line.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (fence) {
      out.push(line)
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length) fence = null
      continue
    }
    if (open) { fence = open[1]; out.push(line); continue }
    out.push(line
      .split(/(`+[^`]*`+)/)
      .map((part) => part.startsWith('`') ? part : part.replace(/<(?=[a-zA-Z/!?])/g, '&lt;'))
      .join(''))
  }
  return out.join('\n')
}

Alpine.data('postEditor', (initial = {}) => ({
  title: initial.title || '',
  slug: initial.slug || '',
  slugTouched: Boolean(initial.slug),
  dirty: false,
  editor: null,
  // One media picker modal serves two consumers; this decides where a pick lands.
  mediaTarget: 'body',
  featured: initial.featured || '',

  init () {
    this.editor = new EasyMDE({
      element: this.$refs.body,
      autoDownloadFontAwesome: false,
      spellChecker: false,
      status: ['lines', 'words'],
      previewRender: (text) => this.editor.markdown(stripRawHtml(text)),
      toolbar: ['bold', 'italic', 'heading', '|', 'quote', 'unordered-list', 'ordered-list', '|', 'link', {
        name: 'media',
        title: 'Insert media',
        text: '🖼',
        action: () => { this.mediaTarget = 'body'; this.$dispatch('open-media') }
      }, '|', 'preview', 'side-by-side', 'fullscreen']
    })
    // The textarea stays authoritative — the form posts it, not CodeMirror's DOM.
    this.editor.codemirror.on('change', () => {
      this.$refs.body.value = this.editor.value()
      this.dirty = true
    })
  },

  onTitleInput () {
    this.dirty = true
    if (!this.slugTouched) this.slug = slugify(this.title)
  },

  insertMedia (path, alt) {
    this.editor.codemirror.replaceSelection(`![${alt || ''}](${path})`)
    this.$refs.body.value = this.editor.value()
    this.dirty = true
  },

  pickFeatured () {
    this.mediaTarget = 'featured'
    this.$dispatch('open-media')
  },

  mediaPicked (path, alt) {
    if (this.mediaTarget === 'featured') {
      this.featured = path
      this.dirty = true
    } else {
      this.insertMedia(path, alt)
    }
  }
}))

// Label/url rows for the site menu — row order is menu order.
Alpine.data('menuRows', (initial = []) => ({
  rows: (initial || []).map((item) => ({ label: item.label || '', url: item.url || '' })),
  add () { this.rows.push({ label: '', url: '' }) },
  remove (i) { this.rows.splice(i, 1) },
  move (i, delta) {
    const j = i + delta
    if (j < 0 || j >= this.rows.length) return
    ;[this.rows[i], this.rows[j]] = [this.rows[j], this.rows[i]]
  }
}))

// Key/value rows for the post's meta JSON column. featured_image lives in the
// same column but has its own sidebar control, so it never shows as a row.
Alpine.data('metaRows', (initial = {}) => ({
  rows: Object.entries(initial || {}).filter(([key]) => key !== 'featured_image').map(([key, value]) => ({
    key,
    value: typeof value === 'string' ? value : JSON.stringify(value)
  })),
  add () { this.rows.push({ key: '', value: '' }) },
  remove (i) { this.rows.splice(i, 1) }
}))

window.Alpine = Alpine
Alpine.start()
