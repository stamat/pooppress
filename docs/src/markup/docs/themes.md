---
layout: poops-docs-theme/docs
title: Themes
description: Installing a theme is dropping a directory. Writing one is six files.
order: 7
---

# Themes

A theme is a directory in `themes/` with a `theme.json`. Installing one means putting it
there; uninstalling means deleting it. There is no registration step and no database row —
the admin lists what is on disk, and the settings table only records which one is active.

## Anatomy

```
themes/my-theme/
├── theme.json
├── layouts/
│   ├── default.html      the frame every page extends
│   ├── post.html         a single post
│   ├── collection.html   a paginated index
│   └── page.html         a standalone page
├── partials/
│   ├── header.html
│   ├── footer.html
│   ├── meta.html         <title>, description, og:, canonical
│   ├── post-card.html    one entry in a list
│   └── pagination.html
└── styles/
    ├── main.scss
    └── _variables.scss
```

## theme.json

```json
{
  "name": "My Theme",
  "version": "1.0.0",
  "description": "Clean and minimal",
  "layouts": "layouts/",
  "partials": "partials/",
  "styles": { "in": "styles/main.scss", "out": "css" },
  "config": { "accentColor": "#1d4ed8", "showAuthor": true },
  "configSchema": {
    "accentColor": { "type": "color", "default": "#1d4ed8", "label": "Accent color" },
    "showAuthor": { "type": "boolean", "default": true, "label": "Show author on posts" }
  }
}
```

{% raw %}
`config` values reach templates as `{{ theme.* }}`. `configSchema` turns them into a form
on the Themes screen — types are `color`, `number`, `boolean`, `select` and text.

## The one rule about blocks

poops wraps a page's body in `{% block content %}`. So **a layout must not put its own
markup in `content`** — the page would overwrite it. Layouts add their chrome in
`{% block main %}` and leave `content` alone:

```nunjucks
{# default.html #}
<body>
  {% include "header.html" %}
  <main class="wrap">
    {% block main %}{% block content %}{% endblock %}{% endblock %}
  </main>
  {% include "footer.html" %}
</body>
```

```nunjucks
{# post.html #}
{% extends "default.html" %}
{% block main %}
  <article>
    <h1>{{ page.title }}</h1>
    {% block content %}{% endblock %}
  </article>
{% endblock %}
```
{% endraw %}

## What templates get

| Variable | Where it comes from |
| --- | --- |
| `site.title`, `site.url`, `site.description`, … | Settings |
| `theme.*` | `theme.json` config, overridden by the Themes screen |
| `page.title`, `page.date`, `page.author`, `page.excerpt` | the post |
| `page.<anything>` | that post's front matter rows |
| `page.pageItems` | on a collection index: this page's posts |
| `page.pageNumber`, `page.totalPages`, `page.prevPageUrl`, `page.nextPageUrl` | pagination |
| `relativePathPrefix` | prefix for links and assets — always use it |

Pagination happens in pooppress rather than in poops, so a collection index only ever
reads `page.pageItems`; sort order comes from the collection's own setting.

## Styles

SCSS, compiled by poops, minified into `output/css/`. Themes stay dependency-light on
purpose — no Tailwind, no framework. (The admin panel *does* use Tailwind; it is a
dev-time artifact compiled once, never shipped to your site.)

## Trying it

Drop the directory in `themes/`, open **Themes**, click Activate. That writes
`theme.active` and rebuilds. The bundled `default` theme is a working reference —
copy it and edit.

## Overriding the bundled theme

A directory in your site's own `themes/` wins over the one shipped inside the package, so
`themes/default/` in your project customises the default theme without touching the
install.
