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

Alpine.data('postEditor', (initial = {}) => ({
  title: initial.title || '',
  slug: initial.slug || '',
  slugTouched: Boolean(initial.slug),
  dirty: false,
  editor: null,

  init () {
    this.editor = new EasyMDE({
      element: this.$refs.body,
      autoDownloadFontAwesome: false,
      spellChecker: false,
      status: ['lines', 'words'],
      toolbar: ['bold', 'italic', 'heading', '|', 'quote', 'unordered-list', 'ordered-list', '|', 'link', {
        name: 'media',
        title: 'Insert media',
        text: '🖼',
        action: () => this.$dispatch('open-media')
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
  }
}))

// Key/value rows for the post's meta JSON column.
Alpine.data('metaRows', (initial = {}) => ({
  rows: Object.entries(initial || {}).map(([key, value]) => ({
    key,
    value: typeof value === 'string' ? value : JSON.stringify(value)
  })),
  add () { this.rows.push({ key: '', value: '' }) },
  remove (i) { this.rows.splice(i, 1) }
}))

window.Alpine = Alpine
Alpine.start()
