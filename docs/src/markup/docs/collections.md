---
layout: poops-docs-theme/docs
title: Collections
description: Blogs, changelogs, pagination, sort order and permalink patterns.
order: 6
---

# Collections

A collection is a group of posts that shares a URL prefix, a layout, a sort order and a
page size. A blog is a collection. So is a changelog, a podcast, or a portfolio.

`init` creates one called **Blog**. Add more under **Collections**.

| Field | What it does |
| --- | --- |
| Name | display name, and the heading on the index page |
| Slug | the URL segment and the directory name: `/blog/…` |
| Posts per page | pagination size; empty means one long page |
| Sort | `newest first` (default) or `oldest first` |
| Permalink | optional pattern, see below |
| Layout / index layout | which theme layout renders items and the index |

Every collection gets, for free:

- a paginated index at `/<slug>/` and `/<slug>/2/`, `/<slug>/3/`…
- an RSS feed at `/<slug>/feed.xml`
- entries in `sitemap.xml`

## Standalone pages

A post with no collection builds to `/<slug>.html` with the `page` layout. Use it for
About, Contact, and the like.

## Permalink patterns

A collection can carry a pattern so migrated URLs keep their shape:

```
/:year/:month/:slug   →  /blog/2019/07/hello-world.html
```

Tokens: `:year`, `:month`, `:day`, `:slug`.

**The collection slug stays in front of the pattern.** poops decides collection membership
by directory, so items have to live under `/<slug>/`. For a WordPress site whose posts
were at `/2019/07/hello-world/`, that means the new URL differs — which is what
`redirect_from` is for. The [importer](wordpress.html) fills it in automatically, and the
build writes a stub at every old URL.

## Deleting

A collection with posts refuses to be deleted. Move the posts first — reassigning someone
else's content is a decision, not a cascade.

## What triggers a rebuild

Creating, editing or deleting a collection changes URLs and index pages, so each one
requests a build. So do settings changes, theme activation, publishing, unpublishing, and
deleting published content. Draft saves and autosaves do not.
