# pooppress — Development plan

Companion to [ARCHITECTURE.md](ARCHITECTURE.md). That file says what; this file says in what order and when it's done.

---

## Locked decisions

| Concern         | Decision                                                                                                                                                          |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime         | Node.js ≥ 20, single process                                                                                                                                      |
| Server          | Express                                                                                                                                                           |
| Database        | SQLite via better-sqlite3, plain SQL, numbered `.sql` migrations                                                                                                  |
| Admin UI        | HAT stack from [stamat/shitstorm-hat](https://github.com/stamat/shitstorm-hat): server-rendered nunjucks + htmx partial swaps + Alpine.js sprinkles + Tailwind v4 |
| Admin styles    | Minimal. Tailwind utilities only, no component library, no custom design system                                                                                   |
| Markdown editor | EasyMDE — interactive (toolbar, shortcuts, side-by-side preview), one include                                                                                     |
| Auth            | Sessions in SQLite `sessions` table (hashed tokens, 14-day sliding) + scrypt from node:crypto; cookies `HttpOnly; SameSite=Lax; Secure`                           |
| Build engine    | poops + poops-images                                                                                                                                              |
| Hosting targets | All first-class, none required: laptop mode, Docker container, VPS install script (systemd + Caddy), shared hosting via Passenger/cPanel                          |

Full dependency list (server): `express`, `better-sqlite3`, `nunjucks`, `js-yaml`, `poops`, `poops-images`, `multer` (upload parsing). `fast-xml-parser` joins at M9, importer-only. Security adds zero dependencies — all stdlib (see ARCHITECTURE.md §Security model). Admin vendors `htmx`, `alpinejs`, `easymde` as static files; `tailwindcss` is a dev dependency compiled once at admin build time — sites never pay for it.

Anything not in this table gets decided at the milestone that needs it, not before.

---

## Repo layout

```
pooppress/
├── bin/pooppress.js           # CLI entry: init | start | build | deploy | import
├── server/
│   ├── index.js               # Express app, route mounting, session middleware
│   ├── db.js                  # better-sqlite3 connection + migration runner
│   ├── migrations/            # 001-init.sql, 002-*.sql, ...
│   ├── auth.js                # scrypt hash/verify, session helpers, role guard
│   ├── routes/                # one file per resource (posts.js, media.js, ...)
│   ├── import/wxr.js          # WordPress WXR importer (M9)
│   └── build/
│       ├── bridge.js          # DB → tmp/markup export
│       ├── runner.js          # lock, debounce, poops.compile(), status
│       └── post.js            # search index, sitemap, RSS
├── admin/                     # shitstorm-hat derived poops project
│   ├── src/markup/            # nunjucks pages + htmx partials
│   ├── src/styles/            # Tailwind entry
│   ├── src/script/           # Alpine components, EasyMDE init
│   └── dist/                  # prebuilt admin assets, served statically
├── themes/default/
├── script/
│   ├── install.sh             # VPS installer
│   └── Dockerfile
├── data/                      # gitignored: pooppress.db, uploads/
└── output/                    # gitignored: generated site
```

---

## Admin UI

Loosely model the interface on the WordPress admin layout — the audience is migrating WP users, so familiarity is the feature:

- Left sidebar nav: Posts, Media, Collections, Themes, Plugins, Users, Settings
- Top bar: site name (links to public site), build status, current user / logout
- List screens: table with row-hover actions (edit, delete), search box, status filter, bulk-ish simplicity — no bulk actions until asked
- Editor: full-width, title above body, status/publish controls in a right column
- Loose means loose: WP's shape, not its skin — Tailwind-minimal, no wp-admin cosplay

---

## Phase 1 — replace a WordPress blog

Milestones ship in order; each ends with a runnable check. Don't start a milestone with the previous one's check failing.

### M0 — Scaffold (day 1)

- `npm init`, ESM, `bin/pooppress.js` with `start` subcommand only
- Express serving `GET /api/health` → `{ ok: true }`
- Scaffold `admin/` from shitstorm-hat (`npm create poops@latest admin hat`), strip demo pages, build once, serve `admin/dist` at `/admin`
- Vendor htmx + Alpine + EasyMDE into `admin/src/static/`

**Done when:** `npx pooppress start` serves a Tailwind-styled "hello" page at `/admin`.

### M1 — Database

- `db.js`: open `data/pooppress.db`, WAL mode, foreign keys on, `busy_timeout = 5000` (Passenger runs several workers against one file)
- Migration runner: read `migrations/*.sql` sorted, apply those above `PRAGMA user_version`, bump version. ~20 lines, no library
- `001-init.sql`: users, sessions, posts, collections, media, settings per ARCHITECTURE.md schema — incl. the `COALESCE(collection_id, 0), slug` unique index and the collections `permalink` column
- Query helpers per table — plain functions returning rows, no ORM, no classes

**Done when:** `node -e` smoke script inserts a post and reads it back; rerunning migrations is a no-op.

### M2 — Auth

- scrypt hash/verify: pinned params (`N=2^15, r=8, p=1`, 16-byte salt, 64-byte key), stored `scrypt$N$r$p$salt$key`, `timingSafeEqual` compare
- Sessions per ARCHITECTURE.md §Security model: 32-byte random token in an `HttpOnly; SameSite=Lax; Secure` cookie, SHA-256 of it in the `sessions` table, 14-day sliding expiry, expired rows purged on login; `app.set('trust proxy', ...)` for proxied deployments
- Login page (nunjucks form, no htmx needed); identical error for wrong password and unknown email (dummy-hash the latter); rate limit 10 failures / 15 min / IP+email, in-memory window
- Middleware: `requireAuth` on everything under `/admin` and `/api` except login; origin check on non-GET; security headers (CSP et al. per §Security model)
- Logout deletes the session row; `GET /api/auth/me`

**Done when:** wrong password and unknown email return the same error; 11th rapid failure gets 429; right password reaches admin; server restart keeps you logged in; a replayed cookie after logout is rejected.

### M3 — Post CRUD + editor

The core loop. Biggest milestone.

- Post list page: htmx-powered table (search box, status filter, pagination via partial swaps)
- Post edit page: EasyMDE on `body_markdown`, plain inputs for title/slug/excerpt/status, Alpine for slug-from-title suggestion
- `meta` JSON edited as key/value rows (Alpine repeater), serialized to the JSON column
- REST routes per ARCHITECTURE.md; htmx endpoints return HTML partials, `/api/*` returns JSON
- Server-side validation: slug matches `^[a-z0-9][a-z0-9-]*$` (slugs become file paths at build); nunjucks autoescape stays on, `| safe` is a review flag
- Autosave draft every 30s via htmx (`hx-trigger="every 30s"` on dirty flag) — draft saves and autosaves never trigger builds

**Done when:** create → edit → save → list roundtrip works with JS enabled, the forms still submit without JS (htmx progressive enhancement), and a day of draft edits triggers zero builds.

### M4 — Media

- Upload form: multer with size cap → `data/uploads/<uuid>.<ext>` (name generated from verified mime — `original_name` is display-only), mime+extension allowlist (jpeg/png/gif/webp/avif, no SVG — script vector), fire poops-images, write `variants` JSON on the media row
- `/uploads` served by Express with `nosniff` — same path works in admin preview and in built output (build copies the dir in M5)
- Gallery page: thumbnail grid, delete (removes file + variants; resolved path must sit inside `data/uploads/`), copy-markdown-snippet button
- EasyMDE toolbar button: open gallery in modal (htmx), insert `![alt](path)` at cursor

**Done when:** upload a JPEG → variants exist on disk and in the DB row → insert into a post body from the modal → image renders in admin preview; an `.svg` or `.html` upload is rejected.

### M5 — Build bridge

- `bridge.js`: export to tmp per ARCHITECTURE.md build steps — only `status = 'published' AND published_at <= now`; URLs honor collection `permalink` patterns; copy `data/uploads/` into the output (skip unchanged); write redirect stubs from `meta.redirect_from`
- `runner.js`: cross-process lock — fs lockfile in `data/` (`wx` open) — + 2s debounce (`setTimeout`, cleared on new trigger); build into `output.tmp/`, two-step rename swap (atomic publish; stale pages of unpublished/deleted posts vanish)
- Wire triggers: publish/unpublish/delete/settings-change call `requestBuild()` — draft saves never do
- `POST /api/build`, `GET /api/build/status`; admin header shows build state (Alpine polling every 2s while building)
- Post-build: sitemap.xml + RSS per collection, titles/excerpts XML-escaped (search index deferred to Phase 3). Direct calls for now — Phase 3 moves them behind the `build:after` registry; planned move, keep the functions pure

**Done when:** publishing a post produces correct HTML in `output/` within a few seconds — checked against a 2-file fixture theme in `scripts/checks/` (the real theme is M6); the M4 image resolves in output; ten rapid saves cause one build; unpublishing removes the page from `output/`.

### M6 — Default theme

- Build `themes/default/` per the theme structure in ARCHITECTURE.md: default/post/collection/page layouts, header/footer/post-card/pagination/meta partials
- Minimal styles here too — small hand-written SCSS, no Tailwind in themes (themes are user-facing artifacts, keep them dependency-light)
- Bridge copies theme into tmp; theme.json config exposed as `{{ theme.* }}`

**Done when:** fresh install with three posts produces a readable, styled blog with working pagination and RSS.

### M7 — Setup wizard + CLI

- `pooppress init`: prompts (site title/URL/description, admin email/password) via `node:readline` — no prompt library
- Creates `data/` (chmod 700), runs migrations, inserts admin user + settings, writes `.env` with just `PORT` chmod 600 (no session secret — tokens are random DB values, nothing to sign), activates default theme
- `pooppress build`: headless build. `pooppress deploy`: rsync/copy per settings

**Done when:** empty directory → `init` → `start` → publish a post → deployable `output/`, no manual steps skipped.

### M8 — Packaging: container + VPS script

Both hosting artifacts from ARCHITECTURE.md's hosting section:

- `script/Dockerfile` (node:22-slim, global install, `CMD ["pooppress", "start"]`), volume at `/app/data`; publish image via GitHub Actions on tag
- `script/install.sh`: Node ≥ 20 check/install, `npm i -g pooppress`, run wizard, write systemd unit (dedicated non-root user), offer Caddy install + 2-line reverse proxy config
- Passenger/cPanel doc page: entry file, `process.env.PORT`, `tmp/restart.txt`, `passenger_min_instances 1` — no code work, verify on one cPanel host
- Test script on a clean Debian VM (manual, once per release)

**Done when:** `docker run -v ./data:/app/data -p 3000:3000 pooppress` and `curl … | bash` on a fresh VPS both reach a working admin over HTTPS (VPS case).

### M9 — WordPress importer

The Phase 1 exit criterion, built instead of implied:

- `pooppress import wxr export.xml` — parse WXR with `fast-xml-parser` (importer-only, the one new dependency; decided here per the locked-decisions rule)
- Posts/pages → posts (pages standalone); categories/tags → `meta` arrays; authors → users with locked passwords (admin resets); attachments downloaded to `data/uploads/` under generated names, body URLs rewritten
- Bodies stay HTML inside `body_markdown` — markdown is a superset, renders as-is. HTML→markdown conversion (turndown) parked; trigger: authors demand editing imported posts as markdown
- Permalinks: set the collection's `permalink` pattern to match the WP structure; where an old URL still differs, fill `meta.redirect_from` → build emits meta-refresh + canonical stubs

**Done when:** a real blog's WXR (not a synthetic fixture) imports and builds a browsable site where every old post URL resolves — directly or via stub.

**Phase 1 exit:** a WordPress blog can migrate. Tag v0.1.0.

---

## Phase 2 — multi-user and theming (complete)

Each item was independent; all shipped. Checks live in `script/checks/`.

- **Roles** — the admin/editor/author matrix is enforced in the routes (`canPublish` in `auth.js`): authors see and touch only their own posts, save only `draft`/`review`, and a published post is read-only to its author; publish/unpublish, collections, media deletion and manual rebuilds are editor+. Author-role raw HTML is escaped at build export (`server/build/sanitize.js` — poops renders markdown with marked, which has no per-file `html: false`, so the neutralizing happens before the markup dir is written); the editor's client-side preview applies the same strip for everyone. Check: `p2-roles.test.mjs`
- **Collections UI** — CRUD pages (landed with M-era admin work). Check: `admin-screens.test.mjs`
- **Theme config UI** — `configSchema` types (color/number/boolean/select/text) render as a form; values land in the `theme.config` setting with real types. Check: `admin-screens.test.mjs`
- **Scheduled publishing** — a 60s sweep (`server/build/scheduler.js`) calls `requestBuild()` when a scheduled post has come due since the last sweep. No cron dependency, no status flip. Check: `p2-scheduling.test.mjs`
- **Draft preview** — one draft builds with the real theme into `data/previews/<32-hex-token>/`, served at `/preview/<token>/` — never written into `output/`, so a deploy can't ship drafts; every site build deletes the previews dir, expiring all tokens. Check: `p2-preview.test.mjs`

**Phase 2 exit met:** three-author blog with a custom-configured theme. Tag v0.2.0.

---

## Phase 3 — extensibility

- **Plugin system** — manifest scan, `plugins.active` setting, filter/extension registration on the build's nunjucks env, lifecycle hooks (content events `post:save`/`post:publish`/`media:upload` + build hooks `post:frontmatter`/`build:before`/`build:after` — ~20-line resident registry loaded at server start, core's own sitemap/RSS/search run through it, hooks never block saves), zip upload in admin for WP-style drop-in install, config UI reusing the theme configSchema renderer
- **Static search index** — tokenizer + `search-index.json` per ARCHITECTURE.md search section; client JS ships with default theme
- **Deploy presets** — flesh out `pooppress deploy --method=` for rsync/s3/netlify
- **Marketplace** — parked. Revisit trigger: third parties actually write themes/plugins

---

## Working rules

- **Testing:** one runnable check per milestone (listed above), as a script in `script/checks/`. No test framework until a regression actually bites; then Jest (already in shitstorm-hat lineage), tests only around what broke.
- **No feature before its milestone.** Anything tempting goes to [IDEAS.md](IDEAS.md) with a revisit trigger.
- **Admin assets are prebuilt.** `admin/dist` is committed (or built on publish) — installing pooppress never runs Tailwind.
- **Migrations are append-only** once tagged. Before v0.1.0, editing `001-init.sql` and deleting the dev DB is fine.
- **CI:** GitHub Actions — lint + milestone checks on push, Docker image on tag. Copy the workflow shape from shitstorm-hat.
- **Security invariants** live in [ARCHITECTURE.md §Security model](ARCHITECTURE.md#security-model). Parameterized SQL only — string interpolation into SQL is a review-blocker. Each milestone check asserts the invariants it touches.
