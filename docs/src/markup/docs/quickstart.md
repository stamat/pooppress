---
layout: poops-docs-theme/docs
title: Quick start
description: Empty directory to published post in about five minutes.
order: 3
---

# Quick start

## 1. Create the site

```bash
mkdir my-blog && cd my-blog
pooppress init
```

The wizard asks six questions:

```
  Welcome to pooppress.

  Site
  ────────────────────────────
  Title:       My Blog
  URL:         https://myblog.example
  Description: A blog about things

  Admin account
  ────────────────────────────
  Email:    me@example.com
  Password: ********
```

There are no database questions — SQLite is a file. `init` creates `data/pooppress.db`,
runs the migrations, creates your admin account, activates the default theme, and adds a
`Blog` collection to write into.

## 2. Start the server

```bash
pooppress start
```

Open <http://localhost:3000/admin> and log in.

## 3. Write a post

**Posts → Add new.** Type a title — the slug fills itself in. Write markdown in the
editor; the toolbar has bold, headings, links, lists, a media picker and a live preview.

**Save** keeps it as a draft. Drafts never touch `output/`, and neither do autosaves, so
a day of writing costs zero builds.

## 4. Publish

Hit **Publish** in the right-hand column. That flips the status, stamps `published_at`,
and requests a build. The topbar shows `building…` and then `built` — a couple of seconds
for a small site.

Now look at `output/`:

```
output/
├── blog/
│   ├── index.html          the paginated post list
│   ├── my-first-post.html
│   └── feed.xml            RSS
├── css/main.min.css
├── sitemap.xml
└── uploads/                your images
```

That directory is the whole website.

## 5. Put it on the internet

```bash
pooppress deploy --method=rsync --host=me@example.com --path=/var/www/html
```

Or copy it locally, or point Netlify/Cloudflare Pages at it, or commit it to a `gh-pages`
branch. It is a directory of static files — every deployment tool already handles it.

Save the method under **Settings → Deploy** and plain `pooppress deploy` uses it.

## What happens when you publish

```
you hit Publish
  → status = published, published_at stamped
  → a build is requested (2s debounce — ten rapid saves cost one build)
  → published posts are exported to markdown + front matter in a temp directory
  → the active theme's layouts, partials and styles join them
  → poops compiles it all to HTML, CSS, sitemap and RSS
  → uploads are copied in
  → the finished tree is swapped into output/ with a rename
```

The swap is atomic, and every build starts from an empty tree — so a page you unpublish
disappears instead of lingering.
