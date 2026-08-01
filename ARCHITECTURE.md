# pooppress

A CMS that generates static sites. Because WordPress with a caching plugin is just a static site generator with 200MB of PHP baggage.

pooppress uses [poops](https://github.com/stamat/poops) as its static build engine and [poops-images](https://github.com/stamat/poops-images) for image processing. Content lives in a database. Users edit through an admin panel. The output is plain HTML.

Guiding principles live in [PHILOSOPHY.md](PHILOSOPHY.md); build order lives in [DEVELOPMENT.md](DEVELOPMENT.md); parked ideas in [IDEAS.md](IDEAS.md).

---

## Architecture overview

```
pooppress/
├── server/                    # Node.js backend
│   ├── setup/                 # First-run wizard (creates DB file, admin user)
│   ├── auth/                  # Session auth, password hashing, roles
│   ├── routes/                # REST API endpoints
│   ├── db/                    # SQLite connection + plain SQL queries
│   ├── migrations/            # Numbered .sql files, applied in order
│   └── build/                 # DB-to-filesystem bridge, triggers poops
├── admin/                     # Admin panel (HAT: htmx + Alpine.js + Tailwind, from stamat/shitstorm-hat)
│   ├── editor/                # Simple markdown editor (textarea + live preview)
│   ├── posts/                 # Post list, drafts, scheduling
│   ├── collections/           # Create and manage collections
│   ├── media/                 # Image upload, gallery, variant preview
│   ├── themes/                # Theme selection and config
│   ├── plugins/               # Plugin management
│   ├── users/                 # User list, roles, invitations
│   └── settings/              # Site settings, build config
├── themes/                    # Installable theme packages
│   └── default/
├── plugins/                   # Installable plugin packages
└── output/                    # Generated static site
```

---

## Core concepts

### The build bridge

The CMS writes to the database. The build step materializes DB content into the file structure poops expects, then runs `poops.compile()`.

```
DB posts        → tmp/markup/{collection}/{slug}.md    (YAML front matter + markdown body)
DB collections  → tmp/markup/{collection}/index.html   (with paginate/sort front matter)
DB settings     → tmp/markup/_data/site.yaml
DB media        → data/uploads/ (+ variants made at upload) copied to output/uploads/
Active theme    → tmp/markup/_layouts/, _partials/, styles/, scripts/
Active plugins  → registered on nunjucks env as extensions/filters
```

The build step can either:

1. Write temp files and let poops consume them as normal (keeps poops fully decoupled)
2. Extend poops with a `DatabaseLoader` (nunjucks loaders are pluggable) for tighter integration

Option 1 is simpler and preferred for MVP. Option 2 is an optimization for later.

### Content flow

```
Author writes post in admin  →  saved to DB (markdown + metadata)
                              →  meta JSON column stores arbitrary front matter fields
                              →  preview renders client-side (nothing cached)

Author hits "Publish"         →  post.status = 'published'
                              →  build triggered
                              →  .md files written from DB
                              →  poops compiles to static HTML
                              →  output/ ready to deploy
```

### Build triggers

A build runs when:

- A post is published, unpublished, deleted, or updated while published — draft saves and autosaves never build
- A collection is created, modified, or deleted
- Site settings change
- A theme is activated or its config changes
- A plugin is activated or deactivated
- Manual "Rebuild" button in admin

Builds are queued — if multiple changes happen in quick succession, they are debounced into a single build. The export itself only includes posts with `published_at <= now`, so a future-dated post can't leak into an unrelated build — scheduling (Phase 2) is just a timer that requests a build when one comes due.

---

## Database schema

SQLite via `better-sqlite3`. No ORM — plain SQL. Migrations are numbered `.sql` files applied in order, tracked with `PRAGMA user_version`. Six tables total. Enums are TEXT with CHECK constraints.

### users

| Column        | Type         | Notes                 |
| ------------- | ------------ | --------------------- |
| id            | int, PK, AI  |                       |
| email         | text         | unique                |
| password_hash | text         | scrypt (node:crypto)  |
| role          | text         | admin, editor, author |
| display_name  | varchar(255) |                       |
| avatar_url    | varchar(512) | nullable              |
| created_at    | datetime     |                       |
| updated_at    | datetime     |                       |

**Roles:**

- **admin** — full access: users, settings, themes, plugins, all content
- **editor** — manage all posts and collections, publish/unpublish
- **author** — create and edit own posts, submit for review

### sessions

| Column     | Type     | Notes                               |
| ---------- | -------- | ----------------------------------- |
| token_hash | text, PK | SHA-256 of the 32-byte cookie token |
| user_id    | int, FK  | references users                    |
| created_at | datetime |                                     |
| expires_at | datetime | 14-day sliding                      |

Looked up by token on every authed request — that's what earns it a table. The raw token lives only in the cookie; the DB stores its hash, so a leaked database copy contains no usable sessions. Logout deletes the row (real server-side revocation), password change deletes the user's other sessions, expired rows are purged on login. Survives restarts and is shared across Passenger workers — process memory holds no auth state.

### posts

| Column        | Type         | Notes                                                                                                                                                                                                               |
| ------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id            | int, PK, AI  |                                                                                                                                                                                                                     |
| collection_id | int, FK      | nullable (standalone pages)                                                                                                                                                                                         |
| author_id     | int, FK      | references users                                                                                                                                                                                                    |
| slug          | varchar(255) | `^[a-z0-9][a-z0-9-]*$` — becomes a file path at build. Unique via `COALESCE(collection_id, 0), slug` index (plain UNIQUE treats NULL collections as distinct — two `about` pages would silently overwrite at build) |
| title         | varchar(255) |                                                                                                                                                                                                                     |
| body_markdown | longtext     | canonical content                                                                                                                                                                                                   |
| excerpt       | text         | nullable, manual or auto-generated                                                                                                                                                                                  |
| status        | enum         | draft, review, published, archived                                                                                                                                                                                  |
| published_at  | datetime     | nullable, supports scheduling                                                                                                                                                                                       |
| meta          | text (JSON)  | arbitrary front matter fields                                                                                                                                                                                       |
| created_at    | datetime     |                                                                                                                                                                                                                     |
| updated_at    | datetime     |                                                                                                                                                                                                                     |

`meta` replaces YAML front matter. Any field the author adds in the editor (featured_image, custom_css, whatever) is a key in the JSON object. During build, it's merged with the core post fields into the front matter. SQLite's `json_extract()` covers the rare query into it — no EAV table, no join.

### collections

| Column       | Type         | Notes                                                                                                      |
| ------------ | ------------ | ---------------------------------------------------------------------------------------------------------- |
| id           | int, PK, AI  |                                                                                                            |
| name         | varchar(255) | display name                                                                                               |
| slug         | varchar(255) | unique, used as directory name                                                                             |
| sort_by      | varchar(100) | default: 'published_at'                                                                                    |
| sort_order   | enum         | asc, desc. Default: desc                                                                                   |
| paginate     | int          | nullable, items per page                                                                                   |
| permalink    | varchar(255) | nullable pattern, e.g. `/:year/:month/:slug`; null = `/{collection}/{slug}`. WP migrations keep their URLs |
| layout       | varchar(255) | layout template for items                                                                                  |
| index_layout | varchar(255) | layout for collection index                                                                                |
| created_at   | datetime     |                                                                                                            |
| updated_at   | datetime     |                                                                                                            |

### media

| Column        | Type         | Notes                             |
| ------------- | ------------ | --------------------------------- |
| id            | int, PK, AI  |                                   |
| uploaded_by   | int, FK      | references users                  |
| original_name | varchar(255) | display only — never a path       |
| path          | varchar(512) | generated: `uploads/<uuid>.<ext>` |
| mime_type     | varchar(100) |                                   |
| size_bytes    | int          |                                   |
| width         | int          | nullable (non-images)             |
| height        | int          | nullable                          |
| alt_text      | text         | default alt text                  |
| variants      | text (JSON)  | `[{path, width, format}, ...]`    |
| created_at    | datetime     |                                   |

`variants` is written by poops-images after upload and read by the build step to generate srcset markup. It's derived data with one producer and one consumer — a JSON column, not a table.

Files live at `data/uploads/<uuid>.<ext>`; Express serves that dir at `/uploads` (images, `nosniff`) and the build copies it to `output/uploads/` — so one `/uploads/...` path works in admin preview and on the public site. Upload rules (allowlist, size cap, generated names) are in [Security model](#security-model).

### settings

| Column | Type | Notes        |
| ------ | ---- | ------------ |
| key    | text | PK           |
| value  | text | JSON-encoded |

Site-wide settings: title, description, url, date format, posts per page, analytics ID, etc.

Also holds theme/plugin state — themes and plugins get **no tables**. The filesystem is the source of truth for what's installed (scan `themes/*/theme.json` and `plugins/*/plugin.json`); the settings table holds what's active and how it's configured:

```
theme.active           → "starter-blog"
theme.config           → { "primaryColor": "#333", ... }
plugins.active         → ["syntax-highlight", "toc"]   (array order = load order)
plugin.syntax-highlight.config → { "theme": "monokai" }
```

Installing a theme = dropping a directory in `themes/`. No registration, no sync bugs between DB rows and disk.

---

## Setup wizard

```
$ npx pooppress init

  Welcome to pooppress.

  Site
  ────────────────────────────
  Title:       My Blog
  URL:         https://example.com
  Description: A blog about things

  Admin account
  ────────────────────────────
  Email:    admin@example.com
  Password: ********

  Creating data/pooppress.db ... done
  Running migrations ... done
  Creating admin user ... done
  Activating default theme ... done

  Ready. Run `npx pooppress start` to begin.
  Admin panel: http://localhost:3000/admin
```

No database questions — SQLite is a file. Site title/URL/description go straight into the settings table. The wizard writes a `.env` with just:

```env
PORT=3000
```

No session secret — session tokens are random DB-backed values, there is nothing to sign. The wizard chmods `.env` to 600 and `data/` to 700.

Backup = copy `data/`. Uninstall = delete the directory.

---

## Theme system

A theme is a directory with a `theme.json` manifest:

```json
{
  "name": "Starter Blog",
  "version": "1.0.0",
  "author": "stamat",
  "description": "Clean minimal blog theme",
  "config": {
    "timeDateFormat": "MMMM D, YYYY",
    "googleFonts": ["DM Sans", { "name": "Poppins", "weights": [400, 700] }],
    "postsPerPage": 10
  },
  "layouts": "layouts/",
  "partials": "partials/",
  "styles": {
    "in": "styles/main.scss",
    "out": "css"
  },
  "scripts": {
    "in": "scripts/main.js",
    "out": "js"
  }
}
```

Theme directory structure:

```
themes/starter-blog/
├── theme.json
├── screenshot.png            # Preview in admin theme browser
├── layouts/
│   ├── default.html          # Base layout
│   ├── post.html             # Single post layout
│   ├── collection.html       # Collection index/archive
│   └── page.html             # Standalone page
├── partials/
│   ├── header.html
│   ├── footer.html
│   ├── post-card.html        # Post preview in lists
│   ├── pagination.html
│   └── meta.html             # SEO meta tags
├── styles/
│   ├── main.scss
│   └── _variables.scss
└── scripts/
    └── main.js
```

During build:

1. Active theme's layouts/partials are copied to the temp markup directory
2. Theme's styles/scripts config is merged into the poops config
3. Theme's `config` values are available in templates as `{{ theme.* }}`
4. Admin exposes theme config fields as editable settings (font choices, colors, etc.)

Theme config can declare editable fields with types for the admin UI:

```json
{
  "configSchema": {
    "primaryColor": {
      "type": "color",
      "default": "#333333",
      "label": "Primary color"
    },
    "postsPerPage": {
      "type": "number",
      "default": 10,
      "label": "Posts per page"
    },
    "showAuthor": {
      "type": "boolean",
      "default": true,
      "label": "Show author on posts"
    }
  }
}
```

---

## Plugin system

A plugin is a directory with a `plugin.json` manifest:

```json
{
  "name": "Syntax Highlight",
  "version": "1.0.0",
  "author": "stamat",
  "description": "Code syntax highlighting with Prism",
  "provides": {
    "filters": {
      "highlight": "filters.js"
    },
    "extensions": {
      "codeBlock": "extensions.js"
    },
    "styles": "styles/prism.css",
    "scripts": "script/prism.js"
  },
  "configSchema": {
    "theme": {
      "type": "select",
      "options": ["monokai", "github", "dracula"],
      "default": "monokai",
      "label": "Color theme"
    }
  }
}
```

Plugin files export standard poops-compatible filters and extensions:

```js
// plugins/syntax-highlight/filters.js
import Prism from "prismjs";

export function highlight(code, lang) {
  if (!Prism.languages[lang]) return code;
  return Prism.highlight(code, Prism.languages[lang], lang);
}
```

```js
// plugins/syntax-highlight/extensions.js
import nunjucks from "nunjucks";
import Prism from "prismjs";

export class CodeBlockExtension {
  constructor() {
    this.tags = ["codeBlock"];
  }
  // ... standard nunjucks extension
}
```

During build:

1. Active plugins are loaded in `plugins.active` array order
2. Their filters are registered via `env.addFilter()`
3. Their extensions are registered via `env.addExtension()`
4. Their styles/scripts are merged into the build pipeline
5. Plugin config values are passed to extensions/filters as options

### Installing (WordPress-style drop-in)

Installing = dropping a directory into `plugins/` (or uploading a zip in admin, which does the same). No registration, no DB row — the filesystem scan picks it up, the admin lists it, one click activates. Deleting the directory uninstalls it. Same model as themes.

Zip uploads are admin-role only, and every entry is validated before extraction: no `..`, no absolute paths, no symlink entries, size-capped, extracted to a temp dir then moved into place — zip-slip goes nowhere.

Same trust model as WordPress too: an active plugin is arbitrary code running in the CMS process. Install plugins you trust.

### Lifecycle hooks

Beyond template filters/extensions, a plugin can declare `"hooks": "hooks.js"` in its manifest — a default-exported register function:

```js
// plugins/reading-time/hooks.js
export default function register({ hooks, config }) {
  hooks.filter("post:frontmatter", (fm, post) => {
    fm.readingTime = Math.ceil(post.body_markdown.split(/\s+/).length / 200);
    return fm;
  });
}
```

Hook points (deliberately few):

| Hook                              | Kind               | Fires                                                             |
| --------------------------------- | ------------------ | ----------------------------------------------------------------- |
| `post:save`                       | event              | after any post save commits                                       |
| `post:publish` / `post:unpublish` | event              | on status transition                                              |
| `media:upload`                    | event              | after upload + variants written                                   |
| `post:frontmatter`                | filter (waterfall) | per post during export — shape front matter                       |
| `build:before`                    | event              | after DB export, before `poops.compile()` — add/edit files in tmp |
| `build:after`                     | event              | after compile — post-process `output/`                            |

Since every save triggers a render, content events + build events cover the whole lifecycle — this is what enables WP-style plugins beyond templating: CDN purge, webhook pings, newsletter-on-publish, cross-posting, auto alt-text on upload.

Runtime model: active plugins' `hooks.js` are loaded **once at server start** (and reloaded on activate/deactivate), so the registry is resident — not rebuilt per build. Content-event hooks run after the DB write, off the request path: a slow or crashing hook logs an error, never blocks the save or the build. The registry itself stays a Map of arrays run sequentially with await — ~20 lines, no event library. Sitemap, RSS, and the search index run through the same `build:after` mechanism internally, so core dogfoods the plugin API.

**The honest limit vs WordPress:** output is static. Plugins shape the build, the templates, and (later) the admin — they cannot run per-request code on the public site. Anything dynamic for readers (comments, forms) must be client-side JS the plugin ships, talking to external services. That's the trade the whole architecture makes on purpose.

Deferred, with triggers: `server:routes` (plugin admin pages/API) when a real plugin needs one; plugin DB tables probably never — plugins get a settings key.

---

## Search

Two layers: database search for the admin panel, static search index for the public site.

### Admin search (database)

The admin panel searches posts with `LIKE '%q%'` on `title` and `body_markdown` (query escaped for `%`/`_`, bound as a parameter). This is only for the admin — filtering drafts, finding posts to edit — over at most a few thousand rows. SQLite FTS5 exists if `LIKE` ever gets slow; don't add it before then.

### Public search (static index)

The public site uses a build-time search index. No server, no database, no dependencies — pure static.

During build, every published post is tokenized and scored:

1. Strip HTML/markdown syntax from body
2. Lowercase, split into words
3. Remove stop words (the, is, a, and, of, to, in, ...)
4. Count word frequency per post
5. Write `search-index.json`

```json
{
  "posts": {
    "getting-started": {
      "title": "Getting Started with Node",
      "url": "/blog/getting-started",
      "excerpt": "A quick guide to setting up Node.js...",
      "date": "2024-03-15",
      "collection": "blog"
    },
    "advanced-async": {
      "title": "Advanced Async Patterns",
      "url": "/blog/advanced-async",
      "excerpt": "Deep dive into promises, generators...",
      "date": "2024-04-02",
      "collection": "blog"
    }
  },
  "index": {
    "node": [
      ["getting-started", 12],
      ["advanced-async", 3]
    ],
    "async": [
      ["advanced-async", 15],
      ["getting-started", 2]
    ],
    "promises": [["advanced-async", 8]],
    "javascript": [
      ["getting-started", 7],
      ["advanced-async", 6]
    ]
  }
}
```

Each word maps to `[slug, frequency]` pairs sorted by score. The client-side search:

1. Splits query into words
2. Looks up each word in the index
3. Intersects matching post sets
4. Sums frequency scores across query words
5. Ranks by total score
6. Returns top N results with title, excerpt, URL

The client JS is tiny — no Lunr, no Pagefind, no dependencies. Just a fetch, a loop, and a sort. Title matches can be weighted higher (multiply title word frequency by a factor).

Optional enhancements for later:

- **Stemming** — reduce words to roots (running/runs/ran → run) for better recall
- **Trigram index** — index 3-character substrings for partial/fuzzy matching
- **TF-IDF scoring** — weigh rare words higher than common ones (a post mentioning "kubernetes" once is more relevant than a post mentioning "code" fifty times)

---

## Security model

The public site is static files — nothing executes between reader and HTML, so the reader-facing attack surface belongs to the static host, not to pooppress. That is the strongest security property of the design, and it's free. Everything below hardens the CMS server, which only authors touch; it often isn't public at all (laptop mode, VPN, localhost behind Caddy) — but every mitigation assumes it is.

All of it is platform primitives. Zero security dependencies.

**Transport.** TLS terminates at Caddy or the shared host. Express sets `trust proxy` so `Secure` cookies and client IPs survive the proxy hop.

**Sessions.** 32-byte random token (`crypto.randomBytes`) in the cookie; the sessions table stores its SHA-256 — a leaked database contains no usable sessions. Cookie flags: `HttpOnly; SameSite=Lax; Secure; Path=/`. 14-day sliding expiry, expired rows purged at login. Logout deletes the row — real revocation, not a client-side shrug. Password change deletes the user's other sessions.

**Login.** scrypt with pinned params (`N=2^15, r=8, p=1`, 16-byte random salt, 64-byte key), stored self-describing (`scrypt$N$r$p$salt$key`) so params can be raised later without a flag day. `timingSafeEqual` for compare. Unknown emails hash a dummy password so response timing can't enumerate users, and the error message is identical either way. Rate limit: 10 failures per 15 minutes per IP+email, in-memory fixed window — per worker under Passenger, a documented ceiling (N workers still cap the attempt rate).

**CSRF.** Two independent layers, zero token machinery: `SameSite=Lax` keeps the cookie off cross-site non-GET requests, and middleware rejects any state-changing request whose `Origin` (or `Sec-Fetch-Site`) disagrees with the site's origin. Corollary rule, enforced in review: GET handlers never mutate.

**XSS.** Nunjucks autoescape stays on for every admin template — `| safe` appears only where build-rendered post HTML is intentional, and each use is a review flag. Markdown renders with `html: false` for author-role content everywhere (build and previews); raw HTML in markdown is an editor/admin capability — the same line WordPress draws with `unfiltered_html`. EasyMDE's client-side preview is `html: false` for everyone. Admin responses carry `Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-eval'` — inline and remote scripts stay blocked; `unsafe-eval` is what stock Alpine needs (documented ceiling: swap to Alpine's CSP build to drop it) — plus `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`.

**Uploads.** Mime + extension allowlist: `jpeg/png/gif/webp/avif`. No SVG — SVG executes scripts; allow it only if a sanitizer ever earns its place. Size cap via multer limits. Stored under generated names (`randomUUID()` + extension derived from the verified mime); `original_name` is a display column, never a filesystem path. `/uploads` serves with `nosniff`.

**Paths.** Slugs match `^[a-z0-9][a-z0-9-]*$`, enforced server-side at save, because slugs become file paths at build. Media deletion resolves the stored path and verifies it sits inside `data/uploads/` before unlinking. Theme/plugin zip installs: see the plugin section — admin-only, every entry validated.

**SQL.** Prepared statements with `?` placeholders, always — string interpolation into SQL is a review-blocker, not a style nit. User input bound for `LIKE` gets `%` and `_` escaped first.

**Feeds.** Sitemap and RSS are XML; titles and excerpts are entity-escaped, so a `]]>` or `&` in a post title can't corrupt the document.

**Limits.** `express.json`/`urlencoded` get explicit body limits (posts are text — 5 MB is generous), multer caps file sizes, and the build debounce + lock mean a save flood costs one build.

**Plugins are code.** An active plugin runs with the process's full rights — the WordPress trust model, stated plainly. Zip validation stops path tricks, not malice. Install plugins you trust.

---

## API endpoints

### Auth

```
POST   /api/auth/login          { email, password } → { session cookie }
POST   /api/auth/logout         → clears session
GET    /api/auth/me             → current user
```

### Posts

```
GET    /api/posts               ?collection=&status=&page=&limit=&search=
GET    /api/posts/:id
POST   /api/posts               { title, slug, body_markdown, collection_id, status, meta }
PUT    /api/posts/:id           { ...fields to update }
DELETE /api/posts/:id
POST   /api/posts/:id/publish   → sets status=published, triggers build
POST   /api/posts/:id/unpublish → sets status=draft, triggers build
```

### Collections

```
GET    /api/collections
GET    /api/collections/:id     includes post count
POST   /api/collections         { name, slug, sort_by, sort_order, paginate }
PUT    /api/collections/:id
DELETE /api/collections/:id     fails if posts exist (must reassign first)
```

### Media

```
GET    /api/media               ?page=&limit=&mime_type=
POST   /api/media/upload        multipart form, triggers poops-images processing
DELETE /api/media/:id           removes file + variants
GET    /api/media/:id/variants  list generated variants
```

### Themes

```
GET    /api/themes                 list installed themes (filesystem scan)
POST   /api/themes/:slug/activate  writes theme.active setting
PUT    /api/themes/:slug/config    writes theme.config setting
```

### Plugins

```
GET    /api/plugins                  list installed plugins (filesystem scan)
POST   /api/plugins/:slug/activate   adds to plugins.active setting
POST   /api/plugins/:slug/deactivate removes from plugins.active
PUT    /api/plugins/:slug/config     writes plugin.<slug>.config setting
```

### Settings

```
GET    /api/settings
PUT    /api/settings            { key: value, ... }
```

### Build

```
POST   /api/build               manual rebuild trigger
GET    /api/build/status        current build state (idle, building, error)
```

### Users (admin only)

```
GET    /api/users
POST   /api/users               { email, password, role, display_name }
PUT    /api/users/:id           password change deletes the user's other sessions
DELETE /api/users/:id           deletes the user's sessions too
```

---

## Build process in detail

When a build is triggered:

```
1. Acquire build lock — an fs lockfile in data/ (opened with the wx flag), so it
   holds across Passenger workers, not just within one process
2. Create temp directory

3. Export content from DB (only status = 'published' AND published_at <= now —
   scheduling falls out of this filter):
   a. Query published posts grouped by collection
   b. For each post:
      - Build front matter from post fields + meta JSON column
      - Write {collection}/{slug}.md with YAML front matter + body_markdown
      - URL comes from the collection's permalink pattern
   c. For each collection:
      - Write {collection}/index.html with paginate/sort front matter
   d. For standalone pages (collection_id = null):
      - Write {slug}.html or {slug}.md

4. Export data:
   a. Query settings → write _data/site.yaml
   b. Export any global data defined in admin → write to _data/

5. Prepare theme:
   a. Copy active theme layouts → tmp/_layouts/
   b. Copy active theme partials → tmp/_partials/
   c. Copy active theme styles/scripts to their source dirs

6. Generate poops config:
   a. Merge base config + theme config + collection definitions
   b. Write poops.json to temp directory

7. Load plugins:
   a. Import active plugins' filters and extensions
   b. Register on nunjucks environment

8. Run poops:
   a. Instantiate Markups, Scripts, Styles, Copy, SSG
   b. compile() all
   c. Output to output.tmp/

9. Post-build (still into output.tmp/):
   a. Copy data/uploads/ → uploads/ (skip files with unchanged size+mtime)
   b. Write redirect stubs (meta-refresh + canonical) from posts' meta.redirect_from
   c. Generate search-index.json (if enabled)
   d. Generate sitemap.xml and RSS feeds per collection — titles/excerpts
      XML-entity-escaped

10. Swap: rename output/ → output.old/, output.tmp/ → output/, delete output.old/
    (two renames — rename-over-directory fails on Windows). Atomic: no half-built
    site is ever visible, and pages of unpublished/deleted posts vanish because
    every build starts from empty
11. Release lock, clean temp directory
```

---

## Deployment

The output/ directory is a static site. Deploy it anywhere:

- **rsync** (`--delete`, scoped to the site dir) to any server
- **Netlify/Vercel/Cloudflare Pages** — push output/ or trigger from webhook
- **S3 + CloudFront** — sync output/ to bucket
- **GitHub Pages** — push output/ to gh-pages branch

The CMS server itself runs on your own box or a VPS. It doesn't need to be public — authors access it directly, readers only see the static output.

For convenience, pooppress can include deploy presets:

```
$ npx pooppress deploy              # uses configured method
$ npx pooppress deploy --method=rsync --host=example.com --path=/var/www/html
$ npx pooppress deploy --method=s3 --bucket=my-site
```

---

## Hosting the CMS

Since SQLite, the CMS is one Node process and one directory. Four options, all first-class — none required, pick whatever fits. The same app runs unchanged in each; only the supervision differs (you, Docker, systemd, or Passenger):

### 1. No hosting (laptop mode)

Run the CMS locally, deploy only the static output.

```
$ npx pooppress start        # admin at localhost:3000/admin
$ npx pooppress deploy       # push output/ to any free static host
```

Whole CMS state lives in `data/` + `themes/` — sync it with Dropbox/git if you want it on two machines. Zero hosting cost. Single author only; multi-author needs tier 2 or 3.

### 2. Docker

```dockerfile
FROM node:22-slim
WORKDIR /app
RUN npm install -g pooppress
CMD ["pooppress", "start"]
```

```
$ docker run -d -p 3000:3000 -v $PWD/data:/app/data pooppress
```

SQLite = one volume mount. Runs on any container host (Fly, Railway, Coolify, a NAS).

### 3. VPS install script

```
$ curl -fsSL https://pooppress.dev/install.sh | bash
```

The script:

1. Checks Node ≥ 20 (installs via package manager if missing)
2. `npm install -g pooppress`
3. Runs the init wizard
4. Writes a systemd unit (auto-restart, start on boot)
5. Optionally installs Caddy and writes the reverse proxy config:

```
cms.example.com {
    reverse_proxy localhost:3000
}
```

That's the whole HTTPS story — Caddy auto-provisions certificates. Uninstall = `systemctl disable pooppress && rm -rf` the directory.

Same model as `ghost install`, minus the nginx/mysql choreography — there's nothing else to set up. (Already running Apache/nginx on the box? Skip Caddy — a 5-line reverse proxy vhost to `localhost:3000` does the same job; Caddy is only chosen for free auto-TLS.)

### 4. Shared hosting (Passenger / cPanel "Setup Node.js App")

Many cPanel hosts (CloudLinux) run Phusion Passenger: Apache/nginx spawns and supervises the Node process itself — starts it on first request, restarts it when `tmp/restart.txt` is touched. No systemd, no ports, no SSH daemon-wrangling. This is the WordPress-hosting story without PHP:

1. Upload pooppress (or `npm install` via the panel's terminal)
2. Point the panel's Node.js app at the entry file
3. Run `pooppress init` once

pooppress needs nothing special for this: it listens on `process.env.PORT` (Passenger sets it) and keeps all state in `data/`. That includes auth and build state — sessions are SQLite rows, the build lock is a file — so Passenger running several workers changes nothing; process memory is never authority (PHILOSOPHY.md #2). better-sqlite3 and sharp both ship prebuilt binaries, so `npm install` works without compilers.

Ceilings: shared-host memory limits can choke builds on large sites (sass + sharp are the heavy parts), and Passenger idles the process so the first admin hit after a quiet spell is a cold start. Both acceptable — readers never touch this process, only authors do. Set `passenger_min_instances 1` to keep one worker warm.

## Tech stack decisions

| Concern          | Choice                                                                               | Rationale                                                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime          | Node.js                                                                              | poops is a Node library — build is an in-process `compile()` call. Any other runtime (PHP, etc.) would have to shell out to Node: two runtimes for nothing                                               |
| Server framework | Express                                                                              | Boring, documented everywhere                                                                                                                                                                            |
| Database         | SQLite (better-sqlite3)                                                              | Zero config, zero server process, sync API, backup = copy a file                                                                                                                                         |
| ORM              | None — plain SQL                                                                     | 5 tables. Migrations = numbered .sql files + `PRAGMA user_version`                                                                                                                                       |
| Admin UI         | HAT stack ([stamat/shitstorm-hat](https://github.com/stamat/shitstorm-hat) template) | Server-rendered nunjucks + htmx partial swaps + Alpine.js sprinkles + Tailwind. Built with poops itself — admin and site share one engine. Styles stay minimal: Tailwind utilities, no component library |
| Markdown editor  | EasyMDE                                                                              | Interactive: toolbar, shortcuts, side-by-side preview — one script include, zero build. Ceiling: CodeMirror 5 core; swap to CM6 setup if it rots                                                         |
| Auth             | Sessions (SQLite table) + scrypt (node:crypto)                                       | Stdlib hashing, no bcrypt dep; DB-backed sessions survive restarts, span Passenger workers, and make logout real revocation                                                                              |
| Build engine     | poops                                                                                | Already exists, already works                                                                                                                                                                            |
| Image processing | poops-images                                                                         | Already exists, generates width variants                                                                                                                                                                 |
| CSS              | Whatever the theme uses                                                              | poops handles SCSS/CSS compilation                                                                                                                                                                       |

---

## What this is NOT

- **Not a headless CMS** — it generates the final output itself, not just an API
- **Not a WordPress clone** — no PHP, no per-request rendering, no plugin soup
- **Not a SaaS** — self-hosted, you own everything
- **Not complicated** — one Node process, one SQLite file, static output. No ORM, no SPA framework, no DB server, no frontend build step

---

## MVP scope

Phase 1 — the minimum to replace a WordPress blog:

1. Setup wizard (create SQLite file, run migrations, create admin)
2. Auth (login, sessions, single admin role)
3. Post CRUD with markdown editor
4. Single "blog" collection with pagination
5. Media upload with poops-images processing
6. Default theme
7. Build bridge (DB → files → poops → output)
8. Manual deploy via rsync or copy
9. WordPress importer (WXR → posts/media/users, permalink patterns, redirect stubs)

Phase 2 — multi-user and theming (complete, v0.2.0):

10. User roles (admin, editor, author)
11. Multiple collections
12. Theme system with config UI
13. Scheduled publishing
14. Draft preview

Phase 3 — extensibility:

15. Plugin system
16. Static search index
17. Deploy presets
18. Theme/plugin marketplace (registry)
