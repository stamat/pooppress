# pooppress — Design philosophy

Every decision in [ARCHITECTURE.md](ARCHITECTURE.md) and [DEVELOPMENT.md](DEVELOPMENT.md) traces back to one of these. When a future decision is hard, it's because two of these conflict — pick the one higher on the list.

## 1. Static output is the product

Readers get plain HTML. The server exists for authors only. Anything dynamic moves to build time or to client-side JS — never to a per-request server. This is the trade the whole project makes on purpose; no feature is worth reversing it.

## 2. One process, one database file, one directory

A Node process, a SQLite file, a `data/` directory. Backup is `cp -r`. Uninstall is `rm -rf`. Any feature that requires a second daemon, a DB server, or external state must justify itself against this line — so far nothing has.

One refinement Passenger forced: process-local memory is never authority. Sessions, locks, and queues live in the SQLite file or the filesystem — a supervisor that runs two copies of the process breaks nothing.

## 3. Climb the ladder before writing code

Stdlib before dependency (`crypto.scrypt`, not bcrypt; `node:readline`, not a prompt library). An existing dependency before a new one (nunjucks templates the site, the admin, and the emails-if-ever; poops builds both the sites and the admin itself). Boring before clever (Express, LIKE queries, setInterval scheduling). A new dependency is a maintenance debt with a changelog. The one deliberate double-climb: Tailwind in the admin (a dev-time artifact, compiled once, never shipped to sites) and plain SCSS in themes (a user-facing artifact, kept dependency-light). Different audiences, different rungs — a decision, not drift.

## 4. The filesystem is the truth for installables

Themes and plugins are directories with manifests. Installing is dropping a directory; uninstalling is deleting it. The database stores content and choices (what's active, how it's configured) — never a mirror of what's on disk. Mirrors drift; scans don't.

## 5. Derived and dependent data is a column, not a table

Front matter is a JSON column on posts. Image variants are a JSON column on media. A table exists only for data queried independently of its parent — sessions earn one (looked up by token on every request), image variants don't (one producer, one consumer). Six tables is a feature.

## 6. Save is the render moment

The CMS is an editor plus a compiler, not a runtime. Every save triggers a debounced build; hooks wrap that lifecycle (`post:save` → `build:after`). Plugins extend the editor, the build, and the pipeline — they cannot inject themselves between a reader and the HTML, because nothing runs there.

## 7. Ceilings are documented, not preempted

Ship the simple version with its limit written down and its upgrade named: `LIKE` until FTS5 is needed, per-worker login rate-limit windows until distributed abuse actually shows up, EasyMDE until it rots, then CodeMirror 6. Ideas that don't survive this test go to [IDEAS.md](IDEAS.md) with a revisit trigger — parked, not planned.

## 8. Hosting is a spectrum, never a requirement

The same app runs unchanged on a laptop, in Docker, under systemd on a VPS, or under Passenger on shared hosting. Only the supervision differs. Achieved by exactly two disciplines: listen on `process.env.PORT`, keep all state in `data/`. Any change that breaks one of the four tiers is wrong.

## 9. Dogfood the extension points

The admin is built with poops. Sitemap, RSS, and search run through the same `build:after` hook offered to plugins. If core routes around its own plugin API, the API is broken and nobody will tell us.

## 10. Take WordPress's lessons, not its body

Keep: install-anywhere hosting, drop-in plugins, one admin panel a non-developer can use. Discard: per-request PHP rendering, EAV meta tables, plugin soup running in the readers' hot path, 200MB of runtime between an author and their HTML.

## 11. Security is boring platform primitives

`SameSite` cookies, scrypt, prepared statements, autoescape, allowlists, random tokens — the things the platform already ships, wired on and written down in [ARCHITECTURE.md §Security model](ARCHITECTURE.md#security-model). No security dependencies, no theater. The public site needs none of it: static files have no request path to attack — the strongest security feature of the whole design. One override on this whole list: it is priority-ordered, but a trust boundary outranks every entry — when laziness and a boundary conflict (validation, escaping, revocation), the boundary wins regardless of position.
