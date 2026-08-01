---
layout: poops-docs-theme/docs
title: Writing
description: Posts, statuses, slugs, front matter and the editor.
order: 4
---

# Writing

## The editor

**Posts → Add new** opens a full-width editor: title on top, markdown body below, and the
publishing controls in a right-hand column.

- The **slug** is suggested from the title until you edit it yourself, then it stays put.
  Slugs must match `^[a-z0-9][a-z0-9-]*$` — they become file paths at build time, and the
  server enforces it regardless of what the browser sent.
- **Excerpt** is optional. Leave it empty and the build uses the first paragraph for post
  cards, RSS and meta descriptions.
- **Autosave** runs every 30 seconds, but only when something actually changed. Autosaves
  never change status and never trigger a build.

The editor works without JavaScript too — it is a plain form; htmx and Alpine only make it
nicer.

## Statuses

| Status | Means | In `output/`? |
| --- | --- | --- |
| `draft` | still writing | no |
| `review` | waiting for an editor | no |
| `published` | live | yes, once `published_at` has passed |
| `archived` | taken down, kept | no |

**Publish** stamps `published_at` with the current time if it is empty. Set that field to
a future date and the post stays out of the build until then — the export only ever
includes `status = 'published' AND published_at <= now`.

## Front matter

Anything the theme should know about a post that isn't a core field goes in the **Front
matter** panel as key/value rows. Those keys land in the post's front matter at build time
and are available to layouts as {% raw %}`{{ page.<key> }}`{% endraw %}.

Values that parse as JSON are stored as JSON, so `["a","b"]` stays a list:

| Key | Value | Reaches the template as |
| --- | --- | --- |
| `featured_image` | `/uploads/hero.jpg` | a string |
| `tags` | `["release","notes"]` | a list |
| `layout` | `wide` | overrides the collection's layout |
| `redirect_from` | `["/old/url/"]` | redirect stubs in `output/` |

`redirect_from` is special: the build writes a meta-refresh + canonical stub at each old
URL, which is how a migrated site keeps its links working.

## Standalone pages

Set **Collection** to *Standalone page* and the post builds to `/<slug>.html` instead of
`/<collection>/<slug>.html`, using the theme's `page` layout. That is what an About or
Contact page is.

## Searching and filtering

The post list searches titles and bodies with SQL `LIKE`, filtered by status and
collection, paginated 20 at a time. It is deliberately simple — it runs over your own few
thousand rows, not over the internet.

## Raw HTML

Markdown is a superset of HTML, so HTML in a post body renders as-is. Keep that in mind
when handing out author accounts: an account you would not trust with raw HTML is an
account you should not give raw HTML to.
