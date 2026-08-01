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

## Serving it yourself

nginx:

```nginx
server {
    listen 80;
    server_name example.com;
    root /var/www/example.com/output;
    index index.html;
}
```

Apache:

```apache
<VirtualHost *:80>
    ServerName example.com
    DocumentRoot /var/www/example.com/output
</VirtualHost>
```

No rewrite rules. Pages are real `.html` files and collection indexes are an `index.html`
inside a directory, so the default directory index covers the whole site. Links are
relative, so it works from a subdirectory just as well as from a domain root.

Four things to get right:

**Point the docroot at `output/`, never at its parent.** `data/` sits beside it and holds
the database and the original uploads. A docroot one level too high publishes both.

**Give the site a home page.** `/` needs a page whose slug is `index`. Without one the
server has nothing to serve there and answers 403 or 404.

**Set the real domain before you build.** Settings → Site → URL feeds the canonical tags,
`sitemap.xml` and the redirect stubs. Left at `localhost:3000`, all three point at your
laptop.

**nginx and webp:** `mime.types` from before 1.21 has no entry for it, and browsers get a
download prompt instead of an image. `grep webp /etc/nginx/mime.types`; if it comes back
empty, add `image/webp webp;`. Apache has shipped it for years.

Need per-host config files — an `.htaccess` on shared hosting, a `_headers` file — put
them in your theme's `static/` directory. Everything there is copied to the site root on
each build.

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
