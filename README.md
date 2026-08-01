# 💩 pooppress

A CMS that generates static sites. Because WordPress with a caching plugin is just a static site generator with 200MB of PHP baggage.

You write in an admin panel. pooppress compiles the database into plain HTML with [poops](https://github.com/stamat/poops). Readers get static files.

```bash
npm install -g pooppress
mkdir my-blog && cd my-blog
pooppress init      # six questions
pooppress start     # admin at http://localhost:3000/admin
```

Docs: [`docs/`](docs/src/markup) — build them with `npm run docs:build`.
Design: [PHILOSOPHY.md](PHILOSOPHY.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [DEVELOPMENT.md](DEVELOPMENT.md)

## What's here

| Path | What |
| --- | --- |
| `bin/pooppress.js` | CLI: `init`, `start`, `build`, `deploy`, `import` |
| `server/` | Express app, SQLite, auth, routes, build bridge, WXR importer |
| `admin/` | admin panel — server-rendered nunjucks + htmx + Alpine + Tailwind |
| `themes/default/` | the bundled theme |
| `docs/` | this project's documentation site (poops + poops-docs-theme) |
| `scripts/checks/` | one runnable check per milestone |
| `scripts/install.sh`, `scripts/Dockerfile` | VPS and container packaging |

## Development

```bash
npm install
npm run admin:build     # compile admin CSS/JS into admin/dist (needed once)
npm run check           # every milestone check
npm run docs:dev        # docs site with live reload on :4041
node bin/pooppress.js init && node bin/pooppress.js start
```

`npm run check` boots the real app against a throwaway data directory — no fixtures, no mocks, no test framework beyond `node:test`.

## Status

Phase 1 is complete: setup wizard, auth, post CRUD with a markdown editor, media with responsive variants, the build bridge, the default theme, packaging, and the WordPress importer. A WordPress blog can migrate.

Phase 2 is complete: the admin/editor/author role matrix is enforced (authors own their drafts, submit for review, and their raw HTML never reaches the build), scheduled posts publish themselves, drafts preview at unguessable token URLs, and collections and theme config have admin UIs. CI runs the checks on every push.

Phase 3 (plugins, static search, deploy presets) is described in [DEVELOPMENT.md](DEVELOPMENT.md).

## License

MIT
