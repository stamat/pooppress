---
layout: poops-docs-theme/docs
title: FAQ
description: Comments, plugins, scaling, and the questions a WordPress user asks first.
order: 12
---

# FAQ

**Can I have comments?**
Not server-side — there is no server on the reader's side of the site. Ship a client-side
service from your theme (Giscus, Commento, Disqus) and it works fine.

**Contact forms?**
Same answer: point the form at a third-party endpoint (Formspree, a Worker, your own
serverless function). The static site can't accept a POST.

**Plugins?**
Not yet. The extension points are designed — filters and template extensions registered on
the build, plus lifecycle hooks (`post:save`, `post:publish`, `media:upload`,
`post:frontmatter`, `build:before`, `build:after`) — and core's own sitemap and RSS will
run through them so the API is dogfooded rather than theoretical. Until then, a theme
covers most of what a plugin would.

**How big a site can it build?**
Builds are proportional to published posts. A few hundred posts build in seconds; a few
thousand in tens of seconds. The debounce folds a save flood into one build. Shared
hosting is the first place to feel it, because Sass and Sharp want memory.

**Do I need to keep the CMS running?**
No. The site is static files. The CMS only has to run when you want to write.

**How do I back up?**
`cp -r data/` — the database file and the uploads. Restoring is copying it back.

**Can two people write at once?**
Yes. Sessions and the build lock live in the filesystem, not in process memory, so several
workers (or several people) are fine. Last save wins on a single post — there is no
locking, and no merge.

**Where did my scheduled post go?**
The export only includes `published_at <= now`, so a future-dated post stays out of the
build until its time. A sweep on the running server rebuilds within a minute of a post
coming due. If the server was off at that moment (laptop mode), the post publishes the
next time it starts — or `pooppress build` does it headlessly.

**Can I edit `output/`?**
You can, and the next build will erase it. Every build starts from an empty tree — that is
what makes deleted pages actually disappear.

**Why SQLite?**
Zero configuration, zero daemons, and a backup is a file copy. A blog is not a workload
that needs a database server.

**Why is the admin panel a server-rendered page in $current_year?**
Because it makes the whole panel work without JavaScript, keeps the payload small, and
means there is no API-plus-SPA pair to keep in sync. htmx and Alpine add the interactivity
that actually earns its keep.

**Is it really called pooppress?**
Yes. It builds with [poops](https://github.com/stamat/poops).
