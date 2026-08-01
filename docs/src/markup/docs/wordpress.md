---
layout: poops-docs-theme/docs
title: Migrating from WordPress
description: Import a WXR export — posts, pages, authors, categories, media and old URLs.
order: 9
---

# Migrating from WordPress

## 1. Export

In WordPress: **Tools → Export → All content**. You get a `.xml` file (WXR).

## 2. Import

```bash
pooppress import wxr export.xml --collection blog
```

Flags:

| Flag | Effect |
| --- | --- |
| `--collection <slug>` | which collection posts land in (default `blog`, created if missing) |
| `--skip-media` | don't download attachments |

## What comes across

| WordPress | pooppress |
| --- | --- |
| Posts | posts in the target collection |
| Pages | standalone posts (no collection) |
| `publish` / `draft` / `pending` / `private` | `published` / `draft` / `review` / `draft` |
| Authors | users with a locked password |
| Categories, tags | `meta.categories`, `meta.tags` |
| Attachments | downloaded into `data/uploads/`, body URLs rewritten |
| Old permalinks | `meta.redirect_from`, built as redirect stubs |

Post bodies stay HTML. Markdown is a superset, so they render exactly as they did —
nothing is mangled by a conversion you didn't ask for. (An HTML→markdown pass is parked
until authors actually want to edit imported posts as markdown.)

Nothing is published that wasn't published before: an unknown status becomes a draft.

## Imported accounts cannot log in

Every imported author gets a real scrypt hash of a random value nobody holds. The account
exists so posts keep their author, but there is no password to guess. Set one under
**Users → Edit** for anyone who needs access.

## Old URLs keep working

WordPress posts usually live at `/2019/07/hello-world/`; in pooppress the same post is
`/blog/hello-world.html`. The importer records the old path in `meta.redirect_from`, and
every build writes a stub there:

```html
<meta http-equiv="refresh" content="0; url=https://example.com/blog/hello-world.html">
<link rel="canonical" href="https://example.com/blog/hello-world.html">
```

Meta-refresh plus canonical is the whole story on a static host: browsers follow it,
search engines consolidate on the canonical. If your new host can do real 301s, generate
its redirect map from the same `redirect_from` values.

Set the collection's [permalink pattern](collections.html) to `/:year/:month/:slug` to
keep the date structure under the collection prefix.

## Re-running

An import can be repeated: matching slugs are updated rather than duplicated, and
already-downloaded attachments are not fetched again. Fix something in WordPress, export
again, re-import.

## What does not come across

Comments, widgets, plugin-generated content, shortcodes and theme settings. Shortcodes
arrive as literal text — search for `[` in your imported bodies and clean them up.

Comments are the honest gap: static output has no request path to post to. Ship a
client-side service (Disqus, Giscus, Commento) from your theme if you need them.

## Afterwards

```bash
pooppress build
```

Then walk a handful of old URLs and confirm they land where they should.
