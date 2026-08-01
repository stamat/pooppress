---
layout: poops-docs-theme/docs
title: Deploying
description: output/ is a directory of static files. Every deployment tool already handles it.
order: 8
---

# Deploying

The build writes `output/`. That directory *is* the website — HTML, CSS, images, RSS,
sitemap. The CMS server does not need to be public, or even running, for the site to work.

## Built in

```bash
pooppress deploy --method=copy  --target=/var/www/html
pooppress deploy --method=rsync --host=me@example.com --path=/var/www/html
```

Both **mirror**: files no longer in `output/` stop being served (`rsync --delete`, and the
copy method clears the target first). Point them at a directory you own — a mirror deploy
into the wrong place deletes what is there.

Save the method under **Settings → Deploy** and then plain `pooppress deploy` uses it.

## Everything else

Nothing about `output/` is pooppress-specific:

- **Netlify / Vercel / Cloudflare Pages** — publish directory `output/`.
- **S3 + CloudFront** — `aws s3 sync output/ s3://bucket --delete`.
- **GitHub Pages** — push `output/` to a `gh-pages` branch.
- **A plain web server** — rsync it and point the vhost at it.

## Rebuilding

The topbar shows the build state and has a **Rebuild** button. From a shell:

```bash
pooppress build
```

It exits non-zero when the build fails, so CI and cron can rely on it.

## A typical setup

Laptop mode plus a static host is the cheapest arrangement that works: run the CMS
locally, publish, deploy. The admin is never exposed to the internet at all.

For multi-author sites, run the CMS on a VPS behind Caddy (see [Install](install.html))
and deploy from there.
