---
layout: poops-docs-theme/docs
title: Documentation
description: How pooppress works, and how to run it.
order: 1
---

# Documentation

pooppress is a content management system that writes static websites. You edit in the
admin panel; every publish triggers a build; the build writes plain HTML into `output/`,
which you deploy anywhere.

## Start here

- **[Install](install.html)** — get it running on your machine or a server.
- **[Quick start](quickstart.html)** — from empty directory to a published post.
- **[Writing](writing.html)** — posts, drafts, front matter, the editor.

## Then

- **[Media](media.html)** — uploads, image variants, inserting images.
- **[Collections](collections.html)** — blogs, changelogs, standalone pages, permalinks.
- **[Themes](themes.html)** — what a theme is, and how to write one.
- **[Deploying](deploy.html)** — getting `output/` onto the internet.
- **[Migrating from WordPress](wordpress.html)** — the WXR importer.
- **[CLI](cli.html)** — every command.
- **[Security](security.html)** — what protects the admin, and what doesn't need protecting.

## The shape of it

```
data/pooppress.db     your content — back this up
data/uploads/         your images — back this up too
themes/               drop a directory in, it's installed
output/               the generated site — deploy this, never edit it
```

One Node process reads and writes those. Nothing else is running.

## The rules it holds itself to

1. **Static output is the product.** Anything dynamic moves to build time or to the
   browser — never to a per-request server.
2. **One process, one database file, one directory.** Backup is `cp -r`.
3. **Boring before clever.** Stdlib before a dependency, an existing dependency before a
   new one.
4. **The filesystem is the truth for installables.** Themes are directories, not rows.
5. **Save is the render moment.** The CMS is an editor plus a compiler, not a runtime.
