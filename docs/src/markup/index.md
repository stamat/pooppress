---
layout: poops-docs-theme/prose
title: pooppress
description: A CMS that generates static sites — one Node process, one SQLite file, plain HTML out.
---

# pooppress

**A CMS that generates static sites.** Because WordPress with a caching plugin is just a
static site generator with 200MB of PHP baggage.

You write in an admin panel. pooppress compiles the database into plain HTML with
[poops](https://github.com/stamat/poops). Readers get static files — no PHP, no database
query, no plugin soup between them and the page.

```bash
npm install -g pooppress
mkdir my-blog && cd my-blog
pooppress init      # asks six questions
pooppress start     # admin at http://localhost:3000/admin
```

[Read the docs →](docs/)

## What it is

- **An admin panel a non-developer can use.** Posts, media, collections, users, settings —
  laid out like the one they already know.
- **A markdown editor** with a toolbar, live preview and a media picker.
- **A build step that runs on save.** Publish a post, and a few seconds later `output/`
  holds the finished site.
- **One process, one file, one directory.** Backup is `cp -r data/`. Uninstall is `rm -rf`.
- **A WordPress importer.** Point it at a WXR export; old URLs keep resolving.

## What it is not

- **Not headless.** It produces the final HTML, not just an API.
- **Not a WordPress clone.** No per-request rendering, no EAV meta tables.
- **Not a SaaS.** You self-host, you own the database file.

## The trade it makes on purpose

The public site is static. That means no comments, no forms, no per-request anything
unless the browser does it. In exchange: the reader-facing attack surface is a directory
of files, hosting costs approximately nothing, and pages arrive as fast as the CDN can
send them.

## Where it runs

Your laptop, a Docker container, a VPS behind Caddy, or shared hosting under Passenger —
the same app, unchanged. Only the supervision differs.

[Install it →](docs/install.html)
