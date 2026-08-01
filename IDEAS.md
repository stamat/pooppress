# Ideas

Parked, not planned. Each entry has a revisit trigger — if the trigger never fires, the idea stays dead.

---

## Browser-build mode (shared hosting without losing poops)

**Status:** parked. Revisit trigger: shared-hosting users (cPanel crowd) become the target audience and laptop mode isn't landing with them.

### The problem it solves

PHP's real advantage is shared hosting ubiquity: upload files, host handles TLS/process/uptime. But a PHP CMS can't run poops (JS) without a Node binary, which shared hosts don't reliably allow. Porting poops to PHP kills the engine and lands in Bludit/Statamic territory.

### The trick

Split the CMS so the only server-side code is a dumb PHP shim, and run the poops build **in the admin's browser**:

```
Shared host (PHP + SQLite via PDO):
  api.php          # auth, post CRUD, media upload, settings — thin JSON API
  data.sqlite      # content
  output/          # the public static site, written by the API

Admin browser (all JS):
  admin SPA        # same admin UI
  poops build      # nunjucks, markdown-it, dart-sass — all run in browser
  → POSTs built files back to api.php, which writes output/
```

Publii proves builds-in-JS-client work (it does exactly this inside Electron). This is Publii's model with the desktop app swapped for a browser tab and the local disk swapped for a PHP shim.

### What already works in a browser

- **nunjucks** — browser build is official
- **markdown-it** — pure JS
- **dart-sass** — compiled to JS, runs in browser
- **YAML** — js-yaml, pure JS

### Hard parts (why it's parked)

1. **poops-images** — sharp is a native binary, won't run in browser. Needs wasm codecs (jSquash / squoosh codecs) or `<canvas>` resizing. Different output quality, separate code path.
2. **Filesystem** — poops expects to read/write disk. Needs a memfs shim or a pluggable loader/writer abstraction in poops itself. Upstream change.
3. **Build parity** — two build environments (Node on server/laptop, browser for shared hosting) that must produce identical output. Every poops change tested twice.
4. **Upload cost** — every build POSTs the whole output through the author's connection. Big sites, slow.
5. **Two runtimes again** — PHP shim + JS admin. The exact thing the SQLite/Node decision eliminated.

### Verdict when parked

Clever-decoded-at-3am architecture. Solves a real problem for an audience we haven't confirmed we want. Laptop mode + free static hosts already beats shared hosting's deal for solo authors. Build it only if the trigger fires.

---

## Fixture data for poops-only theme development

**Status:** planned-adjacent, not scheduled. Revisit trigger: the first theme written outside this repo, or the next time editing `themes/default` means clicking through the admin to see a change.

### The problem it solves

Developing a theme today needs a running pooppress: seed posts in the admin, save, wait for a build, reload. A theme is just layouts/partials/styles consumed by poops — the CMS is only there to write the markup dir. Theme authors should get poops's own live-reload loop (`npx poops`) with zero pooppress running, the way [poops-shopify](https://github.com/stamat/poops-shopify) fakes a Shopify store: every file in `mocks/` becomes a template global, sensible defaults built in, `"data": ["../mocks"]` in poops.json.

### The sketch

A theme stays a drop-in (`theme.json` + `layouts/` + `partials/` + `styles/`); it gains a dev harness next to it:

```
themes/default/
  theme.json
  layouts/  partials/  styles/
  dev/
    poops.json      # in: markup, includePaths: ../layouts, ../partials; site data inline
    markup/         # fixture content in EXACTLY the bridge's export shape
      blog/…​.md     # front matter: layout/title/date/slug/collection/author/excerpt
      blog/index.html  # front matter only: pageItems, pageNumber, totalPages, prev/next
      about.md
      _data/theme.yaml # config defaults, same file the bridge writes
```

`cd themes/default/dev && npx poops` → live reload, no CMS.

### The trick that keeps it honest

Fixtures drift. Don't hand-write them — generate them with the bridge itself: `pooppress theme-fixtures <dir>` seeds a throwaway in-memory DB with canonical demo content (headings, code fences, images, a paginated collection, a standalone page, an author-role post) and calls the bridge's `exportInto()` (already parametrized by dir) to write `dev/markup/`. One source of truth: if the bridge's export shape changes, regenerating fixtures updates every theme's harness, and a stale harness diffs loudly in git.

### Open questions when picked up

1. Does the harness ship inside each theme (`dev/` committed) or as one shared `pooppress theme-dev` command that mounts any theme dir against a bundled fixture set? Leaning shared command — themes stay pure drop-ins, no boilerplate to copy.
2. Collection globals: bridge paginates indexes itself (poops can't see sort order); fixture indexes must carry `pageItems` the same way, which the generator gets for free.
3. RSS/sitemap flags in dev poops.json: off, they only add noise to a theme loop.
