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
